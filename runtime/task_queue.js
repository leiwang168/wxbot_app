(function () {
  "use strict";

  function TaskQueue() {
    this.items = [];
    this.running = false;
  }

  TaskQueue.prototype.enqueue = function (name, fn, meta) {
    this.items.push({ name: name, fn: fn, meta: meta || {}, enqueuedAt: Date.now() });
    return this.items.length;
  };

  TaskQueue.prototype.size = function () {
    return this.items.length + (this.running ? 1 : 0);
  };

  TaskQueue.prototype.runNext = function () {
    if (this.running || this.items.length === 0) return false;
    var item = this.items.shift();
    this.running = true;
    try {
      item.fn(item.meta);
    } finally {
      this.running = false;
    }
    return true;
  };

  TaskQueue.prototype.drain = function (max) {
    var count = 0;
    var limit = max || 100;
    while (count < limit && this.runNext()) count += 1;
    return count;
  };

  TaskQueue.prototype.clear = function () {
    this.items = [];
  };

  if (typeof module !== "undefined" && module.exports) {
    module.exports = { TaskQueue: TaskQueue };
  } else {
    this.WxBotTaskQueue = { TaskQueue: TaskQueue };
  }
}());
