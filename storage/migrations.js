(function () {
  "use strict";

  function migrate(config, defaultsModule) {
    var input = config || {};
    var defaults = defaultsModule.getDefaults();
    var version = Number(input.version || 0);
    var result = defaultsModule.normalize(input);

    if (version < 1) {
      if (input.friend_add && !input.friendAdd) {
        result.friendAdd = Object.assign(result.friendAdd, input.friend_add);
      }
      if (input.keyword_dict && (!result.replyRules || result.replyRules.length === 0)) {
        result.replyRules = Object.keys(input.keyword_dict).map(function (keyword, index) {
          return {
            id: "migrated-" + (index + 1),
            enabled: true,
            keyword: keyword,
            match: "contains",
            reply: String(input.keyword_dict[keyword] || ""),
            cooldownSec: 30
          };
        });
      }
    }

    result.version = defaultsModule.VERSION;
    return result;
  }

  if (typeof module !== "undefined" && module.exports) {
    module.exports = { migrate: migrate };
  } else {
    this.WxBotMigrations = { migrate: migrate };
  }
}());
