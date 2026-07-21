"auto";
(function () {
  "use strict";

  var defaults = require("../config/defaults");
  var migrations = require("../storage/migrations");
  var Store = require("../storage/store").Store;
  var Logger = require("../diagnostics/logger").Logger;
  var Dedupe = require("../rules/dedupe").Dedupe;
  var ReplyEngine = require("../rules/reply_engine").ReplyEngine;
  var StateMachine = require("./state_machine").StateMachine;
  var TaskQueue = require("./task_queue").TaskQueue;
  var Controller = require("./controller").Controller;
  var Adapter = require("../wechat/adapter").Adapter;
  var FriendAddFlow = require("../wechat/friend_add_flow").FriendAddFlow;
  var screenshot = require("../diagnostics/screenshot");

  var store = new Store("wxbot.app.v1", defaults, migrations);
  var logger = new Logger(store, { limit: store.loadConfig().diagnostics.keepLogCount, logFile: "./logs/runtime.log" });
  try { if (typeof console !== "undefined" && console.show) console.show(); } catch (ignoreConsole) {}
  var adapter = new Adapter({ packageName: store.loadConfig().wechatPackage, logger: logger });
  var queue = new TaskQueue();
  var machine = new StateMachine("STOPPED", function (next, previous) {
    store.setRuntime({ workerState: next, previousWorkerState: previous });
  });
  var controller = new Controller({ store: store, logger: logger, queue: queue, machine: machine });
  var dedupe = new Dedupe(store, 60000);
  var friendFlow = new FriendAddFlow({ store: store, adapter: adapter, logger: logger, screenshot: screenshot });
  var processedCommandId = "";
  var lastChatPollAt = 0;
  var workerTimer = null;
  var workerStopped = false;
  var workerId = "worker-" + Date.now().toString(36) + "-" + Math.floor(Math.random() * 100000).toString(36);
  try {
    if (typeof engines !== "undefined" && engines.myEngine) {
      var myEngine = engines.myEngine();
      if (myEngine && typeof myEngine.getId === "function") workerId = "engine-" + String(myEngine.getId());
      else if (myEngine && typeof myEngine.id === "function") workerId = "engine-" + String(myEngine.id());
    }
  } catch (ignoreWorkerId) {}

  function safeValue(value) {
    try { return value === null || value === undefined ? "" : String(value); } catch (ignore) { return ""; }
  }

  function notificationPackage(notification) {
    try {
      if (notification.getPackageName) return safeValue(notification.getPackageName());
      if (notification.getPackage) return safeValue(notification.getPackage());
      if (notification.packageName) return safeValue(notification.packageName);
    } catch (ignore) {}
    return "";
  }

  function notificationTitle(notification) {
    try {
      if (notification.getTitle) return safeValue(notification.getTitle());
      if (notification.getTitleText) return safeValue(notification.getTitleText());
      if (notification.title) return safeValue(notification.title);
    } catch (ignore) {}
    return "";
  }

  function notificationText(notification) {
    try {
      if (notification.getText) return safeValue(notification.getText());
      if (notification.getTextLines) return safeValue(notification.getTextLines());
      if (notification.text) return safeValue(notification.text);
    } catch (ignore) {}
    return "";
  }

  function randomDelay(config) {
    var delay = config.replyDelay || {};
    if (!delay.enabled) return 0;
    var min = Math.max(0, Number(delay.minSec || 0));
    var max = Math.max(min, Number(delay.maxSec || min));
    return Math.floor((min + Math.random() * (max - min + 0.001)) * 1000);
  }

  function sleepSafe(ms) {
    try { if (ms > 0 && typeof sleep === "function") sleep(ms); } catch (ignore) {}
  }

  function updateCounters(patch) {
    var runtime = store.getRuntime();
    var counters = runtime.counters || { repliesToday: 0, friendAddsToday: 0 };
    Object.keys(patch || {}).forEach(function (key) { counters[key] = Number(counters[key] || 0) + Number(patch[key] || 0); });
    store.setRuntime({ counters: counters });
  }

  function stopSelf(reason) {
    if (workerStopped) return;
    workerStopped = true;
    try {
      var runtime = store.getRuntime();
      if (runtime.workerOwnerId === workerId) store.setRuntime({ workerOwnerId: "", workerLeaseUntil: 0, workerStoppedAt: Date.now() });
    } catch (ignoreRelease) {}
    if (reason) logger.detail("工作进程结束", { reason: reason, workerId: workerId });
    try { if (workerTimer && typeof clearInterval === "function") clearInterval(workerTimer); } catch (ignoreTimer) {}
    try { if (typeof exit === "function") exit(); } catch (ignoreExit) {}
    try {
      if (typeof engines !== "undefined" && engines.myEngine) {
        var current = engines.myEngine();
        if (current && typeof current.forceStop === "function") current.forceStop();
      }
    } catch (ignoreForceStop) {}
  }

  function claimWorkerLease() {
    var runtime = store.getRuntime();
    var now = Date.now();
    if (runtime.workerOwnerId && runtime.workerOwnerId !== workerId && runtime.heartbeatAt && now - runtime.heartbeatAt < 15000) {
      logger.warn("检测到已有 worker，当前实例退出", { existingWorkerId: runtime.workerOwnerId, heartbeatAt: runtime.heartbeatAt });
      return false;
    }
    store.setRuntime({ workerOwnerId: workerId, workerLeaseUntil: now + 15000, workerStartedAt: now, heartbeatAt: now });
    // storages.set/get is not a transaction. Re-read immediately so two workers
    // started in the same moment converge on the last persisted owner.
    var confirmed = store.getRuntime();
    if (confirmed.workerOwnerId !== workerId) {
      logger.warn("工作进程租约竞争，当前实例退出", { existingWorkerId: confirmed.workerOwnerId || "" });
      return false;
    }
    return true;
  }

  function ownsWorkerLease() {
    var runtime = store.getRuntime();
    var now = Date.now();
    if (runtime.workerOwnerId && runtime.workerOwnerId !== workerId && runtime.heartbeatAt && now - runtime.heartbeatAt < 15000) return false;
    store.setRuntime({ workerOwnerId: workerId, workerLeaseUntil: now + 15000, heartbeatAt: now });
    var confirmed = store.getRuntime();
    return confirmed.workerOwnerId === workerId;
  }
  function handleMessageNotification(notification, title, preview, alreadyInChat) {
    var config = store.loadConfig();
    if (!config.privateChat.enabled) return;
    if (!alreadyInChat) {
      var opened = adapter.openChatFromNotification(notification);
      if (!opened || !opened.ok) {
        logger.warn("无法打开通知对应的私聊", { code: opened && opened.code || "UNKNOWN" });
        return;
      }
    }
    var message = adapter.readLatestMessage(title);
    if (!message || !message.ok) {
      logger.warn("无法读取最新私聊消息", { code: message && message.code || "MESSAGE_NOT_FOUND" });
      return;
    }
    var event = {
      chatName: message.chatName || title,
      text: message.text || preview,
      direction: message.direction || "unknown",
      observedAt: message.observedAt || Date.now(),
      senderName: title
    };
    logger.info("收到微信私信消息", { chatName: event.chatName, text: event.text, direction: event.direction });
    var dedupeKey = dedupe.keyForMessage(event);
    if (dedupe.seen(dedupeKey)) {
      logger.debug("忽略重复私聊消息", { chatName: event.chatName });
      return;
    }
    // Keep the original message text in the file log, but only after dedupe so
    // foreground polling does not append the same bubble every few seconds.
    logger.logLine("[INFO] WECHAT_PRIVATE_MESSAGE " + JSON.stringify({ chatName: event.chatName, text: event.text, direction: event.direction }));
    var decision = new ReplyEngine(config).match(event);
    if (decision.action !== "reply") {
      logger.debug("私聊消息不触发回复", { reason: decision.reason, chatName: event.chatName });
      return;
    }
    var runtime = store.getRuntime();
    var cooldowns = runtime.replyCooldowns || {};
    var last = cooldowns[decision.cooldownKey] || 0;
    if (decision.rule.cooldownSec && Date.now() - last < Number(decision.rule.cooldownSec) * 1000) {
      logger.debug("关键词回复处于冷却中", { key: decision.cooldownKey });
      return;
    }
    var delayMs = randomDelay(config);
    logger.detail("等待私聊回复延迟", { delayMs: delayMs, chatName: event.chatName, ruleId: decision.rule.id });
    sleepSafe(delayMs);
    if (adapter.isRateLimited()) {
      logger.warn("发送回复前检测到微信风控提示");
      return;
    }
    var sent = adapter.sendText(decision.text);
    if (!sent || !sent.ok) {
      logger.error("私聊回复发送失败", { code: sent && sent.code || "SEND_FAILED" });
      if (config.diagnostics.saveFailureScreenshot) screenshot.saveFailureScreenshot("reply-failed");
      return;
    }
    cooldowns[decision.cooldownKey] = Date.now();
    store.setRuntime({ replyCooldowns: cooldowns, lastMessageAt: Date.now(), lastReply: { chatName: event.chatName, text: decision.text } });
    updateCounters({ repliesToday: 1 });
    logger.info("关键词回复已发送", { chatName: event.chatName, ruleId: decision.rule.id });
  }
  function processNotification(notification) {
    var config = store.loadConfig();
    var packageName = notificationPackage(notification);
    if (packageName !== config.wechatPackage) return;
    var title = notificationTitle(notification);
    var preview = notificationText(notification);
    if (!title && !preview) return;
    logger.detail("收到微信通知唤醒信号", { title: title, hasPreview: !!preview, packageName: packageName });
    controller.enqueue("private_message", function () {
      try {
        if (machine.state === "MONITORING") machine.transition("PROCESSING");
        handleMessageNotification(notification, title, preview, false);
      } catch (error) {
        logger.error("处理私聊通知异常", { error: String(error) });
        if (config.diagnostics.saveFailureScreenshot) screenshot.saveFailureScreenshot("notification-error");
      } finally {
        try {
          if (machine.state === "PROCESSING") machine.transition("MONITORING");
        } catch (ignore) {}
      }
    }, { title: title });
  }

  function pollWechatMessages() {
    try {
      if (!adapter.isWechatForeground()) return;
      var privateChatConfig = store.loadConfig().privateChat;
      if (!privateChatConfig.enabled) return;
      controller.enqueue("private_message_poll", function () {
        try {
          if (machine.state === "MONITORING") machine.transition("PROCESSING");

          // When WeChat is foreground, notification callbacks are not reliable.
          // Diagnostic mode deliberately stops after badge recognition and never opens a contact chat.
          if (privateChatConfig.badgeScanOnly) {
            var scanOnly = adapter.scanUnreadBadges ? adapter.scanUnreadBadges() : { ok: false, code: "BADGE_SCAN_API_UNAVAILABLE", clicked: false };
            logger.detail("微信前台角标扫描模式完成（未点击联系人）", { code: scanOnly.code, badgeCount: (scanOnly.badges || []).length, clicked: !!scanOnly.clicked });
            return;
          }
          // Chat page: read the newest bubble. Chat list: click the first unread badge, then read it.
          var inChat = adapter.isChatScreen();
          if (!inChat) {
            var opened = adapter.openFirstUnreadChat();
            if (!opened || !opened.ok) {
              logger.debug("微信前台轮询未打开未读对话", { code: opened && opened.code || "UNKNOWN" });
              return;
            }
            logger.detail("微信聊天列表检测到未读角标并进入会话", { unreadCount: opened.unreadCount || 0 });
            inChat = adapter.isChatScreen();
          }
          if (!inChat) {
            logger.debug("已点击未读角标但未确认进入聊天页");
            return;
          }

          var chatName = adapter.readCurrentChatName ? adapter.readCurrentChatName() : "";
          var latest = adapter.readLatestMessage(chatName);
          if (latest && latest.ok) {
            handleMessageNotification(null, latest.chatName || chatName || "当前聊天", latest.text, true);
          }
          // Always return to the conversation list so the next poll can scan other chats.
          if (adapter.openConversationList) adapter.openConversationList();
        } finally {
          if (machine.state === "PROCESSING") machine.transition("MONITORING");
        }
      }, { source: "wechat_foreground" });
    } catch (error) {
      logger.debug("微信前台消息轮询异常", { error: String(error) });
    }
  }

  function processCommand(command) {
    if (!command || !command.id || command.id === processedCommandId) return;
    processedCommandId = command.id;
    var payload = command.payload || {};
    logger.detail("收到 runtime 命令并加入串行队列", { commandType: command.type, commandId: command.id });
    controller.enqueue(command.type, function () {
      var result;
      logger.action("开始执行 runtime 命令", { commandType: command.type, commandId: command.id });
      try {
        if (command.type === "add_friend_search") result = friendFlow.search(payload);
        else if (command.type === "add_friend_confirm") result = friendFlow.confirm(payload.taskId);
        else if (command.type === "add_friend_cancel") result = { ok: friendFlow.cancel(payload.taskId) };
        else if (command.type === "scan_wechat_badges") {
          result = adapter.scanUnreadBadges ? adapter.scanUnreadBadges() : { ok: false, code: "BADGE_SCAN_API_UNAVAILABLE", clicked: false, badges: [] };
        } else if (command.type === "read_current_friend_profile") {
          result = adapter.readCurrentFriendProfile
            ? adapter.readCurrentFriendProfile()
            : { ok: false, code: "PROFILE_API_UNAVAILABLE" };
        } else if (command.type === "reset_rate_limit") {
          store.setRuntime({ friendRateLimitedUntil: 0, friendRateLimitReason: "" });
          logger.info("已手动清除主动添加冷却");
          result = { ok: true };
        } else if (command.type === "stop_worker") {
          result = { ok: controller.stop() };
        } else result = { ok: false, errorCode: "UNKNOWN_COMMAND" };
      } catch (error) {
        result = { ok: false, errorCode: "COMMAND_EXCEPTION", error: String(error) };
        logger.error("runtime 命令异常", result);
      }
      logger.action("runtime 命令执行完成", { commandType: command.type, commandId: command.id, ok: !!(result && result.ok), errorCode: result && result.errorCode || "" });
      store.setRuntime({ commandResult: { id: command.id, type: command.type, result: result, finishedAt: Date.now() }, command: null });
      if (command.type === "stop_worker") stopSelf("runtime_command_stop");
    }, payload);
  }

  function tick() {
    try {
      processCommand(store.getRuntime().command);
      var drained = controller.tick();
      if (drained > 0) logger.detail("worker 处理串行任务", { drained: drained, queueSize: queue.size() });
    } catch (error) {
      controller.fail(error);
    }
  }

  function tryStart() {
    if (!claimWorkerLease()) {
      stopSelf("duplicate_worker");
      return false;
    }
    var accessibility = adapter.ensureAccessibility();
    if (!accessibility.ok) {
      store.setRuntime({ workerState: "ERROR", lastError: accessibility.code, lastErrorAt: Date.now(), heartbeatAt: Date.now() });
      logger.error("无障碍服务不可用，等待重试", accessibility);
      return false;
    }
    if (machine.state === "STOPPED" || machine.state === "ERROR") controller.start();
    try {
      if (typeof events !== "undefined" && events.observeNotification && !tryStart.notificationObserved) {
        events.observeNotification();
        if (typeof events.onNotification === "function") {
          events.onNotification(function (notification) {
            processNotification(notification);
          });
        } else if (typeof events.on === "function") {
          events.on("notification", function (notification) {
            processNotification(notification);
          });
        } else {
          throw new Error("通知监听回调 API 不可用");
        }
        tryStart.notificationObserved = true;
        logger.info("微信通知监听已启动");
      }
    } catch (error) {
      logger.error("通知监听启动失败", { error: String(error) });
    }
    return true;
  }

  // 不使用 while(true)：AutoX 的通知回调与脚本主体共用事件线程，阻塞主体会导致
  // notification 事件无法派发。定时器既能保持 worker 存活，也不会阻塞通知事件。
  tryStart();
  workerTimer = setInterval(function () {
    try {
      if (workerStopped) return;
      if (!ownsWorkerLease()) {
        stopSelf("worker_lease_lost");
        return;
      }
      // Consume stop_worker before checking enabled, so the stop command cannot remain stuck in storage.
      processCommand(store.getRuntime().command);
      if (workerStopped) return;
      var currentConfig = store.loadConfig();
      if (!currentConfig.enabled) {
        if (machine.state !== "STOPPED") controller.stop();
        stopSelf("config_disabled");
        return;
      }
      var drained = controller.tick();
      if (drained > 0) logger.detail("worker 处理串行任务", { drained: drained, queueSize: queue.size() });
      if (Date.now() - lastChatPollAt >= 2000) {
        lastChatPollAt = Date.now();
        pollWechatMessages();
      }
      store.setRuntime({ heartbeatAt: Date.now(), workerLeaseUntil: Date.now() + 15000, queueSize: queue.size() });
    } catch (error) {
      controller.fail(error);
    }
  }, 500);
}());











