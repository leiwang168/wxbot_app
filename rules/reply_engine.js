(function () {
  "use strict";

  function contains(value, needle) {
    return String(value || "").indexOf(String(needle || "")) >= 0;
  }

  function ReplyEngine(config) {
    this.config = config || {};
  }

  ReplyEngine.prototype.isAllowedChat = function (chatName) {
    var privateChat = this.config.privateChat || {};
    var name = String(chatName || "");
    var blacklist = privateChat.blacklist || [];
    if (blacklist.indexOf(name) >= 0) return false;
    if (privateChat.listenMode === "all") return true;
    var whitelist = privateChat.whitelist || [];
    return whitelist.indexOf(name) >= 0;
  };

  ReplyEngine.prototype.match = function (event, now) {
    var config = this.config;
    var privateChat = config.privateChat || {};
    if (!privateChat.enabled) return { action: "ignore", reason: "private_chat_disabled" };
    if (event.direction !== "incoming") return { action: "ignore", reason: "not_incoming" };
    if (!this.isAllowedChat(event.chatName)) return { action: "ignore", reason: "chat_not_allowed" };
    var text = String(event.text || "");
    var rules = config.replyRules || [];
    for (var i = 0; i < rules.length; i += 1) {
      var rule = rules[i];
      if (!rule || rule.enabled === false || !rule.keyword || !rule.reply) continue;
      var matched = rule.match === "exact" ? text === String(rule.keyword) : contains(text, rule.keyword);
      if (matched) {
        return {
          action: "reply",
          rule: rule,
          chatName: event.chatName,
          text: rule.reply,
          cooldownKey: (event.chatName || "") + "|" + (rule.id || rule.keyword),
          now: now || Date.now()
        };
      }
    }
    return { action: "ignore", reason: "no_rule" };
  };

  if (typeof module !== "undefined" && module.exports) {
    module.exports = { ReplyEngine: ReplyEngine };
  } else {
    this.WxBotReplyEngine = { ReplyEngine: ReplyEngine };
  }
}());
