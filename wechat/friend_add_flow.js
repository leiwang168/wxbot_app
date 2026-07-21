(function () {
  "use strict";

  function uuid() {
    return "task-" + Date.now().toString(36) + "-" + Math.floor(Math.random() * 1000000).toString(36);
  }

  function dayKey(ts) {
    var date = new Date(ts || Date.now());
    return date.getFullYear() + "-" + (date.getMonth() + 1) + "-" + date.getDate();
  }

  function FriendAddFlow(options) {
    options = options || {};
    this.store = options.store;
    this.adapter = options.adapter;
    this.logger = options.logger || { info: function () {}, warn: function () {}, error: function () {}, action: function () {}, detail: function () {} };
    this.screenshot = options.screenshot || null;
    this.clock = options.clock || function () { return Date.now(); };
  }

  FriendAddFlow.prototype._detail = function (message, meta) {
    try {
      if (this.logger && typeof this.logger.detail === "function") this.logger.detail(message, meta || {});
    } catch (ignore) {}
  };

  FriendAddFlow.prototype.config = function () {
    return this.store.loadConfig().friendAdd || {};
  };

  FriendAddFlow.prototype._task = function (id) {
    var tasks = this.store.getTasks();
    for (var i = 0; i < tasks.length; i += 1) if (tasks[i].id === id) return tasks[i];
    return null;
  };

  FriendAddFlow.prototype._todayCount = function () {
    var today = dayKey(this.clock());
    return this.store.getTasks().filter(function (task) {
      return (!task.type || task.type === "friend_add") && dayKey(task.attemptedAt || task.createdAt) === today && ["sent", "submitting", "rate_limited", "failed"].indexOf(task.status) >= 0;
    }).length;
  };

  FriendAddFlow.prototype._guard = function () {
    var cfg = this.config();
    if (!cfg.enabled) return { ok: false, code: "FRIEND_ADD_DISABLED", reason: "主动添加好友已关闭" };
    var runtime = this.store.getRuntime();
    if (runtime.friendRateLimitedUntil && runtime.friendRateLimitedUntil > this.clock()) {
      return { ok: false, code: "WECHAT_RATE_LIMITED", retryAfter: runtime.friendRateLimitedUntil - this.clock() };
    }
    if (this._todayCount() >= Number(cfg.dailyLimit || 20)) {
      return { ok: false, code: "FRIEND_DAILY_LIMIT_REACHED", reason: "已达到每日主动添加上限" };
    }
    if (runtime.lastFriendAddAt && this.clock() - runtime.lastFriendAddAt < Number(cfg.normalIntervalSec || 60) * 1000) {
      return { ok: false, code: "FRIEND_ADD_COOLDOWN", retryAfter: Number(cfg.normalIntervalSec || 60) * 1000 - (this.clock() - runtime.lastFriendAddAt) };
    }
    return { ok: true };
  };

  FriendAddFlow.prototype._newTask = function (payload) {
    return {
      id: uuid(),
      type: "friend_add",
      target: String(payload.target || "").trim(),
      verifyText: String(payload.verifyText || ""),
      remark: String(payload.remark || ""),
      status: "searching",
      nickname: "",
      errorCode: "",
      retryCount: 0,
      createdAt: this.clock(),
      finishedAt: 0,
      attemptedAt: 0
    };
  };

  FriendAddFlow.prototype._fail = function (task, code, status) {
    status = status || "failed";
    task.status = status;
    task.errorCode = code || "UNKNOWN";
    task.finishedAt = this.clock();
    this.store.updateTask(task.id, task);
    this.logger.warn("主动添加好友失败: " + task.target + " " + task.errorCode, { taskId: task.id });
    return task;
  };

  FriendAddFlow.prototype._rateLimit = function (task, reason) {
    var cfg = this.config();
    task.status = "rate_limited";
    task.errorCode = "WECHAT_RATE_LIMITED";
    task.finishedAt = this.clock();
    task.attemptedAt = task.attemptedAt || this.clock();
    this.store.updateTask(task.id, task);
    var screenshotPath = "";
    try { if (this.screenshot && typeof this.screenshot.saveFailureScreenshot === "function") screenshotPath = this.screenshot.saveFailureScreenshot("friend-add-rate-limited"); } catch (ignore) {}
    this.store.setRuntime({
      friendRateLimitedUntil: this.clock() + Number(cfg.rateLimitCooldownSec || 3600) * 1000,
      friendRateLimitReason: reason || "微信提示操作过于频繁"
    });
    this.logger.warn("主动添加好友触发微信限流，已暂停", { taskId: task.id, reason: reason || "" });
    return task;
  };

  FriendAddFlow.prototype.search = function (payload) {
    payload = payload || {};
    var guard = this._guard();
    if (!guard.ok) {
      this.logger.warn("主动添加好友被安全策略拦截", guard);
      return { ok: false, guard: guard };
    }
    if (!payload.target || !String(payload.target).trim()) return { ok: false, guard: { code: "TARGET_REQUIRED", reason: "请输入微信号或wxid" } };
    var task = this._newTask(payload);
    this.store.addTask(task);
    this.logger.action("开始搜索主动添加目标", { taskId: task.id, target: task.target });
    try {
      var opened = this.adapter.openAddFriend();
      if (!opened || !opened.ok) return { ok: false, task: this._fail(task, opened && opened.code || "ADD_FRIEND_ENTRY_NOT_FOUND") };
      var searched = this.adapter.searchFriend(task.target);
      if (!searched || !searched.ok) {
        if (searched && searched.code === "WECHAT_RATE_LIMITED") return { ok: false, task: this._rateLimit(task, searched.code) };
        return { ok: false, task: this._fail(task, searched && searched.code || "SEARCH_FAILED") };
      }
      var result = this.adapter.readSearchResult(task.target) || { status: "not_found" };
      this._detail("主动添加搜索结果已返回", { taskId: task.id, status: result.status, nickname: result.nickname || "", candidateCount: result.candidates ? result.candidates.length : 0 });
      task.nickname = result.nickname || "";
      if (result.status === "not_found") return { ok: false, task: this._fail(task, "TARGET_NOT_FOUND", "not_found"), result: result };
      if (result.status === "ambiguous") return { ok: false, task: this._fail(task, "AMBIGUOUS_SEARCH_RESULT", "ambiguous"), result: result };
      task.status = "waiting_confirm";
      this.store.updateTask(task.id, task);
      this.store.setRuntime({ pendingFriendTaskId: task.id, lastFriendSearch: result });
      this.logger.info("搜索到唯一可信目标，等待用户二次确认", { taskId: task.id, target: task.target, nickname: task.nickname });
      return { ok: true, task: task, result: result };
    } catch (error) {
      return { ok: false, task: this._fail(task, "SEARCH_EXCEPTION"), error: String(error) };
    }
  };

  FriendAddFlow.prototype.confirm = function (taskId) {
    var task = this._task(taskId);
    if (!task) return { ok: false, errorCode: "TASK_NOT_FOUND" };
    if (task.status !== "waiting_confirm") return { ok: false, errorCode: "TASK_NOT_CONFIRMABLE", task: task };
    var cfg = this.config();
    this.logger.action("用户确认发送好友申请", { taskId: task.id, target: task.target });
    try {
      task.status = "filling_request";
      this.store.updateTask(task.id, task);
      this._detail("进入好友申请表单填写状态", { taskId: task.id });
      var filled = this.adapter.fillFriendRequest(task.verifyText, task.remark);
      if (!filled || !filled.ok) return { ok: false, task: this._fail(task, filled && filled.code || "REQUEST_FORM_FAILED") };
      task.status = "submitting";
      task.attemptedAt = this.clock();
      task.retryCount += 1;
      this.store.updateTask(task.id, task);
      this._detail("进入好友申请提交状态", { taskId: task.id, retryCount: task.retryCount });
      var submitted = this.adapter.submitFriendRequest();
      if (!submitted || !submitted.ok) {
        if (submitted && submitted.code === "WECHAT_RATE_LIMITED") return { ok: false, task: this._rateLimit(task, submitted.code) };
        return { ok: false, task: this._fail(task, submitted && submitted.code || "SUBMIT_FAILED") };
      }
      task.status = "sent";
      task.finishedAt = this.clock();
      task.errorCode = "";
      this.store.updateTask(task.id, task);
      this.store.setRuntime({ lastFriendAddAt: this.clock(), pendingFriendTaskId: "", lastFriendResult: task });
      this.logger.info("好友申请已发送", { taskId: task.id, target: task.target });
      return { ok: true, task: task };
    } catch (error) {
      return { ok: false, task: this._fail(task, "SUBMIT_EXCEPTION"), error: String(error) };
    }
  };

  FriendAddFlow.prototype.cancel = function (taskId) {
    var task = this._task(taskId);
    this._detail("收到取消主动添加任务请求", { taskId: taskId, currentStatus: task && task.status || "not_found" });
    if (!task) return false;
    if (["waiting_confirm", "searching"].indexOf(task.status) < 0) return false;
    task.status = "cancelled";
    task.finishedAt = this.clock();
    this.store.updateTask(task.id, task);
    this.store.setRuntime({ pendingFriendTaskId: "" });
    return true;
  };

  if (typeof module !== "undefined" && module.exports) {
    module.exports = { FriendAddFlow: FriendAddFlow, dayKey: dayKey };
  } else {
    this.WxBotFriendAddFlow = { FriendAddFlow: FriendAddFlow, dayKey: dayKey };
  }
}());
