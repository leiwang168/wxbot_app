(function () {
  "use strict";

  function check(config) {
    var result = {
      autoAccessibility: { status: "unknown", detail: "需要在设备上由 AutoX 检查" },
      notificationListener: { status: "unknown", detail: "需要启动通知监听验证" },
      wechatInstalled: { status: "unknown", detail: "" },
      wechatPackage: (config && config.wechatPackage) || "com.tencent.mm"
    };
    try {
      result.autoAccessibility.status = typeof auto !== "undefined" ? "available" : "missing";
    } catch (ignore) {}
    try {
      if (typeof app !== "undefined" && app.getPackageName) {
        result.wechatInstalled.status = app.getPackageName("微信") ? "available" : "missing";
      }
    } catch (ignore2) {}
    return result;
  }

  function openAccessibilitySettings() {
    try {
      if (typeof app !== "undefined" && app.startActivity) {
        app.startActivity({ action: "android.settings.ACCESSIBILITY_SETTINGS" });
        return true;
      }
    } catch (ignore) {}
    return false;
  }

  function openNotificationSettings() {
    try {
      if (typeof app !== "undefined" && app.startActivity) {
        app.startActivity({ action: "android.settings.ACTION_NOTIFICATION_LISTENER_SETTINGS" });
        return true;
      }
    } catch (ignore) {}
    return false;
  }

  if (typeof module !== "undefined" && module.exports) module.exports = {
    check: check,
    openAccessibilitySettings: openAccessibilitySettings,
    openNotificationSettings: openNotificationSettings
  };
  else this.WxBotHealthCheck = {
    check: check,
    openAccessibilitySettings: openAccessibilitySettings,
    openNotificationSettings: openNotificationSettings
  };
}());
