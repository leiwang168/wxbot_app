(function () {
  "use strict";

  function uuid() {
    return "message-task-" + Date.now().toString(36) + "-" + Math.floor(Math.random() * 1000000).toString(36);
  }

  function dayKey(ts) {
    var date = new Date(ts || Date.now());
    return date.getFullYear() + "-" + (date.getMonth() + 1) + "-" + date.getDate();
  }

  function ProactiveMessageFlow(options) {
    options = options || {};
    this.store = options.store;
    this.adapter = options.adapter;
    this.logger = options.logger || { info: function () {}, warn: function () {}, error: function () {}, action: function () {}, detail: function () {} };
    this.screenshot = options.screenshot || null;
    this.clock = options.clock || function () { return Date.now(); };
  }

  ProactiveMessageFlow.prototype._detail = function (message, meta) {
    try {
      if (this.logger && typeof this.logger.detail === "function") this.logger.detail(message, meta || {});
    } catch (ignore) {}
  };

  ProactiveMessageFlow.prototype.config = function () {
    return this.store.loadConfig().proactiveMessage || {};
  };

  ProactiveMessageFlow.prototype._task = function (id) {
    var tasks = this.store.getTasks();
    for (var i = 0; i < tasks.length; i += 1) if (tasks[i].id === id) return tasks[i];
    return null;
  };

  ProactiveMessageFlow.prototype._todayCount = function () {
    var today = dayKey(this.clock());
    return this.store.getTasks().filter(function (task) {
      return task.type === "proactive_message" &&
        dayKey(task.attemptedAt || task.createdAt) === today &&
        ["sent", "sending", "rate_limited", "failed"].indexOf(task.status) >= 0;
    }).length;
  };

  ProactiveMessageFlow.prototype._guard = function () {
    var cfg = this.config();
    if (!cfg.enabled) return { ok: false, code: "PROACTIVE_MESSAGE_DISABLED", reason: "主动发消息已关闭" };
    var runtime = this.store.getRuntime();
    if (runtime.proactiveMessageRateLimitedUntil && runtime.proactiveMessageRateLimitedUntil > this.clock()) {
      return { ok: false, code: "WECHAT_RATE_LIMITED", retryAfter: runtime.proactiveMessageRateLimitedUntil - this.clock() };
    }
    if (this._todayCount() >= Number(cfg.dailyLimit || 20)) {
      return { ok: false, code: "PROACTIVE_MESSAGE_DAILY_LIMIT_REACHED", reason: "已达到每日主动发消息上限" };
    }
    if (runtime.lastProactiveMessageAt && this.clock() - runtime.lastProactiveMessageAt < Number(cfg.normalIntervalSec || 30) * 1000) {
      return {
        ok: false,
        code: "PROACTIVE_MESSAGE_COOLDOWN",
        retryAfter: Number(cfg.normalIntervalSec || 30) * 1000 - (this.clock() - runtime.lastProactiveMessageAt)
      };
    }
    return { ok: true };
  };

  ProactiveMessageFlow.prototype._newTask = function (payload) {
    return {
      id: uuid(),
      type: "proactive_message",
      target: String(payload.target || "").trim(),
      message: String(payload.message || ""),
      status: "searching",
      matchedName: "",
      matchedWechatId: "",
      errorCode: "",
      createdAt: this.clock(),
      attemptedAt: 0,
      finishedAt: 0
    };
  };

  ProactiveMessageFlow.prototype._fail = function (task, code, status) {
    task.status = status || "failed";
    task.errorCode = code || "UNKNOWN";
    task.finishedAt = this.clock();
    this.store.updateTask(task.id, task);
    this.logger.warn("主动发消息失败: " + task.target + " " + task.errorCode, { taskId: task.id });
    return task;
  };

  ProactiveMessageFlow.prototype._rateLimit = function (task, reason) {
    var cfg = this.config();
    task.status = "rate_limited";
    task.errorCode = "WECHAT_RATE_LIMITED";
    task.finishedAt = this.clock();
    task.attemptedAt = task.attemptedAt || this.clock();
    this.store.updateTask(task.id, task);
    this.store.setRuntime({
      proactiveMessageRateLimitedUntil: this.clock() + Number(cfg.rateLimitCooldownSec || 3600) * 1000,
      proactiveMessageRateLimitReason: reason || "微信提示操作过于频繁"
    });
    try {
      if (this.screenshot && typeof this.screenshot.saveFailureScreenshot === "function") this.screenshot.saveFailureScreenshot("proactive-message-rate-limited");
    } catch (ignore) {}
    this.logger.warn("主动发消息触发微信限流，已暂停", { taskId: task.id, reason: reason || "" });
    return task;
  };

  ProactiveMessageFlow.prototype.search = function (payload) {
    payload = payload || {};
    var guard = this._guard();
    if (!guard.ok) {
      this.logger.warn("主动发消息被安全策略拦截", guard);
      return { ok: false, guard: guard };
    }
    if (!payload.target || !String(payload.target).trim()) return { ok: false, guard: { code: "TARGET_REQUIRED", reason: "请输入完整备注名或微信号" } };
    if (!payload.message || !String(payload.message).trim()) return { ok: false, guard: { code: "MESSAGE_REQUIRED", reason: "请输入要发送的消息" } };

    var task = this._newTask(payload);
    this.store.addTask(task);
    this.logger.action("开始定位主动发消息目标", { taskId: task.id, target: task.target });
    try {
      var opened = this.adapter.openChatByTarget(task.target);
      if (!opened || !opened.ok) return { ok: false, task: this._fail(task, opened && opened.code || "TARGET_CHAT_NOT_FOUND") };
      task.matchedName = String(opened.chatName || opened.matchedName || "");
      task.matchedWechatId = String(opened.wechatId || "");
      task.status = "waiting_confirm";
      this.store.updateTask(task.id, task);
      this.store.setRuntime({ pendingProactiveMessageTaskId: task.id, lastProactiveMessageSearch: opened });
      this.logger.info("已定位主动发消息目标，等待用户二次确认", { taskId: task.id, target: task.target, matchedName: task.matchedName });
      return { ok: true, task: task, result: opened };
    } catch (error) {
      return { ok: false, task: this._fail(task, "TARGET_SEARCH_EXCEPTION"), error: String(error) };
    }
  };

  ProactiveMessageFlow.prototype.confirm = function (taskId) {
    var task = this._task(taskId);
    if (!task) return { ok: false, errorCode: "TASK_NOT_FOUND" };
    if (task.type !== "proactive_message") return { ok: false, errorCode: "TASK_TYPE_INVALID", task: task };
    if (task.status !== "waiting_confirm") return { ok: false, errorCode: "TASK_NOT_CONFIRMABLE", task: task };
    var cfg = this.config();
    if (cfg.requireConfirm === false) this._detail("主动发消息配置允许跳过二次确认", { taskId: task.id });
    this.logger.action("用户确认主动发消息", { taskId: task.id, target: task.target });
    try {
      if (this.adapter.verifyCurrentChatTarget) {
        var verified = this.adapter.verifyCurrentChatTarget(task.target, task.matchedName);
        if (!verified || !verified.ok) return { ok: false, task: this._fail(task, verified && verified.code || "CHAT_TARGET_CHANGED") };
      }
      task.status = "sending";
      task.attemptedAt = this.clock();
      this.store.updateTask(task.id, task);
      var sent = this.adapter.sendText(task.message);
      if (!sent || !sent.ok) {
        if (sent && sent.code === "WECHAT_RATE_LIMITED") return { ok: false, task: this._rateLimit(task, sent.code) };
        return { ok: false, task: this._fail(task, sent && sent.code || "SEND_FAILED") };
      }
      task.status = "sent";
      task.finishedAt = this.clock();
      task.errorCode = "";
      this.store.updateTask(task.id, task);
      this.store.setRuntime({ lastProactiveMessageAt: this.clock(), pendingProactiveMessageTaskId: "", lastProactiveMessageResult: task });
      this.logger.info("主动消息已发送", { taskId: task.id, target: task.target, matchedName: task.matchedName });
      return { ok: true, task: task };
    } catch (error) {
      return { ok: false, task: this._fail(task, "SEND_EXCEPTION"), error: String(error) };
    }
  };

  ProactiveMessageFlow.prototype.cancel = function (taskId) {
    var task = this._task(taskId);
    this._detail("收到取消主动发消息任务请求", { taskId: taskId, currentStatus: task && task.status || "not_found" });
    if (!task || task.type !== "proactive_message") return false;
    if (["waiting_confirm", "searching"].indexOf(task.status) < 0) return false;
    task.status = "cancelled";
    task.finishedAt = this.clock();
    this.store.updateTask(task.id, task);
    this.store.setRuntime({ pendingProactiveMessageTaskId: "" });
    return true;
  };

  if (typeof module !== "undefined" && module.exports) {
    module.exports = { ProactiveMessageFlow: ProactiveMessageFlow, dayKey: dayKey };
  } else {
    this.WxBotProactiveMessageFlow = { ProactiveMessageFlow: ProactiveMessageFlow, dayKey: dayKey };
  }
}());
