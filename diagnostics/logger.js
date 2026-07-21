(function () {
  "use strict";

  function nowIso() {
    return new Date().toISOString();
  }

  function padTime(value) {
    return value < 10 ? "0" + value : String(value);
  }

  function formatTime(date) {
    var d = date || new Date();
    return d.getFullYear() + "-" + padTime(d.getMonth() + 1) + "-" + padTime(d.getDate()) + " " +
      padTime(d.getHours()) + ":" + padTime(d.getMinutes()) + ":" + padTime(d.getSeconds());
  }

  function isSensitiveKey(key) {
    return /(^|)(verifyText|reply|message|preview|content|password|token|apiKey|secret)(|$)/i.test(String(key || ""));
  }

  function maskText(value, limit) {
    var text = String(value === null || value === undefined ? "" : value);
    var max = limit || 80;
    if (text.length <= max) return text;
    return text.slice(0, max) + "…(" + text.length + " chars)";
  }

  function redact(value, key, depth) {
    depth = depth || 0;
    if (depth > 4) return "[depth-limited]";
    if (value === null || value === undefined) return value;
    if (typeof value === "string") {
      if (isSensitiveKey(key)) return "[已脱敏:" + value.length + " chars]";
      return maskText(value);
    }
    if (typeof value !== "object") return value;
    if (Array.isArray(value)) return value.map(function (item) { return redact(item, key, depth + 1); });
    var output = {};
    Object.keys(value).forEach(function (itemKey) {
      output[itemKey] = redact(value[itemKey], itemKey, depth + 1);
    });
    return output;
  }

  function formatDetails(meta) {
    if (!meta || typeof meta !== "object") return "";
    try {
      var text = JSON.stringify(meta);
      return text === "{}" ? "" : " " + text;
    } catch (error) {
      return " {detail_unserializable}";
    }
  }

  function resolveLogPath(options) {
    options = options || {};
    if (options.filePath) return options.filePath;
    if (options.logFile) return options.logFile;
    if (typeof files === "undefined" || !files) return "";
    var root = files.cwd ? files.cwd() : "";
    if (!root || !files.join) return "";
    return files.join(root, "logs", "runtime.log");
  }

  function appendFile(path, text) {
    if (!path) return false;
    try {
      if (typeof files !== "undefined" && files) {
        if (files.ensureDir) files.ensureDir(files.getDir ? files.getDir(path) : path.substring(0, path.lastIndexOf("/")));
        if (files.append) {
          files.append(path, text);
          return true;
        }
        if (files.write) {
          files.write(path, text);
          return true;
        }
      }
    } catch (error1) {}
    try {
      if (typeof $files !== "undefined" && $files && $files.append) {
        $files.append(path, text);
        return true;
      }
    } catch (error2) {}
    return false;
  }

  // Keep the same output contract as the reference wx_auto project.
  function logLine(config, message) {
    var line = "[" + formatTime(new Date()) + "] " + String(message === undefined || message === null ? "" : message);
    try {
      if (typeof log === "function") log(line);
    } catch (ignoreLog) {}
    try {
      if (config && config.logFile) appendFile(config.logFile, line + "\n");
    } catch (ignoreFile) {}
    return line;
  }

  function Logger(store, options) {
    this.store = store;
    this.options = options || {};
    this.limit = this.options.limit || 200;
    this.maskMessagePreview = this.options.maskMessagePreview !== false;
    this.filePath = resolveLogPath(this.options);
  }

  Logger.prototype.write = function (level, message, meta) {
    var safeMeta = this.maskMessagePreview ? redact(meta || {}) : (meta || {});
    var entry = {
      ts: Date.now(),
      time: nowIso(),
      level: level,
      message: String(message || ""),
      meta: safeMeta
    };
    var logs = this.store ? this.store.getLogs() : [];
    logs.push(entry);
    if (this.store) this.store.saveLogs(logs, this.limit);
    logLine({ logFile: this.filePath }, "[" + level + "] " + entry.message + formatDetails(safeMeta));
    return entry;
  };

  ["debug", "info", "warn", "error"].forEach(function (level) {
    Logger.prototype[level] = function (message, meta) {
      return this.write(level.toUpperCase(), message, meta);
    };
  });

  Logger.prototype.action = function (message, meta) {
    return this.write("ACTION", message, meta);
  };

  Logger.prototype.detail = function (message, meta) {
    return this.write("DETAIL", message, meta);
  };

  Logger.prototype.logLine = function (message) {
    return logLine({ logFile: this.filePath }, message);
  };

  Logger.prototype.format = function (entry) {
    if (!entry) return "";
    return String(entry.time || "") + " [" + String(entry.level || "INFO") + "] " + String(entry.message || "") + formatDetails(entry.meta || {});
  };

  if (typeof module !== "undefined" && module.exports) {
    module.exports = { Logger: Logger, logLine: logLine, formatTime: formatTime, redact: redact, maskText: maskText };
  } else {
    this.WxBotLogger = { Logger: Logger, logLine: logLine, formatTime: formatTime, redact: redact, maskText: maskText };
  }
}());
