"ui";
(function () {
  var defaults = require("./config/defaults");
  var migrations = require("./storage/migrations");
  var Store = require("./storage/store").Store;
  var Logger = require("./diagnostics/logger").Logger;
  var health = require("./diagnostics/health_check");

  var store = new Store("wxbot.app.v1", defaults, migrations);
  var logger = new Logger(store, { limit: 200, maskMessagePreview: true, logFile: "./logs/runtime.log" });
  try { if (typeof console !== "undefined" && console.show) console.show(); } catch (ignoreConsole) {}
  // 官方推荐的 UI 脚本保活方式：空 setInterval 不阻塞 UI 和 events 事件线程.
  var mainKeepAlive = setInterval(function () {}, 1000);
  var workerExecution = null;
  var workerStartInFlight = false;
  var badgeScanOnly = false;
  var mainOwnerId = "main-" + Date.now().toString(36) + "-" + Math.floor(Math.random() * 100000).toString(36);

  ui.layout(
    <scroll>
      <vertical padding="16">
        <text text="wxbot 移动端自动化" textSize="22sp" textColor="#202124" />
        <text id="statusText" text="状态：未启动" textSize="15sp" marginTop="8" />
        <text id="counterText" text="今日添加 0 · 今日回复 0" textSize="13sp" />
        <text id="errorText" text="最近错误：无" textSize="13sp" textColor="#b3261e" />
        <horizontal marginTop="8">
          <button id="startButton" text="启动自动化" layout_weight="1" />
          <button id="stopButton" text="停止" layout_weight="1" />
        </horizontal>

        <card marginTop="12" cardCornerRadius="8dp" cardElevation="2dp">
          <vertical padding="12">
            <text text="权限与设备" textSize="18sp" />
            <text id="permissionText" text="正在检查……" textSize="13sp" marginTop="6" />
            <horizontal>
              <button id="accessibilityButton" text="无障碍设置" layout_weight="1" />
              <button id="notificationButton" text="通知设置" layout_weight="1" />
            </horizontal>
          </vertical>
        </card>

        <card marginTop="12" cardCornerRadius="8dp" cardElevation="2dp">
          <vertical padding="12">
            <text text="MQTT 远程控制与状态上报" textSize="18sp" />
            <text text="使用 AutoX.js Rhino Paho MQTT；命令仍进入串行队列，主动发送仍需二次确认。" textSize="12sp" textColor="#5f6368" />
            <input id="mqttServer" hint="Broker 地址，例如 tcp://192.168.1.10:1883" marginTop="6" />
            <input id="mqttClientId" hint="clientId（必须唯一）" />
            <input id="mqttUsername" hint="用户名（可选）" />
            <input id="mqttPassword" hint="密码（可选）" />
            <input id="mqttCommandTopic" hint="命令主题，支持 {clientId}" />
            <input id="mqttEventTopic" hint="事件主题，支持 {clientId}" />
            <horizontal>
              <button id="mqttSaveButton" text="保存 MQTT 配置" layout_weight="1" />
              <button id="mqttToggleButton" text="启用 MQTT" layout_weight="1" />
            </horizontal>
            <text id="mqttStatus" text="MQTT：未配置" textSize="13sp" marginTop="6" />
          </vertical>
        </card>

        <card marginTop="12" cardCornerRadius="8dp" cardElevation="2dp">
          <vertical padding="12">
            <text text="主动添加好友" textSize="18sp" />
            <text text="首版只支持微信号或 wxid；搜索后必须二次确认。" textSize="12sp" textColor="#5f6368" />
            <input id="friendTarget" hint="微信号 / wxid" marginTop="6" />
            <input id="friendVerify" hint="验证消息（可选）" />
            <input id="friendRemark" hint="备注（可选）" />
            <horizontal>
              <button id="friendSearchButton" text="搜索目标" layout_weight="1" />
              <button id="friendConfirmButton" text="确认发送" enabled="false" layout_weight="1" />
              <button id="friendCancelButton" text="取消" layout_weight="1" />
            </horizontal>
            <text id="friendResult" text="尚未搜索" textSize="13sp" marginTop="6" />
            <text id="friendHistory" text="最近任务：无" textSize="12sp" />
          </vertical>
        </card>

        <card marginTop="12" cardCornerRadius="8dp" cardElevation="2dp">
          <vertical padding="12">
            <text text="主动给好友发消息" textSize="18sp" />
            <text text="输入完整备注名或微信号；定位后必须二次确认。" textSize="12sp" textColor="#5f6368" />
            <input id="messageTarget" hint="完整备注名 / 微信号 / wxid" marginTop="6" />
            <input id="messageText" hint="要发送的消息" />
            <horizontal>
              <button id="messageSearchButton" text="定位好友" layout_weight="1" />
              <button id="messageConfirmButton" text="确认发送" enabled="false" layout_weight="1" />
              <button id="messageCancelButton" text="取消" layout_weight="1" />
            </horizontal>
            <text id="messageResult" text="尚未定位" textSize="13sp" marginTop="6" />
            <text id="messageHistory" text="最近消息任务：无" textSize="12sp" />
          </vertical>
        </card>

        <card marginTop="12" cardCornerRadius="8dp" cardElevation="2dp">
          <vertical padding="12">
            <text text="当前聊天好友资料" textSize="18sp" />
            <text text="仅读取当前已经打开的好友聊天，不搜索、不切换其他联系人。" textSize="12sp" textColor="#5f6368" />
            <button id="friendProfileButton" text="读取当前好友微信号" marginTop="6" />
            <text id="friendProfileResult" text="尚未读取" textSize="13sp" marginTop="6" />
          </vertical>
        </card>

        <card marginTop="12" cardCornerRadius="8dp" cardElevation="2dp">
          <vertical padding="12">
            <text text="私聊关键词回复" textSize="18sp" />
            <input id="listenMode" hint="监听模式：whitelist 或 all" />
            <input id="whitelistInput" hint="白名单（逗号分隔）" />
            <input id="blacklistInput" hint="黑名单（逗号分隔）" />
            <input id="replyKeyword" hint="关键词" />
            <input id="replyText" hint="回复内容" />
            <button id="replySaveButton" text="保存规则" />
            <button id="badgeScanOnlyButton" text="Badge scan only: OFF" />
            <text id="badgeScanStatus" text="Normal mode: unread badge opens chat" textSize="12sp" />
            <text id="replyStatus" text="规则未修改" textSize="12sp" />
          </vertical>
        </card>

        <card marginTop="12" cardCornerRadius="8dp" cardElevation="2dp">
          <vertical padding="12">
            <text text="运行日志" textSize="18sp" />
            <text id="logText" text="暂无日志" textSize="12sp" />
          </vertical>
        </card>
      </vertical>
    </scroll>
  );

  function textOf(view) {
    try { return String(view.getText() || "").trim(); } catch (ignore) { return ""; }
  }

  function commandId() {
    return "cmd-" + Date.now().toString(36) + "-" + Math.floor(Math.random() * 100000).toString(36);
  }

  function writeCommand(type, payload) {
    store.setRuntime({ command: { id: commandId(), type: type, payload: payload || {}, createdAt: Date.now() }, commandResult: null });
  }

  function applyBadgeScanOnly(enabled) {
    badgeScanOnly = !!enabled;
    var config = store.loadConfig();
    config.privateChat.badgeScanOnly = badgeScanOnly;
    store.saveConfig(config);
    try {
      ui.badgeScanOnlyButton.setText(badgeScanOnly ? "Badge scan only: ON" : "Badge scan only: OFF");
      ui.badgeScanStatus.setText(badgeScanOnly ? "Only scan avatar-side unread badges; never enter chat" : "Normal mode: unread badge opens chat");
    } catch (ignoreUi) {}
    logger.info(badgeScanOnly ? "Badge scan-only mode enabled" : "Badge scan-only mode disabled", { badgeScanOnly: badgeScanOnly });
  }

  function joinPath(base, child) {
    try { if (typeof files !== "undefined" && files.join) return files.join(base, child); } catch (ignore) {}
    return String(base).replace(/[\\\/]$/, "") + "/" + child;
  }

  function workerPath() {
    try {
      if (typeof engines !== "undefined" && engines.myEngine) return joinPath(engines.myEngine().cwd(), "runtime/worker.js");
    } catch (ignore) {}
    return "runtime/worker.js";
  }

  function engineText(engine, methodName) {
    try {
      if (engine && typeof engine[methodName] === "function") return String(engine[methodName]() || "");
    } catch (ignore) {}
    return "";
  }

  function engineSourcePath(engine) {
    var source = null;
    try {
      if (engine && typeof engine.getSource === "function") source = engine.getSource();
      else if (engine && engine.source) source = engine.source;
    } catch (ignore) {}
    if (source !== null && source !== undefined) {
      if (typeof source === "string") return source;
      var methods = ["getFullPath", "getPath", "getName", "toString"];
      for (var i = 0; i < methods.length; i += 1) {
        try {
          if (typeof source[methods[i]] === "function") {
            var value = String(source[methods[i]]() || "");
            if (value) return value;
          }
        } catch (ignoreSource) {}
      }
    }
    return engineText(engine, "getSource");
  }

  function isWorkerEngine(engine, path) {
    var source = engineSourcePath(engine).replace(/\\/g, "/").toLowerCase();
    var wanted = String(path || "").replace(/\\/g, "/").toLowerCase();
    return !!source && (source === wanted || source.slice(-wanted.length) === wanted || source.indexOf("/runtime/worker.js") >= 0);
  }

  function runningWorkerEngineCount(path) {
    var count = 0;
    try {
      if (typeof engines !== "undefined" && typeof engines.all === "function") {
        var all = engines.all() || [];
        for (var i = 0; i < all.length; i += 1) if (isWorkerEngine(all[i], path)) count += 1;
      }
    } catch (ignore) {}
    return count;
  }

  function runtimeLooksAlive(runtime) {
    var state = runtime.workerState;
    return ["STARTING", "READY", "MONITORING", "PROCESSING", "RECOVERING"].indexOf(state) >= 0 && runtime.heartbeatAt && Date.now() - runtime.heartbeatAt < 15000;
  }

  function acquireWorkerLaunchLease() {
    var runtime = store.getRuntime();
    var now = Date.now();
    if (runtime.launchLeaseUntil && runtime.launchLeaseUntil > now && runtime.launchLeaseOwner && runtime.launchLeaseOwner !== mainOwnerId) return false;
    store.setRuntime({ launchLeaseOwner: mainOwnerId, launchLeaseUntil: now + 8000 });
    return true;
  }

  function startWorker() {
    if (workerStartInFlight) return;
    var config = store.loadConfig();
    config.enabled = true;
    store.saveConfig(config);
    var runtime = store.getRuntime();
    var path = workerPath();
    var existingEngineCount = runningWorkerEngineCount(path);
    if (runtimeLooksAlive(runtime) || existingEngineCount > 0) {
      logger.detail("worker 已在运行，跳过重复启动", { workerState: runtime.workerState, heartbeatAt: runtime.heartbeatAt || 0, runningWorkerEngineCount: existingEngineCount });
      refresh();
      return;
    }
    if (!acquireWorkerLaunchLease()) {
      logger.detail("已有主进程正在启动 worker，跳过本次启动", { launchLeaseOwner: store.getRuntime().launchLeaseOwner });
      refresh();
      return;
    }
    workerStartInFlight = true;
    try {
      // main.js is the UI entry; start the worker through the AutoX engine API.
      if (typeof engines === "undefined" || typeof engines.execScriptFile !== "function") throw new Error("AutoX engines.execScriptFile API unavailable");
      var basePath = "";
      try { if (engines.myEngine) basePath = engines.myEngine().cwd(); } catch (ignore) {}
      workerExecution = engines.execScriptFile(path, basePath ? { path: [basePath], loopTimes: 0, interval: 1000 } : { loopTimes: 0, interval: 1000 });

      var runningEngineCount = 0;
      try { if (engines.all) runningEngineCount = engines.all().length; } catch (ignore2) {}
      logger.info("已启动独立自动化守护进程", { path: path, hasExecution: !!workerExecution, runningEngineCount: runningEngineCount, runningWorkerEngineCount: runningWorkerEngineCount(path), launchOwner: mainOwnerId });
    } catch (error) {
      store.setRuntime({ workerState: "ERROR", lastError: String(error), lastErrorAt: Date.now(), launchLeaseUntil: 0 });
      logger.error("worker 启动失败", { error: String(error) });
    } finally {
      workerStartInFlight = false;
    }
    refresh();
  }

  function workerIsDestroyed() {
    try {
      if (!workerExecution) return false;
      var engine = null;
      if (typeof workerExecution.engine === "function") engine = workerExecution.engine();
      else if (typeof workerExecution.getEngine === "function") engine = workerExecution.getEngine();
      return !!(engine && typeof engine.isDestroyed === "function" && engine.isDestroyed());
    } catch (ignore) {
      return false;
    }
  }
  function monitorWorker() {
    var config = store.loadConfig();
    if (!config.enabled) return;
    var runtime = store.getRuntime();
    var path = workerPath();
    var engineCount = runningWorkerEngineCount(path);
    if (runtimeLooksAlive(runtime) || engineCount > 0) return;
    if (workerExecution && !workerIsDestroyed()) {
      logger.detail("worker 心跳已超时，准备重新启动", { heartbeatAt: runtime.heartbeatAt || 0 });
    } else {
      logger.error("守护进程已退出，准备重新启动", {});
    }
    workerExecution = null;
    startWorker();
  }
  function stopWorker() {
    var stopCommand = { id: commandId(), type: "stop_worker", payload: {}, createdAt: Date.now() };
    store.setRuntime({ command: stopCommand });
    logger.detail("已写入 worker 停止命令", { commandId: stopCommand.id });
    var config = store.loadConfig();
    config.enabled = false;
    store.saveConfig(config);
    logger.info("请求停止 worker");
    refresh();
  }

  function commaList(value) {
    return String(value || "").split(",").map(function (item) { return item.trim(); }).filter(function (item) { return !!item; });
  }

  function saveMqttConfig() {
    var config = store.loadConfig();
    config.mqtt = config.mqtt || {};
    config.mqtt.serverUri = textOf(ui.mqttServer).trim();
    config.mqtt.clientId = textOf(ui.mqttClientId).trim();
    config.mqtt.username = textOf(ui.mqttUsername);
    config.mqtt.password = textOf(ui.mqttPassword);
    config.mqtt.commandTopic = textOf(ui.mqttCommandTopic).trim() || "wxbot/{clientId}/command";
    config.mqtt.eventTopic = textOf(ui.mqttEventTopic).trim() || "wxbot/{clientId}/event";
    store.saveConfig(config);
    ui.mqttStatus.setText("MQTT：配置已保存");
    logger.info("MQTT 配置已保存", { serverUri: config.mqtt.serverUri, clientId: config.mqtt.clientId });
    refresh();
  }

  function toggleMqtt() {
    var config = store.loadConfig();
    config.mqtt = config.mqtt || {};
    config.mqtt.enabled = !config.mqtt.enabled;
    store.saveConfig(config);
    if (config.mqtt.enabled) startWorker();
    logger.info(config.mqtt.enabled ? "MQTT 已启用" : "MQTT 已停用");
    refresh();
  }

  function saveReplyRule() {
    var config = store.loadConfig();
    var keyword = textOf(ui.replyKeyword);
    var reply = textOf(ui.replyText);
    if (!keyword || !reply) {
      ui.replyStatus.setText("关键词和回复内容不能为空");
      return;
    }
    config.privateChat.listenMode = textOf(ui.listenMode).toLowerCase() === "all" ? "all" : "whitelist";
    config.privateChat.whitelist = commaList(textOf(ui.whitelistInput));
    config.privateChat.blacklist = commaList(textOf(ui.blacklistInput));
    config.replyRules = config.replyRules || [];
    var existing = null;
    config.replyRules.forEach(function (rule) { if (rule.keyword === keyword) existing = rule; });
    if (existing) {
      existing.enabled = true;
      existing.match = "contains";
      existing.reply = reply;
      existing.cooldownSec = 30;
    } else {
      config.replyRules.push({ id: "rule-" + Date.now().toString(36), enabled: true, keyword: keyword, match: "contains", reply: reply, cooldownSec: 30 });
    }
    store.saveConfig(config);
    ui.replyStatus.setText("已保存：" + keyword);
    logger.info("回复规则已保存", { keyword: keyword });
    refresh();
  }

  function formatTask(task) {
    return task.target + " -> " + task.status + (task.nickname ? " (" + task.nickname + ")" : "") + (task.errorCode ? " [" + task.errorCode + "]" : "");
  }

  function refresh() {
    var config = store.loadConfig();
    var runtime = store.getRuntime();
    var counters = runtime.counters || { friendAddsToday: 0, repliesToday: 0 };
    ui.statusText.setText("状态：" + (runtime.workerState || "STOPPED") + (runtime.heartbeatAt ? " · 心跳 " + Math.max(0, Math.floor((Date.now() - runtime.heartbeatAt) / 1000)) + " 秒前" : ""));
    ui.counterText.setText("今日主动添加 " + (counters.friendAddsToday || 0) + " · 主动消息 " + (counters.proactiveMessagesToday || 0) + " · 回复 " + (counters.repliesToday || 0));
    ui.errorText.setText("最近错误：" + (runtime.lastError || "无"));
    var checks = health.check(config);
    ui.permissionText.setText("无障碍：" + checks.autoAccessibility.status + "；通知监听：" + checks.notificationListener.status + "；微信：" + checks.wechatInstalled.status);
    var mqttStatus = runtime.mqtt || {};
    var mqttLabel = !config.mqtt || !config.mqtt.enabled ? "已关闭" : (mqttStatus.connected ? "已连接" : (mqttStatus.connecting ? "连接中" : "未连接"));
    ui.mqttStatus.setText("MQTT：" + mqttLabel + (mqttStatus.lastError ? "；" + mqttStatus.lastError : "") + (mqttStatus.inboxSize ? "；待处理命令 " + mqttStatus.inboxSize : ""));
    ui.mqttToggleButton.setText(config.mqtt && config.mqtt.enabled ? "停用 MQTT" : "启用 MQTT");

    var result = runtime.commandResult;
    if (result && result.type === "add_friend_search" && result.result) {
      var searchResult = result.result;
      var task = searchResult.task || {};
      if (task.status === "waiting_confirm") {
        ui.friendConfirmButton.setEnabled(true);
        var found = searchResult.result || {};
        ui.friendResult.setText("已找到：" + (found.nickname || task.nickname || "未知") + "；目标：" + task.target + "。请确认发送。");
      } else {
        ui.friendConfirmButton.setEnabled(false);
        ui.friendResult.setText("搜索结果：" + (task.status || searchResult.guard && searchResult.guard.code || "失败") + (task.errorCode ? " [" + task.errorCode + "]" : ""));
      }
    }
    if (result && result.type === "add_friend_confirm" && result.result) {
      var confirmTask = result.result.task || {};
      ui.friendConfirmButton.setEnabled(false);
      ui.friendResult.setText("发送结果：" + (confirmTask.status || (result.result.ok ? "sent" : "failed")) + (confirmTask.errorCode ? " [" + confirmTask.errorCode + "]" : ""));
    }
    if (result && result.type === "read_current_friend_profile" && result.result) {
      var profileResult = result.result;
      if (profileResult.ok) {
        ui.friendProfileResult.setText("好友备注：" + (profileResult.chatName || "未知") + "；微信号：" + (profileResult.wechatId || "未知"));
      } else {
        ui.friendProfileResult.setText("读取失败：" + (profileResult.code || profileResult.errorCode || "UNKNOWN_ERROR"));
      }
    }
    if (result && result.type === "proactive_message_search" && result.result) {
      var messageSearchResult = result.result;
      var messageTask = messageSearchResult.task || {};
      if (messageTask.status === "waiting_confirm") {
        ui.messageConfirmButton.setEnabled(true);
        ui.messageResult.setText("已定位：" + (messageTask.matchedName || messageTask.target) + "；消息：" + messageTask.message + "。请确认发送。");
      } else {
        ui.messageConfirmButton.setEnabled(false);
        ui.messageResult.setText("定位结果：" + (messageTask.status || messageSearchResult.guard && messageSearchResult.guard.code || "失败") + (messageTask.errorCode ? " [" + messageTask.errorCode + "]" : ""));
      }
    }
    if (result && result.type === "proactive_message_confirm" && result.result) {
      var messageConfirmTask = result.result.task || {};
      ui.messageConfirmButton.setEnabled(false);
      ui.messageResult.setText("发送结果：" + (messageConfirmTask.status || (result.result.ok ? "sent" : "failed")) + (messageConfirmTask.errorCode ? " [" + messageConfirmTask.errorCode + "]" : ""));
    }

    var tasks = store.getTasks().slice(-5).reverse();
    var friendTasks = tasks.filter(function (task) { return !task.type || task.type === "friend_add"; });
    var messageTasks = tasks.filter(function (task) { return task.type === "proactive_message"; });
    ui.friendHistory.setText("最近任务：" + (friendTasks.length ? "\n" + friendTasks.map(formatTask).join("\n") : "无"));
    ui.messageHistory.setText("最近消息任务：" + (messageTasks.length ? "\n" + messageTasks.map(formatTask).join("\n") : "无"));
    var logs = store.getLogs().slice(-15).reverse().map(function (entry) { return logger.format(entry); });
    ui.logText.setText(logs.length ? logs.join("\n") : "暂无日志");
  }

  ui.startButton.on("click", startWorker);
  ui.stopButton.on("click", stopWorker);
  ui.accessibilityButton.on("click", function () { health.openAccessibilitySettings(); });
  ui.notificationButton.on("click", function () { health.openNotificationSettings(); });
  ui.friendSearchButton.on("click", function () {
    startWorker();
    writeCommand("add_friend_search", { target: textOf(ui.friendTarget), verifyText: textOf(ui.friendVerify), remark: textOf(ui.friendRemark) });
    ui.friendConfirmButton.setEnabled(false);
    ui.friendResult.setText("已提交搜索任务……");
    refresh();
  });
  ui.friendProfileButton.on("click", function () {
    startWorker();
    writeCommand("read_current_friend_profile", {});
    ui.friendProfileResult.setText("正在读取当前好友资料……");
    refresh();
  });
  ui.messageSearchButton.on("click", function () {
    var target = textOf(ui.messageTarget);
    var message = textOf(ui.messageText);
    if (!target || !message) {
      ui.messageResult.setText("完整备注名/微信号和消息内容不能为空");
      return;
    }
    startWorker();
    writeCommand("proactive_message_search", { target: target, message: message });
    ui.messageConfirmButton.setEnabled(false);
    ui.messageResult.setText("正在定位好友……");
    refresh();
  });
  ui.messageConfirmButton.on("click", function () {
    var pending = store.getRuntime().pendingProactiveMessageTaskId;
    if (!pending) { ui.messageResult.setText("没有待确认的消息任务"); return; }
    writeCommand("proactive_message_confirm", { taskId: pending });
    ui.messageConfirmButton.setEnabled(false);
    ui.messageResult.setText("正在发送消息……");
  });
  ui.messageCancelButton.on("click", function () {
    var pending = store.getRuntime().pendingProactiveMessageTaskId;
    if (pending) writeCommand("proactive_message_cancel", { taskId: pending });
    ui.messageConfirmButton.setEnabled(false);
    ui.messageResult.setText("已取消");
  });
  ui.friendConfirmButton.on("click", function () {
    var pending = store.getRuntime().pendingFriendTaskId;
    if (!pending) { ui.friendResult.setText("没有待确认的搜索结果"); return; }
    writeCommand("add_friend_confirm", { taskId: pending });
    ui.friendConfirmButton.setEnabled(false);
    ui.friendResult.setText("正在发送好友申请……");
  });
  ui.friendCancelButton.on("click", function () {
    var pending = store.getRuntime().pendingFriendTaskId;
    if (pending) writeCommand("add_friend_cancel", { taskId: pending });
    ui.friendConfirmButton.setEnabled(false);
    ui.friendResult.setText("已取消");
  });
  ui.mqttSaveButton.on("click", saveMqttConfig);
  ui.mqttToggleButton.on("click", toggleMqtt);
  ui.replySaveButton.on("click", saveReplyRule);
  ui.badgeScanOnlyButton.on("click", function () { applyBadgeScanOnly(!badgeScanOnly); });

  var initialConfig = store.loadConfig();
  badgeScanOnly = !!(initialConfig.privateChat && initialConfig.privateChat.badgeScanOnly);
  applyBadgeScanOnly(badgeScanOnly);
  ui.listenMode.setText(initialConfig.privateChat.listenMode || "whitelist");
  ui.whitelistInput.setText((initialConfig.privateChat.whitelist || []).join(","));
  ui.blacklistInput.setText((initialConfig.privateChat.blacklist || []).join(","));
  var initialMqtt = initialConfig.mqtt || {};
  ui.mqttServer.setText(initialMqtt.serverUri || "");
  ui.mqttClientId.setText(initialMqtt.clientId || "");
  ui.mqttUsername.setText(initialMqtt.username || "");
  ui.mqttPassword.setText(initialMqtt.password || "");
  ui.mqttCommandTopic.setText(initialMqtt.commandTopic || "wxbot/{clientId}/command");
  ui.mqttEventTopic.setText(initialMqtt.eventTopic || "wxbot/{clientId}/event");
  if (initialConfig.replyRules && initialConfig.replyRules[0]) {
    ui.replyKeyword.setText(initialConfig.replyRules[0].keyword || "");
    ui.replyText.setText(initialConfig.replyRules[0].reply || "");
  }
  refresh();
  setInterval(refresh, 1000);
  setInterval(monitorWorker, 3000);

}());










