(function () {
  "use strict";

  function Adapter(options) {
    this.options = options || {};
    this.packageName = this.options.packageName || "com.tencent.mm";
    this.defaultTimeout = this.options.defaultTimeout || 3000;
    this.logger = this.options.logger || null;
  }

  Adapter.prototype._log = function (level, message, meta) {
    try {
      if (this.logger && typeof this.logger[level] === "function") this.logger[level](message, meta || {});
    } catch (ignore) {}
  };

  Adapter.prototype._detail = function (message, meta) {
    try {
      if (this.logger && typeof this.logger.detail === "function") this.logger.detail(message, meta || {});
      else this._log("debug", message, meta);
    } catch (ignore) {}
  };

  Adapter.prototype._selector = function (kind, value) {
    try {
      if (typeof globalThis !== "undefined" && typeof globalThis[kind] === "function") return globalThis[kind](value);
    } catch (error) {
      this._detail("创建微信控件选择器失败", { kind: kind, value: value, error: String(error) });
    }
    return null;
  };

  Adapter.prototype._findOne = function (selector, timeout) {
    if (!selector) return null;
    try {
      if (typeof selector.findOne === "function") return selector.findOne(timeout || this.defaultTimeout);
    } catch (error) {
      this._detail("查找微信控件异常", { error: String(error) });
    }
    return null;
  };

  Adapter.prototype._findFirstByTexts = function (texts, timeout) {
    var self = this;
    var values = texts || [];
    for (var i = 0; i < values.length; i += 1) {
      var selector = self._selector("text", values[i]);
      var node = self._findOne(selector, timeout);
      if (node) return node;
      selector = self._selector("textContains", values[i]);
      node = self._findOne(selector, timeout);
      if (node) return node;
    }
    return null;
  };

  Adapter.prototype._collectionSize = function (nodes) {
    try {
      if (!nodes) return 0;
      if (typeof nodes.size === "function") return Number(nodes.size());
      if (nodes.length !== undefined) return Number(nodes.length);
    } catch (ignore) {}
    return 0;
  };

  Adapter.prototype._collectionGet = function (nodes, index) {
    try {
      if (nodes && typeof nodes.get === "function") return nodes.get(index);
      if (nodes && nodes[index] !== undefined) return nodes[index];
    } catch (ignore) {}
    return null;
  };

  Adapter.prototype._findInput = function (index, timeout) {
    var wanted = Number(index || 0);
    var selector = this._selector("className", "android.widget.EditText");
    if (!selector) return null;
    try {
      var nodes = typeof selector.find === "function" ? selector.find() : null;
      var size = this._collectionSize(nodes);
      if (size > wanted) return this._collectionGet(nodes, wanted);
      if (wanted === 0) return this._findOne(selector, timeout);
    } catch (error) {
      this._detail("读取输入框集合异常", { index: wanted, error: String(error) });
    }
    return null;
  };

  Adapter.prototype._nodeText = function (node) {
    if (!node) return "";
    try {
      if (typeof node.text === "function") return String(node.text() || "");
      if (typeof node.getText === "function") return String(node.getText() || "");
      if (typeof node.windowText === "function") return String(node.windowText() || "");
    } catch (ignore) {}
    return "";
  };

  Adapter.prototype._click = function (node) {
    if (!node) return false;
    try {
      if (typeof node.click === "function") {
        var result = node.click();
        return result !== false;
      }
    } catch (error) {
      this._detail("点击微信控件异常", { error: String(error) });
    }
    try {
      var bounds = this._nodeBounds(node);
      if (bounds && typeof click === "function" && typeof bounds.centerX === "function" && typeof bounds.centerY === "function") {
        click(Number(bounds.centerX()), Number(bounds.centerY()));
        return true;
      }
    } catch (coordinateError) {
      this._detail("坐标点击微信控件异常", { error: String(coordinateError) });
    }
    return false;
  };

  Adapter.prototype._nodeDescription = function (node) {
    if (!node) return "";
    var methods = ["desc", "getContentDescription", "contentDescription", "getDesc", "windowContentDescription"];
    for (var i = 0; i < methods.length; i += 1) {
      try {
        if (typeof node[methods[i]] === "function") {
          var value = node[methods[i]]();
          if (value !== null && value !== undefined && String(value)) return String(value);
        }
      } catch (ignore) {}
    }
    return "";
  };

  Adapter.prototype._nodeClassName = function (node) {
    if (!node) return "";
    var methods = ["className", "getClassName", "classNameName"];
    for (var i = 0; i < methods.length; i += 1) {
      try {
        if (typeof node[methods[i]] === "function") {
          var value = node[methods[i]]();
          if (value !== null && value !== undefined && String(value)) return String(value);
        }
      } catch (ignore) {}
    }
    return "";
  };

  Adapter.prototype._nodeResourceName = function (node) {
    if (!node) return "";
    var methods = ["getViewIdResourceName", "resourceName", "getResourceName", "id"];
    for (var i = 0; i < methods.length; i += 1) {
      try {
        if (typeof node[methods[i]] === "function") {
          var value = node[methods[i]]();
          if (value !== null && value !== undefined && String(value)) return String(value);
        }
      } catch (ignore) {}
    }
    return "";
  };

  Adapter.prototype._nodeClickable = function (node) {
    if (!node) return false;
    var methods = ["clickable", "isClickable"];
    for (var i = 0; i < methods.length; i += 1) {
      try {
        if (typeof node[methods[i]] === "function") return !!node[methods[i]]();
      } catch (ignore) {}
    }
    return false;
  };

  Adapter.prototype._normalizeUiText = function (value) {
    return String(value === null || value === undefined ? "" : value)
      .replace(/[\s ]+/g, " ")
      .trim();
  };

  Adapter.prototype._isChatTimestampText = function (text) {
    var value = this._normalizeUiText(text).replace(/[\s ]+/g, "");
    if (!value) return false;
    // WeChat renders separators such as "上午10:10" and "昨天晚上6:44"
    // as TextView nodes alongside the actual message bubbles.
    if (/^(?:凌晨|早上|上午|中午|下午|晚上)?\d{1,2}:\d{2}$/.test(value)) return true;
    if (/^(?:今天|昨天|前天)(?:凌晨|早上|上午|中午|下午|晚上)?\d{1,2}:\d{2}$/.test(value)) return true;
    if (/^\d{4}[-/]\d{1,2}[-/]\d{1,2}(?:凌晨|早上|上午|中午|下午|晚上)?\d{1,2}:\d{2}$/.test(value)) return true;
    if (/^\d{1,2}月\d{1,2}日(?:凌晨|早上|上午|中午|下午|晚上)?\d{1,2}:\d{2}$/.test(value)) return true;
    return false;
  };
  Adapter.prototype._unreadCount = function (text, description) {
    var values = [this._normalizeUiText(text), this._normalizeUiText(description)];
    for (var i = 0; i < values.length; i += 1) {
      var value = values[i];
      if (!value) continue;
      var compact = value.replace(/[\s ]+/g, "");
      var numeric = compact.match(/^(\d{1,4})\+?$/);
      if (numeric && Number(numeric[1]) > 0) return Number(numeric[1]);
      if (/(?:未读|新消息|unread)/i.test(value)) return 1;
    }
    return 0;
  };

  Adapter.prototype._isUnreadBadge = function (text, description) {
    return this._unreadCount(text, description) > 0;
  };

  Adapter.prototype._setText = function (node, value) {
    if (!node) return false;
    var text = String(value === null || value === undefined ? "" : value);
    try {
      if (typeof node.setText === "function") { node.setText(text); return true; }
    } catch (error) {
      this._detail("控件 setText 异常", { error: String(error) });
    }
    try {
      if (typeof setText === "function") { setText(text); return true; }
    } catch (error2) {
      this._detail("AutoX setText 异常", { error: String(error2) });
    }
    return false;
  };

  Adapter.prototype._sleep = function (ms) {
    try {
      if (typeof sleep === "function" && ms > 0) sleep(ms);
    } catch (ignore) {}
  };

  Adapter.prototype.ensureAccessibility = function () {
    this._detail("检查无障碍服务");
    if (typeof auto === "undefined" || !auto) return { ok: false, code: "AUTOX_ACCESSIBILITY_UNAVAILABLE" };
    try {
      if (typeof auto.waitFor === "function") auto.waitFor();
      this._detail("无障碍服务可用");
      return { ok: true };
    } catch (error) {
      this._log("error", "无障碍服务不可用", { code: "AUTOX_ACCESSIBILITY_REQUIRED", error: String(error) });
      return { ok: false, code: "AUTOX_ACCESSIBILITY_REQUIRED", error: String(error) };
    }
  };

  Adapter.prototype.launch = function () {
    this._detail("启动微信", { packageName: this.packageName });
    try {
      if (typeof app !== "undefined" && app.launchPackage) {
        app.launchPackage(this.packageName);
        this._sleep(1000);
        this._detail("微信启动完成", { packageName: this.packageName });
        return { ok: true };
      }
    } catch (error) {
      this._log("error", "启动微信失败", { code: "WECHAT_LAUNCH_FAILED", error: String(error) });
      return { ok: false, code: "WECHAT_LAUNCH_FAILED", error: String(error) };
    }
    return { ok: false, code: "APP_API_UNAVAILABLE" };
  };

  Adapter.prototype.isRateLimited = function () {
    var patterns = ["操作过于频繁", "操作太频繁", "频繁", "请稍后再试", "验证码", "异常登录"];
    for (var i = 0; i < patterns.length; i += 1) {
      if (this._findFirstByTexts([patterns[i]], 300)) {
        this._log("warn", "检测到微信风控提示", { matchedPattern: patterns[i] });
        return true;
      }
    }
    return false;
  };

  Adapter.prototype.openAddFriend = function () {
    this._log("action", "打开微信添加朋友页面");
    var launch = this.launch();
    if (!launch.ok) return launch;
    var contactTab = this._findFirstByTexts(["通讯录"], 1500);
    if (contactTab) {
      this._detail("点击通讯录标签");
      if (!this._click(contactTab)) return { ok: false, code: "CONTACT_TAB_CLICK_FAILED" };
      this._sleep(400);
    } else {
      this._detail("未找到通讯录标签，继续尝试当前页面");
    }
    var addButton = this._findFirstByTexts(["添加朋友", "添加好友"], 3000);
    if (!addButton) {
      this._log("error", "未找到添加朋友入口", { code: "ADD_FRIEND_ENTRY_NOT_FOUND" });
      return { ok: false, code: "ADD_FRIEND_ENTRY_NOT_FOUND" };
    }
    if (!this._click(addButton)) return { ok: false, code: "ADD_FRIEND_ENTRY_CLICK_FAILED" };
    this._sleep(700);
    this._detail("已进入添加朋友页面");
    return { ok: true };
  };

  Adapter.prototype.searchFriend = function (target) {
    this._log("action", "在微信中搜索主动添加目标", { target: String(target || "") });
    var input = this._findInput(0, 3000);
    if (!input) return { ok: false, code: "SEARCH_INPUT_NOT_FOUND" };
    if (!this._setText(input, target)) return { ok: false, code: "SEARCH_INPUT_FAILED" };
    var search = this._findFirstByTexts(["搜索"], 1500);
    if (search) {
      this._detail("点击搜索按钮");
      if (!this._click(search)) return { ok: false, code: "SEARCH_BUTTON_CLICK_FAILED" };
    } else {
      this._detail("未找到搜索按钮，尝试回车提交");
      try { if (typeof press === "function") press(66); else return { ok: false, code: "SEARCH_BUTTON_NOT_FOUND" }; } catch (error) { return { ok: false, code: "SEARCH_SUBMIT_FAILED", error: String(error) }; }
    }
    this._sleep(1000);
    if (this.isRateLimited()) return { ok: false, code: "WECHAT_RATE_LIMITED" };
    this._detail("搜索提交完成", { target: String(target || "") });
    return { ok: true };
  };

  Adapter.prototype.readSearchResult = function (target) {
    this._detail("读取主动添加搜索结果", { target: String(target || "") });
    if (this._findFirstByTexts(["无结果", "不存在", "找不到", "该用户不存在"], 700)) {
      this._log("info", "主动添加目标未找到", { target: String(target || "") });
      return { status: "not_found", target: target };
    }
    var candidates = [];
    var selector = this._selector("className", "android.widget.TextView");
    try {
      var nodes = selector && selector.find ? selector.find() : null;
      var size = this._collectionSize(nodes);
      for (var i = 0; i < size; i += 1) {
        var node = this._collectionGet(nodes, i);
        var text = this._nodeText(node).trim();
        if (!text) continue;
        if (["搜索", "添加到通讯录", "添加到通讯录", "微信号", "手机号"].indexOf(text) >= 0) continue;
        if (candidates.indexOf(text) < 0) candidates.push(text);
      }
    } catch (error) {
      this._detail("读取搜索结果控件异常", { error: String(error) });
    }
    if (candidates.length === 0) {
      this._log("info", "主动添加搜索结果为空", { target: String(target || "") });
      return { status: "not_found", target: target };
    }
    var exactTarget = candidates.indexOf(String(target || "")) >= 0;
    var result = {
      status: exactTarget || candidates.length === 1 ? "found" : "ambiguous",
      target: target,
      nickname: candidates[0],
      candidates: candidates.slice(0, 8),
      confidence: exactTarget ? "exact_target_visible" : (candidates.length === 1 ? "single_candidate" : "multiple_candidates")
    };
    this._log(result.status === "found" ? "info" : "warn", "主动添加搜索结果已读取", {
      target: String(target || ""), nickname: result.nickname, candidateCount: candidates.length, confidence: result.confidence
    });
    return result;
  };

  Adapter.prototype.fillFriendRequest = function (verifyText, remark) {
    this._log("action", "填写好友申请表单", { hasVerifyText: !!verifyText, hasRemark: !!remark });
    var inputs = [];
    var selector = this._selector("className", "android.widget.EditText");
    try {
      var nodes = selector && selector.find ? selector.find() : null;
      var size = this._collectionSize(nodes);
      for (var i = 0; i < size; i += 1) inputs.push(this._collectionGet(nodes, i));
    } catch (error) {
      return { ok: false, code: "REQUEST_INPUTS_READ_FAILED", error: String(error) };
    }
    if (verifyText) {
      if (!inputs[0] || !this._setText(inputs[0], verifyText)) return { ok: false, code: "VERIFY_TEXT_INPUT_FAILED" };
    }
    if (remark) {
      if (!inputs[1] || !this._setText(inputs[1], remark)) return { ok: false, code: "REMARK_INPUT_FAILED" };
    }
    this._detail("好友申请表单填写完成", { inputCount: inputs.length });
    return { ok: true };
  };

  Adapter.prototype.submitFriendRequest = function () {
    this._log("action", "提交好友申请");
    var button = this._findFirstByTexts(["发送", "完成"], 2000);
    if (!button) return { ok: false, code: "FRIEND_REQUEST_SUBMIT_NOT_FOUND" };
    if (!this._click(button)) return { ok: false, code: "FRIEND_REQUEST_SUBMIT_CLICK_FAILED" };
    this._sleep(900);
    if (this.isRateLimited()) return { ok: false, code: "WECHAT_RATE_LIMITED" };
    if (this._findFirstByTexts(["申请已发送", "已发送", "等待验证"], 1200)) {
      this._log("info", "微信确认好友申请已发送");
      return { ok: true, verified: true };
    }
    this._log("warn", "好友申请提交后未找到明确成功文案");
    return { ok: true, unverified: true };
  };

  Adapter.prototype.openChatFromNotification = function (notification) {
    this._detail("点击微信通知打开私聊");
    try {
      if (notification && typeof notification.click === "function") {
        notification.click();
        this._sleep(900);
        return { ok: true };
      }
    } catch (error) {
      this._log("error", "点击微信通知失败", { code: "NOTIFICATION_CLICK_FAILED", error: String(error) });
      return { ok: false, code: "NOTIFICATION_CLICK_FAILED", error: String(error) };
    }
    var launched = this.launch();
    return launched.ok ? { ok: true, unverified: true } : launched;
  };

  Adapter.prototype._nodeBounds = function (node) {
    try {
      if (node && typeof node.bounds === "function") return node.bounds();
    } catch (ignore) {}
    return null;
  };

  Adapter.prototype.isWechatForeground = function () {
    try {
      if (typeof currentPackage === "function") return String(currentPackage() || "") === this.packageName;
      if (typeof currentPackageName === "function") return String(currentPackageName() || "") === this.packageName;
      if (typeof app !== "undefined" && typeof app.getPackageName === "function") return String(app.getPackageName() || "") === this.packageName;
    } catch (ignore) {}
    return false;
  };

  Adapter.prototype._findBottomConversationTab = function () {
    var screenWidth = (typeof device !== "undefined" && device.width) ? Number(device.width) : 1080;
    var screenHeight = (typeof device !== "undefined" && device.height) ? Number(device.height) : 1920;
    var candidates = [];
    var addNodes = function (nodes, self) {
      var size = self._collectionSize(nodes);
      for (var i = 0; i < size; i += 1) {
        var node = self._collectionGet(nodes, i);
        var bounds = self._nodeBounds(node);
        var centerX = 0;
        var centerY = 0;
        try {
          if (bounds && typeof bounds.centerX === "function") centerX = Number(bounds.centerX());
          if (bounds && typeof bounds.centerY === "function") centerY = Number(bounds.centerY());
        } catch (ignoreBounds) {}
        // WeChat bottom navigation: bottom area and first column on the left.
        if (centerY > screenHeight * 0.72 && centerX < screenWidth * 0.35) {
          candidates.push({ node: node, centerX: centerX, centerY: centerY });
        }
      }
    };
    try {
      var selector = this._selector("text", "微信");
      addNodes(selector && selector.find ? selector.find() : null, this);
      if (!candidates.length) {
        selector = this._selector("desc", "微信");
        addNodes(selector && selector.find ? selector.find() : null, this);
      }
      if (!candidates.length) {
        // Fallback for versions where the tab is exposed only as a TextView.
        selector = this._selector("className", "android.widget.TextView");
        var nodes = selector && selector.find ? selector.find() : null;
        var size = this._collectionSize(nodes);
        for (var j = 0; j < size; j += 1) {
          var nodeText = this._nodeText(this._collectionGet(nodes, j)).trim();
          if (nodeText === "微信") addNodes([this._collectionGet(nodes, j)], this);
        }
      }
    } catch (error) {
      this._detail("定位微信底部对话按钮异常", { error: String(error) });
    }
    candidates.sort(function (a, b) { return a.centerX - b.centerX; });
    return candidates.length ? candidates[0].node : null;
  };

  Adapter.prototype._clickConversationTab = function (node) {
    var target = node;
    for (var level = 0; level < 5 && target; level += 1) {
      var wasChat = this.isChatScreen();
      if (this._click(target)) {
        this._sleep(500);
        if (!wasChat || !this.isChatScreen()) return { ok: true, ancestorLevel: level };
      }
      try {
        target = target.parent && typeof target.parent === "function" ? target.parent() : null;
      } catch (ignoreParent) {
        target = null;
      }
    }
    return { ok: false, code: "CONVERSATION_TAB_CLICK_FAILED" };
  };

  Adapter.prototype.openConversationList = function () {
    if (!this.isWechatForeground()) return { ok: false, code: "WECHAT_NOT_FOREGROUND" };
    try {
      for (var attempt = 0; attempt < 3; attempt += 1) {
        var tab = this._findBottomConversationTab();
        if (tab) {
          var clicked = this._clickConversationTab(tab);
          if (clicked.ok) {
            this._detail("已定位微信底部第一个对话列表按钮", { ancestorLevel: clicked.ancestorLevel });
            return { ok: true };
          }
        }
        // Chat pages usually hide bottom navigation; go back to the list first.
        if (this.isChatScreen() && typeof back === "function") {
          this._detail("当前在微信聊天窗口，返回对话列表");
          back();
          this._sleep(600);
          continue;
        }
        break;
      }
    } catch (error) {
      this._detail("打开微信对话列表异常", { error: String(error) });
    }
    this._detail("未找到微信底部第一个对话列表按钮", { code: "CONVERSATION_TAB_NOT_FOUND" });
    return { ok: false, code: "CONVERSATION_TAB_NOT_FOUND" };
  };

  Adapter.prototype._uiBoundsMeta = function (node) {
    var bounds = this._nodeBounds(node);
    if (!bounds) return null;
    try {
      var left = typeof bounds.left === "function" ? Number(bounds.left()) : Number(bounds.left || 0);
      var top = typeof bounds.top === "function" ? Number(bounds.top()) : Number(bounds.top || 0);
      var right = typeof bounds.right === "function" ? Number(bounds.right()) : Number(bounds.right || 0);
      var bottom = typeof bounds.bottom === "function" ? Number(bounds.bottom()) : Number(bounds.bottom || 0);
      return { left: left, top: top, right: right, bottom: bottom, centerX: (left + right) / 2, centerY: (top + bottom) / 2 };
    } catch (ignore) {}
    return null;
  };

  Adapter.prototype._findAll = function (selector) {
    if (!selector) return null;
    try {
      if (typeof selector.find === "function") return selector.find();
    } catch (error) {
      this._detail("读取微信控件集合异常", { error: String(error) });
    }
    return null;
  };

  Adapter.prototype._conversationListDiagnostics = function () {
    var screenWidth = (typeof device !== "undefined" && device.width) ? Number(device.width) : 1080;
    var screenHeight = (typeof device !== "undefined" && device.height) ? Number(device.height) : 1920;
    var result = { genericNodeCount: 0, nonEmptyNodeCount: 0, numericCandidateCount: 0, rightSideCandidateCount: 0, leftBadgeCandidateCount: 0, samples: [] };
    try {
      var selector = this._selector("classNameMatches", ".+");
      var nodes = this._findAll(selector);
      var size = Math.min(this._collectionSize(nodes), 2000);
      result.genericNodeCount = size;
      for (var i = 0; i < size; i += 1) {
        var node = this._collectionGet(nodes, i);
        var text = this._normalizeUiText(this._nodeText(node));
        var description = this._normalizeUiText(this._nodeDescription(node));
        if (!text && !description) continue;
        result.nonEmptyNodeCount += 1;
        var bounds = this._uiBoundsMeta(node);
        var unread = this._unreadCount(text, description);
        if (unread > 0) {
          result.numericCandidateCount += 1;
          if (bounds && bounds.centerX > screenWidth * 0.42 && bounds.centerY > screenHeight * 0.08 && bounds.centerY < screenHeight * 0.75) {
            result.rightSideCandidateCount += 1;
          }
          if (this._isConversationListBadgeBounds(bounds, text, description, screenWidth, screenHeight)) {
            result.leftBadgeCandidateCount += 1;
          }
        }
        if (result.samples.length < 20 && bounds && bounds.centerY > screenHeight * 0.08 && bounds.centerY < screenHeight * 0.75 && (text || description)) {
          result.samples.push({
            text: text,
            description: description,
            className: this._nodeClassName(node),
            resourceName: this._nodeResourceName(node),
            clickable: this._nodeClickable(node),
            bounds: bounds
          });
        }
      }
    } catch (error) {
      result.error = String(error);
    }
    this._detail("微信对话列表控件摘要", result);
    return result;
  };

  Adapter.prototype._ancestorTexts = function (node) {
    var result = [];
    var target = node;
    for (var level = 0; level < 6 && target; level += 1) {
      var text = this._normalizeUiText(this._nodeText(target));
      var description = this._normalizeUiText(this._nodeDescription(target));
      if (text || description) result.push({ level: level, text: text, description: description });
      try {
        target = target.parent && typeof target.parent === "function" ? target.parent() : null;
      } catch (ignoreParent) {
        target = null;
      }
    }
    return result;
  };

  Adapter.prototype._readConversationNameForBadge = function (badge, screenWidth, screenHeight) {
    var badgeBounds = this._uiBoundsMeta(badge);
    var ignored = [
      "微信", "通讯录", "发现", "我", "Windows 微信已登录", "浮窗", "聊天信息",
      "返回", "搜索", "关闭", "发送", "更多", "语音", "表情"
    ];
    var isName = function (value) {
      var text = String(value || "").trim();
      if (!text || ignored.indexOf(text) >= 0) return false;
      if (/^\d{1,4}\+?$/.test(text)) return false;
      if (this._isChatTimestampText(text)) return false;
      return text.length <= 80;
    }.bind(this);

    // Some WeChat versions expose the conversation row name on the badge's
    // ancestor. Prefer that because it is already scoped to this chat row.
    var ancestors = this._ancestorTexts(badge);
    for (var a = 1; a < ancestors.length; a += 1) {
      var ancestorText = ancestors[a].text || ancestors[a].description;
      if (isName(ancestorText)) return this._normalizeUiText(ancestorText);
    }
    if (!badgeBounds) return "";

    // In the conversation list, the remark is to the right of the avatar and
    // vertically aligned with the avatar-side unread badge. The preview and
    // timestamp are on another row / far to the right and are excluded.
    var selector = this._selector("classNameMatches", ".+");
    var nodes = this._findAll(selector);
    var size = Math.min(this._collectionSize(nodes), 2000);
    var candidates = [];
    var maxDelta = Math.max(44, screenHeight * 0.03);
    for (var i = 0; i < size; i += 1) {
      var node = this._collectionGet(nodes, i);
      var text = this._normalizeUiText(this._nodeText(node));
      var description = this._normalizeUiText(this._nodeDescription(node));
      var value = text || description;
      if (!isName(value)) continue;
      var bounds = this._uiBoundsMeta(node);
      if (!bounds) continue;
      if (Math.abs(bounds.centerY - badgeBounds.centerY) > maxDelta) continue;
      if (bounds.left < screenWidth * 0.15 || bounds.centerX > screenWidth * 0.82) continue;
      candidates.push({
        text: value,
        distance: Math.abs(bounds.centerY - badgeBounds.centerY),
        left: bounds.left,
        bounds: bounds
      });
    }
    candidates.sort(function (a, b) {
      return a.distance - b.distance || a.left - b.left;
    });
    var chosen = candidates.length ? candidates[0].text : "";
    if (chosen) this._detail("读取微信聊天列表联系人备注名", { chatName: chosen, badgeBounds: badgeBounds });
    return chosen;
  };
  Adapter.prototype._isConversationListBadgeBounds = function (bounds, text, description, screenWidth, screenHeight) {
    if (!bounds) return true;
    if (bounds.centerY < screenHeight * 0.10 || bounds.centerY > screenHeight * 0.90) return false;
    var compact = this._normalizeUiText(text || description).replace(/[\s ]+/g, "");
    var numeric = /^\d{1,4}\+?$/.test(compact);
    // In the actual WeChat list the red unread bubble is attached to the
    // avatar, near the left edge (for example x about 138 on a 922px screen),
    // not on the right side of the conversation row.
    if (numeric) {
      if (bounds.centerX < screenWidth * 0.03 || bounds.centerX > screenWidth * 0.40) return false;
      var width = Math.max(0, bounds.right - bounds.left);
      var height = Math.max(0, bounds.bottom - bounds.top);
      if (width > screenWidth * 0.16 || height > screenHeight * 0.10) return false;
    }
    return true;
  };

  Adapter.prototype._collectUnreadBadgeCandidates = function (screenWidth, screenHeight) {
    var selectors = [
      { kind: "textMatches", value: "^[\\s ]*[0-9]{1,4}\\s*\\+?\\s*$", name: "numeric_text" },
      { kind: "descMatches", value: "^[\\s ]*[0-9]{1,4}\\s*\\+?\\s*$", name: "numeric_description" },
      { kind: "textMatches", value: ".*(未读|新消息|unread).*", name: "unread_text" },
      { kind: "descMatches", value: ".*(未读|新消息|unread).*", name: "unread_description" },
      { kind: "classNameMatches", value: ".+", name: "generic_ui_nodes" }
    ];
    var candidates = [];
    var seen = [];
    for (var s = 0; s < selectors.length; s += 1) {
      var selector = this._selector(selectors[s].kind, selectors[s].value);
      var nodes = this._findAll(selector);
      var size = Math.min(this._collectionSize(nodes), 2000);
      for (var i = 0; i < size; i += 1) {
        var badge = this._collectionGet(nodes, i);
        var text = this._normalizeUiText(this._nodeText(badge));
        var description = this._normalizeUiText(this._nodeDescription(badge));
        var unreadCount = this._unreadCount(text, description);
        if (unreadCount <= 0) continue;
        var bounds = this._uiBoundsMeta(badge);
        if (!this._isConversationListBadgeBounds(bounds, text, description, screenWidth, screenHeight)) continue;
        var duplicate = false;
        for (var j = 0; j < seen.length; j += 1) {
          if (seen[j] === badge) { duplicate = true; break; }
        }
        if (duplicate) continue;
        seen.push(badge);
        candidates.push({
          node: badge,
          source: selectors[s].name,
          unreadCount: unreadCount,
          text: text,
          description: description,
          bounds: bounds,
          top: bounds ? bounds.top : 999999,
          left: bounds ? bounds.left : 0,
          className: this._nodeClassName(badge),
          resourceName: this._nodeResourceName(badge),
          clickable: this._nodeClickable(badge),
          ancestors: this._ancestorTexts(badge),
          chatName: this._readConversationNameForBadge(badge, screenWidth, screenHeight)
        });
      }
    }
    candidates.sort(function (a, b) { return a.top - b.top || b.left - a.left; });
    return candidates;
  };

  Adapter.prototype._badgeLogRecord = function (candidate) {
    if (!candidate) return null;
    return {
      source: candidate.source,
      unreadCount: candidate.unreadCount,
      text: candidate.text,
      description: candidate.description,
      bounds: candidate.bounds,
      className: candidate.className,
      resourceName: candidate.resourceName,
      clickable: candidate.clickable,
      ancestors: candidate.ancestors,
      chatName: candidate.chatName || ""
    };
  };

  // Diagnostic-only path: open the conversation list tab if necessary, inspect badges,
  // and never click a badge, a contact row, or a chat entry.
  Adapter.prototype.scanUnreadBadges = function () {
    if (!this.isWechatForeground()) return { ok: false, code: "WECHAT_NOT_FOREGROUND", clicked: false, badges: [] };
    try {
      var list = this.openConversationList();
      if (!list || !list.ok) return { ok: false, code: list && list.code || "CONVERSATION_TAB_NOT_FOUND", clicked: false, badges: [] };
      this._sleep(500);
      var screenWidth = (typeof device !== "undefined" && device.width) ? Number(device.width) : 1080;
      var screenHeight = (typeof device !== "undefined" && device.height) ? Number(device.height) : 1920;
      var candidates = this._collectUnreadBadgeCandidates(screenWidth, screenHeight);
      var records = [];
      for (var i = 0; i < candidates.length; i += 1) records.push(this._badgeLogRecord(candidates[i]));
      this._detail("微信未读角标识别结果（仅扫描未点击）", {
        code: candidates.length ? "UNREAD_BADGE_FOUND" : "UNREAD_BADGE_NOT_FOUND",
        badgeCount: candidates.length,
        clicked: false,
        badges: records
      });
      return { ok: candidates.length > 0, code: candidates.length ? "UNREAD_BADGE_FOUND" : "UNREAD_BADGE_NOT_FOUND", clicked: false, badges: records };
    } catch (error) {
      this._detail("微信未读角标扫描异常（仅扫描未点击）", { error: String(error), clicked: false });
      return { ok: false, code: "UNREAD_BADGE_SCAN_FAILED", clicked: false, badges: [], error: String(error) };
    }
  };

  Adapter.prototype._openUnreadBadge = function (badge, source, screenWidth, screenHeight, chatName) {
    var text = this._normalizeUiText(this._nodeText(badge));
    var description = this._normalizeUiText(this._nodeDescription(badge));
    var unreadCount = this._unreadCount(text, description);
    if (unreadCount <= 0) return null;
    var bounds = this._uiBoundsMeta(badge);
    if (!this._isConversationListBadgeBounds(bounds, text, description, screenWidth, screenHeight)) return null;

    var target = badge;
    for (var level = 0; level < 8 && target; level += 1) {
      if (this._click(target)) {
        this._sleep(650);
        if (this.isChatScreen()) {
          this._detail("已点击未读角标对应的聊天行", { source: source, ancestorLevel: level, unreadCount: unreadCount, chatName: chatName || "" });
          return { ok: true, unreadCount: unreadCount, clicked: true, chatName: chatName || "" };
        }
      }
      try {
        target = target.parent && typeof target.parent === "function" ? target.parent() : null;
      } catch (ignoreParent) {
        target = null;
      }
    }
    return null;
  };

  Adapter.prototype.openFirstUnreadChat = function () {
    if (!this.isWechatForeground()) return { ok: false, code: "WECHAT_NOT_FOREGROUND", clicked: false };
    try {
      var list = this.openConversationList();
      if (!list || !list.ok) return list;
      this._sleep(500);
      var screenWidth = (typeof device !== "undefined" && device.width) ? Number(device.width) : 1080;
      var screenHeight = (typeof device !== "undefined" && device.height) ? Number(device.height) : 1920;
      var candidates = this._collectUnreadBadgeCandidates(screenWidth, screenHeight);
      for (var c = 0; c < candidates.length; c += 1) {
        var opened = this._openUnreadBadge(candidates[c].node, candidates[c].source, screenWidth, screenHeight, candidates[c].chatName);
        if (opened) return opened;
      }
      var diagnostics = { genericNodeCount: 0, numericCandidateCount: 0, rightSideCandidateCount: 0 };
      var now = Date.now();
      if (!this._lastConversationDiagnosticsAt || now - this._lastConversationDiagnosticsAt >= 15000) {
        this._lastConversationDiagnosticsAt = now;
        diagnostics = this._conversationListDiagnostics();
      }
      this._detail("微信对话列表未发现未读角标", {
        code: "UNREAD_BADGE_NOT_FOUND",
        candidateCount: candidates.length,
        genericNodeCount: diagnostics.genericNodeCount,
        numericCandidateCount: diagnostics.numericCandidateCount,
        rightSideCandidateCount: diagnostics.rightSideCandidateCount,
        leftBadgeCandidateCount: diagnostics.leftBadgeCandidateCount || 0
      });
    } catch (error) {
      this._detail("扫描微信对话列表未读角标异常", { error: String(error) });
    }
    return { ok: false, code: "UNREAD_BADGE_NOT_FOUND", clicked: false };
  };
  Adapter.prototype._findChatInput = function (timeout) {
    var selector = this._selector("className", "android.widget.EditText");
    if (!selector) return null;
    try {
      var nodes = typeof selector.find === "function" ? selector.find() : null;
      var size = this._collectionSize(nodes);
      var screenHeight = (typeof device !== "undefined" && device.height) ? Number(device.height) : 1920;
      var candidates = [];
      for (var i = 0; i < size; i += 1) {
        var node = this._collectionGet(nodes, i);
        var bounds = this._nodeBounds(node);
        var centerY = 0;
        try { if (bounds && typeof bounds.centerY === "function") centerY = Number(bounds.centerY()); } catch (ignoreBounds) {}
        // The chat composer is at the bottom; the home-page search box is at the top.
        if (centerY > screenHeight * 0.55) candidates.push({ node: node, centerY: centerY });
      }
      candidates.sort(function (a, b) { return b.centerY - a.centerY; });
      if (candidates.length) return candidates[0].node;
    } catch (error) {
      this._detail("读取微信聊天输入框异常", { error: String(error) });
    }
    return null;
  };

  Adapter.prototype.isChatScreen = function () {
    if (!this.isWechatForeground()) return false;
    try {
      // The chat list can also expose a top search EditText. Only a bottom composer
      // is a reliable chat-page marker, even when the composer is empty.
      return !!this._findChatInput(200);
    } catch (ignore) {}
    return false;
  };

  Adapter.prototype._collectCurrentChatTitleCandidates = function () {
    if (!this.isChatScreen()) return [];
    var selector = this._selector("className", "android.widget.TextView");
    var nodes = selector && selector.find ? selector.find() : null;
    var size = this._collectionSize(nodes);
    var screenWidth = (typeof device !== "undefined" && device.width) ? Number(device.width) : 1080;
    var screenHeight = (typeof device !== "undefined" && device.height) ? Number(device.height) : 1920;
    var ignored = [
      "微信", "通讯录", "发现", "我", "发送", "更多", "语音", "表情",
      "聊天信息", "浮窗", "返回", "搜索", "关闭"
    ];
    var candidates = [];
    for (var i = 0; i < size; i += 1) {
      var node = this._collectionGet(nodes, i);
      var text = this._normalizeUiText(this._nodeText(node));
      if (!text || ignored.indexOf(text) >= 0 || /^\d+$/.test(text) || this._isChatTimestampText(text)) continue;
      if (text.length > 80) continue;
      var bounds = this._uiBoundsMeta(node);
      if (!bounds) continue;
      // Only the top navigation bar may provide the contact remark. Message
      // bubbles can appear high on a short chat and must never become chatName.
      if (bounds.top < screenHeight * 0.03 || bounds.bottom > screenHeight * 0.18) continue;
      if (bounds.centerX < screenWidth * 0.18 || bounds.centerX > screenWidth * 0.82) continue;
      var score = Math.abs(bounds.centerY - screenHeight * 0.09) / screenHeight +
        Math.abs(bounds.centerX - screenWidth / 2) / screenWidth;
      candidates.push({ node: node, text: text, bounds: bounds, score: score });
    }
    candidates.sort(function (a, b) { return a.score - b.score || a.bounds.top - b.bounds.top; });
    return candidates;
  };

  Adapter.prototype.readCurrentChatName = function () {
    var candidates = this._collectCurrentChatTitleCandidates();
    var chosen = candidates.length ? candidates[0].text : "";
    this._detail("读取微信聊天标题", {
      chatName: chosen,
      candidateCount: candidates.length,
      candidates: candidates.slice(0, 5).map(function (item) {
        return { text: item.text, bounds: item.bounds, score: item.score };
      })
    });
    return chosen;
  };

  Adapter.prototype._isEllipsizedChatName = function (value) {
    var text = this._normalizeUiText(value);
    return text.slice(-3) === "..." || text.slice(-1) === String.fromCharCode(8230);
  };

  Adapter.prototype._readRemarkEditorText = function () {
    var selector = this._selector("className", "android.widget.EditText");
    var nodes = selector && selector.find ? selector.find() : null;
    var size = Math.min(this._collectionSize(nodes), 20);
    var ignored = ["搜索", "请输入备注", "设置备注和标签"];
    for (var i = 0; i < size; i += 1) {
      var node = this._collectionGet(nodes, i);
      var text = this._normalizeUiText(this._nodeText(node));
      if (!text || ignored.indexOf(text) >= 0) continue;
      return text;
    }
    return "";
  };

  Adapter.prototype._readVisibleContactName = function () {
    var selector = this._selector("className", "android.widget.TextView");
    var nodes = selector && selector.find ? selector.find() : null;
    var size = Math.min(this._collectionSize(nodes), 2000);
    var screenHeight = (typeof device !== "undefined" && device.height) ? Number(device.height) : 1920;
    var ignored = ["微信", "通讯录", "发现", "我", "返回", "搜索", "关闭", "聊天信息", "发消息", "视频通话", "音视频通话", "设置备注和标签", "微信号", "手机号", "地区", "个性签名", "更多", "发送", "置顶聊天", "消息免打扰", "查找聊天记录"];
    var candidates = [];
    for (var i = 0; i < size; i += 1) {
      var node = this._collectionGet(nodes, i);
      var text = this._normalizeUiText(this._nodeText(node));
      if (!text || ignored.indexOf(text) >= 0 || /^微信号\s*[:：]/.test(text)) continue;
      if (/^\d+$/.test(text) || this._isChatTimestampText(text)) continue;
      if (this._isEllipsizedChatName(text) || text.length > 80) continue;
      var bounds = this._uiBoundsMeta(node);
      if (!bounds || bounds.top > screenHeight * 0.42) continue;
      candidates.push({ text: text, bounds: bounds });
    }
    candidates.sort(function (a, b) {
      return b.text.length - a.text.length || a.bounds.top - b.bounds.top;
    });
    return candidates.length ? candidates[0].text : "";
  };

  Adapter.prototype._findChatInfoMember = function (chatName) {
    var expected = this._normalizeUiText(chatName);
    if (expected) {
      var exact = this._findFirstByTexts([expected], 800);
      if (exact) return exact;
    }
    var selector = this._selector("className", "android.widget.TextView");
    var nodes = selector && selector.find ? selector.find() : null;
    var size = Math.min(this._collectionSize(nodes), 1000);
    var screenHeight = (typeof device !== "undefined" && device.height) ? Number(device.height) : 1920;
    var ignored = ["聊天信息", "置顶聊天", "消息免打扰", "查找聊天记录", "设置备注和标签", "返回", "更多"];
    var candidates = [];
    for (var i = 0; i < size; i += 1) {
      var node = this._collectionGet(nodes, i);
      var text = this._normalizeUiText(this._nodeText(node));
      if (!text || ignored.indexOf(text) >= 0 || /^\d+$/.test(text) || this._isChatTimestampText(text)) continue;
      var bounds = this._uiBoundsMeta(node);
      if (!bounds || bounds.top > screenHeight * 0.48) continue;
      candidates.push({ node: node, text: text, bounds: bounds });
    }
    candidates.sort(function (a, b) {
      return Math.abs(a.bounds.centerY - b.bounds.centerY) || b.text.length - a.text.length;
    });
    return candidates.length ? candidates[0].node : null;
  };

  Adapter.prototype._readContactRemarkPage = function () {
    var editorText = this._readRemarkEditorText();
    if (editorText && !this._isEllipsizedChatName(editorText)) {
      return { chatName: editorText, source: "remark_editor" };
    }
    var settingButton = this._findFirstByTexts(["设置备注和标签"], 800);
    if (settingButton) return { settingButton: settingButton };
    var visibleName = this._readVisibleContactName();
    if (visibleName) return { chatName: visibleName, source: "contact_profile" };
    return {};
  };

  Adapter.prototype.readCurrentChatRemark = function (chatName) {
    if (!this.isChatScreen()) return { ok: false, code: "CHAT_SCREEN_REQUIRED", chatName: String(chatName || "") };
    var titleCandidates = this._collectCurrentChatTitleCandidates();
    var titleNode = titleCandidates.length ? titleCandidates[0].node : null;
    if (!titleNode || !this._click(titleNode)) {
      return { ok: false, code: "CHAT_TITLE_CLICK_FAILED", chatName: String(chatName || "") };
    }
    this._sleep(700);
    var depth = 1;
    var memberClicked = false;
    var settingClicked = false;
    var resolved = "";
    var source = "";
    try {
      for (var step = 0; step < 4; step += 1) {
        var page = this._readContactRemarkPage();
        if (page.chatName) {
          resolved = page.chatName;
          source = page.source || "contact_profile";
          if (!this._isEllipsizedChatName(resolved)) break;
        }
        if (page.settingButton && !settingClicked) {
          if (this._click(page.settingButton)) {
            settingClicked = true;
            depth += 1;
            this._sleep(500);
            continue;
          }
        }
        if (!memberClicked) {
          var member = this._findChatInfoMember(chatName || (titleCandidates[0] && titleCandidates[0].text) || "");
          if (member && this._click(member)) {
            memberClicked = true;
            depth += 1;
            this._sleep(700);
            continue;
          }
        }
        break;
      }
    } catch (error) {
      this._detail("读取微信完整备注名异常", { error: String(error) });
    } finally {
      for (var i = 0; i < depth; i += 1) this.goHome();
    }
    if (resolved && !this._isEllipsizedChatName(resolved)) {
      this._detail("已读取微信好友完整备注名", { chatName: resolved, source: source || "contact_profile" });
      return { ok: true, chatName: resolved, source: source || "contact_profile" };
    }
    this._detail("未读取到微信好友完整备注名", { chatName: String(chatName || ""), resolved: resolved });
    return { ok: false, code: "FULL_CHAT_NAME_NOT_FOUND", chatName: String(chatName || "") };
  };

  Adapter.prototype._readWechatIdFromCurrentPage = function () {
    var selector = this._selector("classNameMatches", ".+");
    var nodes = this._findAll(selector);
    var size = Math.min(this._collectionSize(nodes), 2000);
    var screenWidth = (typeof device !== "undefined" && device.width) ? Number(device.width) : 1080;
    var screenHeight = (typeof device !== "undefined" && device.height) ? Number(device.height) : 1920;
    var labels = [];
    var samples = [];
    var ignored = ["微信号", "手机号", "地区", "个性签名", "发消息", "视频通话", "设置备注和标签"];
    for (var i = 0; i < size; i += 1) {
      var node = this._collectionGet(nodes, i);
      var text = this._normalizeUiText(this._nodeText(node));
      var description = this._normalizeUiText(this._nodeDescription(node));
      var bounds = this._uiBoundsMeta(node);
      if (!text && !description) continue;
      if (samples.length < 30) samples.push({ text: text, description: description, bounds: bounds });
      var inline = text.match(/^微信号\s*[:：]\s*(.+)$/);
      if (inline && inline[1]) return { ok: true, wechatId: this._normalizeUiText(inline[1]), source: "inline" };
      if (text === "微信号" || description === "微信号") labels.push({ node: node, bounds: bounds });
    }
    for (var j = 0; j < labels.length; j += 1) {
      var label = labels[j];
      if (!label.bounds) continue;
      var candidates = [];
      for (var k = 0; k < size; k += 1) {
        var valueNode = this._collectionGet(nodes, k);
        var valueText = this._normalizeUiText(this._nodeText(valueNode));
        if (!valueText || ignored.indexOf(valueText) >= 0 || valueText === "微信号") continue;
        if (this._isChatTimestampText(valueText)) continue;
        var valueBounds = this._uiBoundsMeta(valueNode);
        if (!valueBounds) continue;
        var sameRow = Math.abs(valueBounds.centerY - label.bounds.centerY) <= Math.max(30, screenHeight * 0.025);
        var toRight = valueBounds.left >= label.bounds.right - 8;
        if (!sameRow || !toRight || valueBounds.left > screenWidth * 0.98) continue;
        candidates.push({ text: valueText, distance: valueBounds.left - label.bounds.right, bounds: valueBounds });
      }
      candidates.sort(function (a, b) { return a.distance - b.distance; });
      if (candidates.length) return { ok: true, wechatId: candidates[0].text, source: "adjacent", samples: samples };
    }
    this._detail("好友资料未找到微信号", { labelCount: labels.length, samples: samples.slice(0, 15) });
    return { ok: false, code: "WECHAT_ID_NOT_FOUND", samples: samples.slice(0, 15) };
  };

  Adapter.prototype.readCurrentFriendProfile = function () {
    if (!this.isChatScreen()) return { ok: false, code: "CHAT_SCREEN_REQUIRED" };
    var titleCandidates = this._collectCurrentChatTitleCandidates();
    var chatName = titleCandidates.length ? titleCandidates[0].text : "";
    if (!chatName) return { ok: false, code: "CHAT_NAME_NOT_FOUND" };
    var titleNode = titleCandidates[0].node;
    if (!this._click(titleNode)) return { ok: false, code: "CHAT_TITLE_CLICK_FAILED", chatName: chatName };
    this._sleep(700);
    var navigationDepth = 1;
    var profile = this._readWechatIdFromCurrentPage();
    if (!profile.ok && !this.isChatScreen()) {
      var member = this._findFirstByTexts([chatName], 1000);
      if (member && this._click(member)) {
        this._sleep(700);
        navigationDepth = 2;
        profile = this._readWechatIdFromCurrentPage();
      }
    }
    for (var i = 0; i < navigationDepth; i += 1) this.goHome();
    if (!profile.ok) {
      this._log("warn", "读取好友微信号失败", { chatName: chatName, code: profile.code || "WECHAT_ID_NOT_FOUND" });
      return { ok: false, code: profile.code || "WECHAT_ID_NOT_FOUND", chatName: chatName };
    }
    this._log("info", "已读取好友微信号", { chatName: chatName, wechatId: profile.wechatId });
    return { ok: true, chatName: chatName, wechatId: profile.wechatId };
  };
  Adapter.prototype.readLatestMessage = function (chatName, options) {
    var resolvedChatName = String(chatName || "");
    var preferProvidedChatName = !!(options && options.preferProvidedChatName);
    try {
      // Foreground list polling supplies the authoritative remark from the
      // conversation row. Notification handling has no row object, so it uses
      // the title rendered in the open chat header instead.
      if (!preferProvidedChatName) {
        var currentChatName = this.readCurrentChatName ? this.readCurrentChatName() : "";
        if (currentChatName) resolvedChatName = currentChatName;
      }
    } catch (ignoreChatName) {}
    this._detail("读取微信私聊最新气泡", { chatName: resolvedChatName });
    var selector = this._selector("classNameMatches", ".+");
    var values = [];
    try {
      var nodes = this._findAll(selector);
      var size = Math.min(this._collectionSize(nodes), 2000);
      var width = (typeof device !== "undefined" && device.width) ? Number(device.width) : 1080;
      var height = (typeof device !== "undefined" && device.height) ? Number(device.height) : 1920;
      var ignored = ["发送", "更多", "语音", "表情", "加号", "聊天信息", "按住说话"];
      for (var i = 0; i < size; i += 1) {
        var node = this._collectionGet(nodes, i);
        var text = this._normalizeUiText(this._nodeText(node));
        if (!text || text === this._normalizeUiText(resolvedChatName) || ignored.indexOf(text) >= 0 || this._isChatTimestampText(text)) continue;
        var bounds = this._uiBoundsMeta(node);
        if (!bounds || bounds.centerY < height * 0.16 || bounds.centerY > height * 0.86) continue;
        // Header labels and list controls are outside the message area. Keep both incoming and outgoing bubbles.
        if (bounds.right < width * 0.03 || bounds.left > width * 0.97) continue;
        var direction = bounds.centerX < width / 2 ? "incoming" : "outgoing";
        var duplicate = false;
        for (var j = 0; j < values.length; j += 1) {
          if (values[j].text === text && Math.abs(values[j].centerY - bounds.centerY) < 3) { duplicate = true; break; }
        }
        if (!duplicate) values.push({ text: text, direction: direction, bounds: bounds, centerY: bounds.centerY });
      }
    } catch (error) {
      this._detail("读取私聊气泡异常", { error: String(error) });
    }
    if (!values.length) return { ok: false, code: "MESSAGE_NOT_FOUND" };
    values.sort(function (a, b) { return b.centerY - a.centerY; });
    var latest = values[0];
    // The conversation list may expose an ellipsized remark. Resolve the full
    // remark only for that case, after the message bubble has been captured.
    if (this._isEllipsizedChatName(resolvedChatName) && this.readCurrentChatRemark) {
      var fullName = this.readCurrentChatRemark(resolvedChatName);
      if (fullName && fullName.ok && fullName.chatName) resolvedChatName = fullName.chatName;
    }
    this._detail("读取微信私聊最新气泡", { chatName: resolvedChatName });
    this._log("info", "已读取微信私聊最新消息", { chatName: resolvedChatName, text: latest.text, direction: latest.direction });
    return { ok: true, chatName: resolvedChatName, text: latest.text, direction: latest.direction, observedAt: Date.now() };
  };

  Adapter.prototype.sendText = function (text) {
    this._log("action", "发送微信私聊回复", { text: text });
    var input = this._findChatInput(2000);
    if (!input) return { ok: false, code: "CHAT_INPUT_NOT_FOUND" };
    if (!this._setText(input, text)) return { ok: false, code: "CHAT_INPUT_FAILED" };
    var send = this._findFirstByTexts(["发送"], 1500);
    if (!send) return { ok: false, code: "CHAT_SEND_BUTTON_NOT_FOUND" };
    if (!this._click(send)) return { ok: false, code: "CHAT_SEND_BUTTON_CLICK_FAILED" };
    this._sleep(600);
    if (this.isRateLimited()) return { ok: false, code: "WECHAT_RATE_LIMITED" };
    this._log("info", "微信私聊回复提交完成");
    return { ok: true };
  };

  Adapter.prototype.goHome = function () {
    this._detail("返回微信安全页面");
    try {
      if (typeof back === "function") {
        back();
        this._sleep(300);
        return { ok: true };
      }
    } catch (error) {
      this._detail("返回微信页面失败", { error: String(error) });
    }
    return { ok: false, code: "BACK_API_UNAVAILABLE" };
  };

  if (typeof module !== "undefined" && module.exports) {
    module.exports = { Adapter: Adapter };
  } else {
    this.WxBotWechatAdapter = { Adapter: Adapter };
  }
}());
