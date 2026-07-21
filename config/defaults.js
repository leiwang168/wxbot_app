(function () {
  "use strict";

  var VERSION = 1;

  function clone(value) {
    return JSON.parse(JSON.stringify(value));
  }

  var DEFAULTS = {
    version: VERSION,
    wechatPackage: "com.tencent.mm",
    enabled: false,
    privateChat: {
      enabled: true,
      listenMode: "whitelist",
      whitelist: [],
      blacklist: [],
      badgeScanOnly: false
    },
    replyRules: [],
    replyDelay: {
      enabled: true,
      minSec: 1,
      maxSec: 5
    },
    friendAdd: {
      enabled: true,
      normalIntervalSec: 60,
      dailyLimit: 20,
      retryCount: 2,
      rateLimitCooldownSec: 3600,
      requireConfirm: true,
      defaultVerifyText: "",
      defaultRemark: ""
    },
    proactiveMessage: {
      enabled: true,
      normalIntervalSec: 30,
      dailyLimit: 20,
      rateLimitCooldownSec: 3600,
      requireConfirm: true
    },
    mqtt: {
      enabled: false,
      serverUri: "",
      clientId: "",
      username: "",
      password: "",
      commandTopic: "wxbot/{clientId}/command",
      eventTopic: "wxbot/{clientId}/event",
      qos: 1,
      retained: false,
      cleanSession: true,
      autoReconnect: true,
      reconnectIntervalSec: 10,
      willTopic: "wxbot/{clientId}/status",
      willMessage: "offline",
      willQos: 1,
      willRetained: true,
      allowedCommands: [
        "add_friend_search",
        "add_friend_confirm",
        "add_friend_cancel",
        "proactive_message_search",
        "proactive_message_confirm",
        "proactive_message_cancel",
        "scan_wechat_badges",
        "read_current_friend_profile"
      ]
    },
    diagnostics: {
      keepLogCount: 200,
      saveFailureScreenshot: true,
      maskMessagePreview: true
    }
  };

  function getDefaults() {
    return clone(DEFAULTS);
  }

  function normalize(input) {
    var out = getDefaults();
    input = input || {};
    Object.keys(input).forEach(function (key) {
      if (input[key] && typeof input[key] === "object" && !Array.isArray(input[key]) && out[key] && typeof out[key] === "object") {
        Object.keys(input[key]).forEach(function (nestedKey) {
          out[key][nestedKey] = input[key][nestedKey];
        });
      } else if (input[key] !== undefined) {
        out[key] = input[key];
      }
    });
    out.version = VERSION;
    return out;
  }

  if (typeof module !== "undefined" && module.exports) {
    module.exports = {
      VERSION: VERSION,
      DEFAULTS: DEFAULTS,
      getDefaults: getDefaults,
      normalize: normalize
    };
  } else {
    this.WxBotDefaults = {
      VERSION: VERSION,
      DEFAULTS: DEFAULTS,
      getDefaults: getDefaults,
      normalize: normalize
    };
  }
}());
