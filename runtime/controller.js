(function () {
  "use strict";

  function Controller(options) {
    options = options || {};
    this.store = options.store;
    this.logger = options.logger;
    this.queue = options.queue;
    this.machine = options.machine;
    this.clock = options.clock || function () { return Date.now(); };
  }

  Controller.prototype.start = function () {
    if (this.machine.state !== "STOPPED" && this.machine.state !== "ERROR") return false;
    this.machine.transition("STARTING");
    this.store.setRuntime({ workerState: "STARTING", workerStartedAt: this.clock(), lastError: "" });
    this.machine.transition("READY");
    this.machine.transition("MONITORING");
    this.store.setRuntime({ workerState: "MONITORING", heartbeatAt: this.clock() });
    this.logger.info("worker 已启动");
    return true;
  };

  Controller.prototype.stop = function () {
    if (this.machine.state === "STOPPED") return false;
    this.queue.clear();
    if (this.machine.can("STOPPED")) this.machine.transition("STOPPED");
    this.store.setRuntime({ workerState: "STOPPED", workerStoppedAt: this.clock(), heartbeatAt: this.clock() });
    this.logger.info("worker 已停止");
    return true;
  };

  Controller.prototype.enqueue = function (name, fn, meta) {
    return this.queue.enqueue(name, fn, meta);
  };

  Controller.prototype.tick = function () {
    if (this.machine.state === "STOPPED" || this.machine.state === "ERROR") return 0;
    this.store.setRuntime({ heartbeatAt: this.clock(), queueSize: this.queue.size() });
    var count = this.queue.drain(1);
    this.store.setRuntime({ heartbeatAt: this.clock(), queueSize: this.queue.size() });
    return count;
  };

  Controller.prototype.fail = function (error) {
    var message = String(error || "unknown");
    try {
      if (this.machine.can("ERROR")) this.machine.transition("ERROR", { error: message });
    } catch (ignore) {}
    this.store.setRuntime({ workerState: "ERROR", lastError: message, lastErrorAt: this.clock() });
    this.logger.error("worker 进入 ERROR: " + message);
  };

  if (typeof module !== "undefined" && module.exports) module.exports = { Controller: Controller };
  else this.WxBotController = { Controller: Controller };
}());
