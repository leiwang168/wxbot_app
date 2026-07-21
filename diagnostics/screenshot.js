(function () {
  "use strict";

  function saveFailureScreenshot(prefix) {
    var safe = String(prefix || "failure").replace(/[^a-zA-Z0-9_-]/g, "_");
    var path = "";
    try {
      if (typeof files !== "undefined" && files.ensureDir) {
        var dir = files.join(files.cwd(), "logs", "screenshots");
        files.ensureDir(dir);
        path = files.join(dir, safe + "-" + Date.now() + ".png");
        if (typeof captureScreen === "function") {
          var image = captureScreen();
          if (image && images && images.save) images.save(image, path, "png", 90);
          if (image && images && images.recycle) images.recycle(image);
          return path;
        }
      }
    } catch (error) {
      try { if (typeof log !== "undefined") log("截图失败: " + error); } catch (ignore) {}
    }
    return path;
  }

  if (typeof module !== "undefined" && module.exports) module.exports = { saveFailureScreenshot: saveFailureScreenshot };
  else this.WxBotScreenshot = { saveFailureScreenshot: saveFailureScreenshot };
}());
