(function () {
  "use strict";

  function hash(text) {
    var value = String(text || "");
    var h = 2166136261;
    for (var i = 0; i < value.length; i += 1) {
      h ^= value.charCodeAt(i);
      h += (h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24);
    }
    return (h >>> 0).toString(16);
  }

  function Dedupe(store, ttlMs) {
    this.store = store;
    this.ttlMs = ttlMs || 60000;
  }

  Dedupe.prototype.keyForMessage = function (event) {
    return hash([
      event.chatName || event.chatId || "",
      event.senderName || "",
      event.text || "",
      event.observedAt ? Math.floor(event.observedAt / 5000) : ""
    ].join("|"));
  };

  Dedupe.prototype.seen = function (key, now) {
    var current = now || Date.now();
    var items = this.store.getDedupe();
    var stamp = items[key];
    if (stamp && current - stamp < this.ttlMs) return true;
    items[key] = current;
    var self = this;
    Object.keys(items).forEach(function (itemKey) {
      if (current - items[itemKey] > self.ttlMs * 2) delete items[itemKey];
    });
    this.store.saveDedupe(items);
    return false;
  };

  if (typeof module !== "undefined" && module.exports) {
    module.exports = { hash: hash, Dedupe: Dedupe };
  } else {
    this.WxBotDedupe = { hash: hash, Dedupe: Dedupe };
  }
}());



