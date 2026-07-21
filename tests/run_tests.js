"use strict";

var assert = require("assert");
var defaults = require("../config/defaults");
var migrations = require("../storage/migrations");
var Store = require("../storage/store").Store;
var Logger = require("../diagnostics/logger").Logger;
var ReplyEngine = require("../rules/reply_engine").ReplyEngine;
var Dedupe = require("../rules/dedupe").Dedupe;
var StateMachine = require("../runtime/state_machine").StateMachine;
var TaskQueue = require("../runtime/task_queue").TaskQueue;
var FriendAddFlow = require("../wechat/friend_add_flow").FriendAddFlow;
var ProactiveMessageFlow = require("../wechat/proactive_message_flow").ProactiveMessageFlow;
var WechatAdapter = require("../wechat/adapter").Adapter;
var MqttClient = require("../mqtt/client").MqttClient;
var parseMqttCommand = require("../mqtt/client").parseCommand;

var passed = 0;
function test(name, fn) {
  try {
    fn();
    passed += 1;
    console.log("ok - " + name);
  } catch (error) {
    console.error("not ok - " + name);
    throw error;
  }
}

function makeStore() {
  return new Store("test." + Math.random().toString(16).slice(2), defaults, migrations);
}

function makeLogger(store) {
  return new Logger(store, { limit: 200 });
}

test("mqtt command parser enforces the allowlist and preserves payload", function () {
  var parsed = parseMqttCommand({ topic: "wxbot/device/command", payload: JSON.stringify({ id: "c1", type: "proactive_message_search", payload: { target: "Alice", message: "hello" } }) }, ["proactive_message_search"]);
  assert.strictEqual(parsed.ok, true);
  assert.strictEqual(parsed.command.id, "c1");
  assert.strictEqual(parsed.command.payload.target, "Alice");
  assert.strictEqual(parseMqttCommand({ payload: JSON.stringify({ type: "stop_worker" }) }, ["proactive_message_search"]).code, "MQTT_COMMAND_NOT_ALLOWED");
  assert.strictEqual(parseMqttCommand({ payload: "not-json" }, []).code, "MQTT_COMMAND_JSON_INVALID");
});

test("mqtt client uses configured topics and drains inbound messages", function () {
  var fake = { client: null, options: null };
  function FakeOptions() { this.values = {}; }
  FakeOptions.prototype.setAutomaticReconnect = function (value) { this.values.autoReconnect = value; };
  FakeOptions.prototype.setCleanSession = function (value) { this.values.cleanSession = value; };
  FakeOptions.prototype.setUserName = function (value) { this.values.username = value; };
  FakeOptions.prototype.setPassword = function (value) { this.values.password = value; };
  FakeOptions.prototype.setWill = function () { this.values.will = Array.prototype.slice.call(arguments); };
  function FakeClient(context, uri, id) {
    this.context = context; this.uri = uri; this.id = id; this.published = [];
    fake.client = this;
  }
  FakeClient.prototype.setCallback = function (callback) { this.callback = callback; };
  FakeClient.prototype.connect = function (options, userdata, listener) { fake.options = options; listener.onSuccess(); this.callback.connectComplete(false, this.uri); };
  FakeClient.prototype.subscribe = function (topic, qos, userdata, listener) { this.topic = topic; this.qos = qos; listener.onSuccess(); };
  FakeClient.prototype.publish = function (topic, bytes, qos, retained) { this.published.push({ topic: topic, payload: String(bytes), qos: qos, retained: retained }); };
  FakeClient.prototype.close = function () {};
  FakeClient.prototype.disconnect = function () {};
  var events = [];
  var client = new MqttClient({
    context: {},
    config: { enabled: true, serverUri: "tcp://broker:1883", clientId: "device-1", commandTopic: "in/{clientId}", eventTopic: "out/{clientId}", username: "u", password: "p" },
    api: { MqttAndroidClient: FakeClient, MqttConnectOptions: FakeOptions, MqttCallbackExtended: function (value) { return value; }, IMqttActionListener: function (value) { return value; } },
    onEvent: function (event) { events.push(event.type); }
  });
  assert.strictEqual(client.start().ok, true);
  assert.strictEqual(client.status().connected, true);
  assert.strictEqual(fake.client.topic, "in/device-1");
  fake.client.callback.messageArrived("in/device-1", { toString: function () { return JSON.stringify({ type: "scan_wechat_badges" }); } });
  var received = [];
  assert.strictEqual(client.drainMessages(1, function (item) { received.push(item.topic); }), 1);
  assert.deepStrictEqual(received, ["in/device-1"]);
  assert.strictEqual(client.publishEvent("status", { ok: true }).topic, "out/device-1");
  assert.ok(events.indexOf("connected") >= 0);
});

test("defaults normalize and legacy keyword migration", function () {
  var config = migrations.migrate({ keyword_dict: { hello: "world" } }, defaults);
  assert.strictEqual(config.version, 1);
  assert.strictEqual(config.replyRules.length, 1);
  assert.strictEqual(config.replyRules[0].keyword, "hello");
  assert.strictEqual(config.replyRules[0].reply, "world");
});

test("logger writes structured detail and masks message previews", function () {
  var store = makeStore();
  var logger = new Logger(store, { limit: 200, maskMessagePreview: true });
  logger.detail("detail step", { target: "wxid_abc", preview: "message preview", candidateCount: 2 });
  var entry = store.getLogs()[0];
  assert.strictEqual(entry.level, "DETAIL");
  assert.strictEqual(entry.meta.target, "wxid_abc");
  assert.ok(entry.meta.preview.indexOf("chars]") >= 0);
  assert.strictEqual(entry.meta.candidateCount, 2);
  assert.ok(logger.format(entry).indexOf("candidateCount") >= 0);
});

test("reply engine applies blacklist, whitelist and first matching rule", function () {
  var engine = new ReplyEngine({
    privateChat: { enabled: true, listenMode: "whitelist", whitelist: ["Alice"], blacklist: ["Blocked"] },
    replyRules: [
      { id: "r1", enabled: true, keyword: "hi", match: "contains", reply: "hello" },
      { id: "r2", enabled: true, keyword: "hello", match: "exact", reply: "exact" }
    ]
  });
  assert.strictEqual(engine.match({ chatName: "Bob", direction: "incoming", text: "hi" }).action, "ignore");
  assert.strictEqual(engine.match({ chatName: "Blocked", direction: "incoming", text: "hi" }).action, "ignore");
  assert.strictEqual(engine.match({ chatName: "Alice", direction: "outgoing", text: "hi" }).action, "ignore");
  assert.strictEqual(engine.match({ chatName: "Alice", direction: "incoming", text: "say hi" }).text, "hello");
  assert.strictEqual(engine.match({ chatName: "Alice", direction: "incoming", text: "hello" }).rule.id, "r2");
});

test("dedupe records recent event and expires old event", function () {
  var store = makeStore();
  var dedupe = new Dedupe(store, 100);
  assert.strictEqual(dedupe.seen("abc", 1000), false);
  assert.strictEqual(dedupe.seen("abc", 1050), true);
  assert.strictEqual(dedupe.seen("abc", 1201), false);
});

test("state machine rejects invalid transitions", function () {
  var machine = new StateMachine("STOPPED");
  machine.transition("STARTING");
  machine.transition("READY");
  machine.transition("MONITORING");
  assert.throws(function () { machine.transition("SENT"); }, /Invalid state transition/);
});

test("task queue is serial and drain is bounded", function () {
  var queue = new TaskQueue();
  var result = [];
  queue.enqueue("one", function () { result.push(1); });
  queue.enqueue("two", function () { result.push(2); });
  assert.strictEqual(queue.drain(1), 1);
  assert.deepStrictEqual(result, [1]);
  assert.strictEqual(queue.drain(5), 1);
  assert.deepStrictEqual(result, [1, 2]);
});

test("wechat unread badge uses the avatar-side red badge position", function () {
  var adapter = new WechatAdapter({ packageName: "com.tencent.mm" });
  var badge = {
    text: function () { return "1"; },
    desc: function () { return ""; },
    bounds: function () { return { left: 117, top: 322, right: 159, bottom: 365 }; },
    className: function () { return "android.widget.TextView"; },
    parent: function () { return { text: function () { return "磊哥TS"; }, parent: function () { return null; } }; }
  };
  adapter._selector = function () { return {}; };
  adapter._findAll = function () { return [badge]; };
  var candidates = adapter._collectUnreadBadgeCandidates(922, 2048);
  assert.strictEqual(candidates.length, 1);
  assert.strictEqual(candidates[0].unreadCount, 1);
  assert.strictEqual(candidates[0].bounds.centerX, 138);
});

test("wechat unread badge carries the conversation-list contact remark", function () {
  var adapter = new WechatAdapter({ packageName: "com.tencent.mm" });
  var badge = {
    text: function () { return "1"; },
    bounds: function () { return { left: 117, top: 322, right: 159, bottom: 365 }; },
    parent: function () { return null; }
  };
  var nodes = [
    badge,
    { text: function () { return "磊哥TS"; }, bounds: function () { return { left: 176, top: 330, right: 390, bottom: 375 }; } },
    { text: function () { return "我要买啊"; }, bounds: function () { return { left: 176, top: 385, right: 420, bottom: 430 }; } },
    { text: function () { return "上午9:24"; }, bounds: function () { return { left: 780, top: 330, right: 900, bottom: 375 }; } }
  ];
  adapter._selector = function () { return {}; };
  adapter._findAll = function () { return nodes; };
  var candidates = adapter._collectUnreadBadgeCandidates(922, 2048);
  assert.strictEqual(candidates.length, 1);
  assert.strictEqual(candidates[0].chatName, "磊哥TS");
});

test("wechat latest-message keeps the supplied conversation-list remark", function () {
  var adapter = new WechatAdapter({ packageName: "com.tencent.mm" });
  adapter.readCurrentChatName = function () { return "错误的聊天标题"; };
  adapter._selector = function () {
    return { find: function () {
      return [{ text: function () { return "我要买啊"; }, bounds: function () { return { left: 80, top: 1000, right: 360, bottom: 1060 }; } }];
    } };
  };
  var result = adapter.readLatestMessage("磊哥TS", { preferProvidedChatName: true });
  assert.strictEqual(result.ok, true);
  assert.strictEqual(result.chatName, "磊哥TS");
});

test("scanUnreadBadges never clicks the contact row", function () {
  var adapter = new WechatAdapter({ packageName: "com.tencent.mm" });
  var clicked = 0;
  adapter.isWechatForeground = function () { return true; };
  adapter.openConversationList = function () { return { ok: true }; };
  adapter._sleep = function () {};
  adapter._collectUnreadBadgeCandidates = function () {
    return [{
      source: "numeric_text",
      unreadCount: 1,
      text: "1",
      description: "",
      bounds: { left: 117, top: 322, right: 159, bottom: 365, centerX: 138, centerY: 343.5 },
      className: "android.widget.TextView",
      resourceName: "",
      clickable: false,
      ancestors: [{ level: 1, text: "磊哥TS", description: "" }]
    }];
  };
  adapter._click = function () { clicked += 1; return true; };
  var result = adapter.scanUnreadBadges();
  assert.strictEqual(result.ok, true);
  assert.strictEqual(result.clicked, false);
  assert.strictEqual(result.badges.length, 1);
  assert.strictEqual(clicked, 0);
});

test("wechat chat title uses the centered contact remark instead of floating-window controls", function () {
  var adapter = new WechatAdapter({ packageName: "com.tencent.mm" });
  var nodes = [
    { text: function () { return "浮窗"; }, bounds: function () { return { left: 820, top: 108, right: 900, bottom: 168 }; } },
    { text: function () { return "聊天信息"; }, bounds: function () { return { left: 930, top: 108, right: 1040, bottom: 168 }; } },
    { text: function () { return "昨天 晚上6:44"; }, bounds: function () { return { left: 420, top: 106, right: 640, bottom: 164 }; } },
    { text: function () { return "磊哥TS"; }, bounds: function () { return { left: 430, top: 112, right: 650, bottom: 168 }; } },
    { text: function () { return "最新消息"; }, bounds: function () { return { left: 380, top: 500, right: 700, bottom: 560 }; } }
  ];
  adapter.isChatScreen = function () { return true; };
  adapter._selector = function () { return { find: function () { return nodes; } }; };
  assert.strictEqual(adapter.readCurrentChatName(), "磊哥TS");
});
test("wechat chat body text is never used as the contact remark", function () {
  var adapter = new WechatAdapter({ packageName: "com.tencent.mm" });
  var nodes = [{ text: function () { return "我要买啊"; }, bounds: function () { return { left: 420, top: 300, right: 650, bottom: 380 }; } }];
  adapter.isChatScreen = function () { return true; };
  adapter._selector = function () { return { find: function () { return nodes; } }; };
  assert.strictEqual(adapter.readCurrentChatName(), "");
});
test("wechat latest-message payload prefers the detected contact remark", function () {
  var adapter = new WechatAdapter({ packageName: "com.tencent.mm" });
  var loggedMeta = null;
  adapter.logger = { info: function (message, meta) { loggedMeta = meta; } };
  adapter.readCurrentChatName = function () { return "磊哥TS"; };
  adapter._selector = function () {
    return { find: function () {
      return [{ text: function () { return "要买啊"; }, bounds: function () { return { left: 80, top: 1000, right: 360, bottom: 1060 }; } }];
    } };
  };
  var result = adapter.readLatestMessage("通知标题");
  assert.strictEqual(result.ok, true);
  assert.strictEqual(result.chatName, "磊哥TS");
  assert.strictEqual(result.text, "要买啊");
  assert.strictEqual(loggedMeta.chatName, "磊哥TS");
});
test("wechat latest-message ignores Chinese timestamp labels", function () {
  var adapter = new WechatAdapter({ packageName: "com.tencent.mm" });
  adapter.readCurrentChatName = function () { return "磊哥TS"; };
  adapter._selector = function () {
    return { find: function () {
      return [
        { text: function () { return "你好"; }, bounds: function () { return { left: 80, top: 980, right: 300, bottom: 1040 }; } },
        { text: function () { return "昨天 晚上6:44"; }, bounds: function () { return { left: 420, top: 1060, right: 620, bottom: 1100 }; } },
        { text: function () { return "上午10:10"; }, bounds: function () { return { left: 620, top: 1120, right: 820, bottom: 1160 }; } }
      ];
    } };
  };
  var result = adapter.readLatestMessage("通知标题");
  assert.strictEqual(result.ok, true);
  assert.strictEqual(result.text, "你好");
});
test("wechat long conversation name is recognized as ellipsized", function () {
  var adapter = new WechatAdapter({ packageName: "com.tencent.mm" });
  assert.strictEqual(adapter._isEllipsizedChatName("磊哥年轻牛逼威武霸气帅气-1..."), true);
  assert.strictEqual(adapter._isEllipsizedChatName("磊哥年轻牛逼威武霸气帅气-1又长备注"), false);
});

test("wechat profile locators select the top-right more button and info avatar", function () {
  var adapter = new WechatAdapter({ packageName: "com.tencent.mm" });
  var more = {
    text: function () { return ""; },
    desc: function () { return "more"; },
    className: function () { return "android.widget.ImageButton"; },
    clickable: function () { return true; },
    bounds: function () { return { left: 1000, top: 40, right: 1060, bottom: 100 }; }
  };
  var avatar = {
    text: function () { return ""; },
    desc: function () { return ""; },
    className: function () { return "android.widget.ImageView"; },
    bounds: function () { return { left: 40, top: 220, right: 160, bottom: 340 }; }
  };
  adapter.isChatScreen = function () { return true; };
  adapter._selector = function () { return {}; };
  adapter._findAll = function () { return [more, avatar]; };
  assert.strictEqual(adapter._findChatMoreButton(), more);
  assert.strictEqual(adapter._findChatInfoAvatar("Alice"), avatar);
});

test("wechat latest-message resolves a full remark after list truncation", function () {
  var adapter = new WechatAdapter({ packageName: "com.tencent.mm" });
  adapter.readCurrentChatRemark = function () {
    return { ok: true, chatName: "磊哥年轻牛逼威武霸气帅气-1又长备注", source: "remark_editor" };
  };
  adapter._selector = function () {
    return { find: function () {
      return [{ text: function () { return "最新消息"; }, bounds: function () { return { left: 80, top: 1000, right: 360, bottom: 1060 }; } }];
    } };
  };
  var result = adapter.readLatestMessage("磊哥年轻牛逼威武霸气帅气-1...", { preferProvidedChatName: true });
  assert.strictEqual(result.ok, true);
  assert.strictEqual(result.chatName, "磊哥年轻牛逼威武霸气帅气-1又长备注");
});

test("wechat full remark navigation uses more and chat info avatar", function () {
  var adapter = new WechatAdapter({ packageName: "com.tencent.mm" });
  var page = "chat";
  var clicks = [];
  var backCount = 0;
  var more = { name: "more" };
  var avatar = { name: "avatar" };
  adapter.isChatScreen = function () { return page === "chat"; };
  adapter._collectCurrentChatTitleCandidates = function () { return [{ node: { name: "title" }, text: "LongRemark..." }]; };
  adapter._findChatMoreButton = function () { return more; };
  adapter._findChatInfoAvatar = function () { return avatar; };
  adapter._findFirstByTexts = function () { return { name: "chat-info-title" }; };
  adapter._click = function (node) {
    clicks.push(node.name);
    if (node === more) page = "chat-info";
    if (node === avatar) page = "profile";
    return true;
  };
  adapter._readWechatIdFromCurrentPage = function () { return { ok: true, wechatId: "wxid_long" }; };
  adapter._readRemarkNameFromCurrentPage = function () { return { ok: true, chatName: "LongRemarkFull", source: "remark_adjacent" }; };
  adapter._sleep = function () {};
  adapter.goHome = function () { backCount += 1; page = backCount === 1 ? "chat-info" : "chat"; return { ok: true }; };
  var result = adapter.readCurrentChatRemark("LongRemark...");
  assert.strictEqual(result.ok, true);
  assert.strictEqual(result.chatName, "LongRemarkFull");
  assert.deepStrictEqual(clicks, ["more", "avatar"]);
  assert.strictEqual(backCount, 2);
});

test("wechat profile reads an adjacent WeChat ID value", function () {
  var adapter = new WechatAdapter({ packageName: "com.tencent.mm" });
  var nodes = [
    { text: function () { return "微信号"; }, bounds: function () { return { left: 300, top: 500, right: 420, bottom: 550 }; } },
    { text: function () { return "wxid_alice"; }, bounds: function () { return { left: 440, top: 500, right: 700, bottom: 550 }; } }
  ];
  adapter._selector = function () { return { find: function () { return nodes; } }; };
  var result = adapter._readWechatIdFromCurrentPage();
  assert.strictEqual(result.ok, true);
  assert.strictEqual(result.wechatId, "wxid_alice");
  assert.strictEqual(result.source, "adjacent");
});

test("wechat profile reads an inline WeChat ID value", function () {
  var adapter = new WechatAdapter({ packageName: "com.tencent.mm" });
  var nodes = [{ text: function () { return "微信号：abc123"; }, bounds: function () { return { left: 300, top: 500, right: 700, bottom: 550 }; } }];
  adapter._selector = function () { return { find: function () { return nodes; } }; };
  var result = adapter._readWechatIdFromCurrentPage();
  assert.strictEqual(result.ok, true);
  assert.strictEqual(result.wechatId, "abc123");
  assert.strictEqual(result.source, "inline");
});

test("wechat profile reports a stable error when WeChat ID is absent", function () {
  var adapter = new WechatAdapter({ packageName: "com.tencent.mm" });
  var nodes = [{ text: function () { return "地区"; }, bounds: function () { return { left: 300, top: 500, right: 700, bottom: 550 }; } }];
  adapter._selector = function () { return { find: function () { return nodes; } }; };
  var result = adapter._readWechatIdFromCurrentPage();
  assert.strictEqual(result.ok, false);
  assert.strictEqual(result.code, "WECHAT_ID_NOT_FOUND");
});

test("wechat profile reads remark and WeChat ID through chat info avatar", function () {
  var adapter = new WechatAdapter({ packageName: "com.tencent.mm" });
  var page = "chat";
  var backCount = 0;
  var clicks = [];
  var more = { name: "more" };
  var avatar = { name: "avatar" };
  adapter.isChatScreen = function () { return page === "chat"; };
  adapter._collectCurrentChatTitleCandidates = function () { return [{ node: { name: "title" }, text: "AliceRemark" }]; };
  adapter._findChatMoreButton = function () { return more; };
  adapter._findChatInfoAvatar = function () { return avatar; };
  adapter._findFirstByTexts = function () { return { name: "chat-info-title" }; };
  adapter._click = function (node) {
    clicks.push(node.name);
    if (node === more) page = "chat-info";
    if (node === avatar) page = "profile";
    return true;
  };
  adapter._readWechatIdFromCurrentPage = function () { return { ok: true, wechatId: "wxid_alice", source: "adjacent" }; };
  adapter._readRemarkNameFromCurrentPage = function () { return { ok: true, chatName: "AliceRemarkFull", source: "remark_adjacent" }; };
  adapter._sleep = function () {};
  adapter.goHome = function () { backCount += 1; page = backCount === 1 ? "chat-info" : "chat"; return { ok: true }; };
  var result = adapter.readCurrentFriendProfile();
  assert.strictEqual(result.ok, true);
  assert.strictEqual(result.chatName, "AliceRemarkFull");
  assert.strictEqual(result.remarkName, "AliceRemarkFull");
  assert.strictEqual(result.wechatId, "wxid_alice");
  assert.deepStrictEqual(clicks, ["more", "avatar"]);
  assert.strictEqual(backCount, 2);
});

test("wechat profile returns to chat after missing WeChat ID", function () {
  var adapter = new WechatAdapter({ packageName: "com.tencent.mm" });
  var page = "chat";
  var backCount = 0;
  var more = { name: "more" };
  var avatar = { name: "avatar" };
  adapter.isChatScreen = function () { return page === "chat"; };
  adapter._collectCurrentChatTitleCandidates = function () { return [{ node: { name: "title" }, text: "Alice" }]; };
  adapter._findChatMoreButton = function () { return more; };
  adapter._findChatInfoAvatar = function () { return avatar; };
  adapter._findFirstByTexts = function () { return { name: "chat-info-title" }; };
  adapter._click = function (node) { if (node === more) page = "chat-info"; if (node === avatar) page = "profile"; return true; };
  adapter._readWechatIdFromCurrentPage = function () { return { ok: false, code: "WECHAT_ID_NOT_FOUND" }; };
  adapter._readRemarkNameFromCurrentPage = function () { return { ok: true, chatName: "AliceFull", source: "profile_visible_name" }; };
  adapter._sleep = function () {};
  adapter.goHome = function () { backCount += 1; page = backCount === 1 ? "chat-info" : "chat"; return { ok: true }; };
  var result = adapter.readCurrentFriendProfile();
  assert.strictEqual(result.ok, false);
  assert.strictEqual(result.code, "WECHAT_ID_NOT_FOUND");
  assert.strictEqual(result.chatName, "AliceFull");
  assert.strictEqual(result.remarkName, "AliceFull");
  assert.strictEqual(backCount, 2);
});

test("proactive message flow locates a full remark and requires confirmation", function () {
  var store = makeStore();
  var logger = makeLogger(store);
  var now = 1700000000000;
  var calls = [];
  var adapter = {
    openChatByTarget: function (target) { calls.push("open:" + target); return { ok: true, chatName: "Alice 的完整备注" }; },
    verifyCurrentChatTarget: function (target, name) { calls.push("verify:" + target + ":" + name); return { ok: true }; },
    sendText: function (message) { calls.push("send:" + message); return { ok: true }; }
  };
  var flow = new ProactiveMessageFlow({ store: store, adapter: adapter, logger: logger, clock: function () { return now; } });
  var searched = flow.search({ target: "Alice 的完整备注", message: "你好，主动消息" });
  assert.strictEqual(searched.ok, true);
  assert.strictEqual(searched.task.type, "proactive_message");
  assert.strictEqual(searched.task.status, "waiting_confirm");
  assert.deepStrictEqual(calls, ["open:Alice 的完整备注"]);
  var sent = flow.confirm(searched.task.id);
  assert.strictEqual(sent.ok, true);
  assert.strictEqual(sent.task.status, "sent");
  assert.deepStrictEqual(calls, ["open:Alice 的完整备注", "verify:Alice 的完整备注:Alice 的完整备注", "send:你好，主动消息"]);
  assert.strictEqual(store.getRuntime().lastProactiveMessageAt, now);
});

test("proactive message flow accepts a WeChat ID and blocks cooldown", function () {
  var store = makeStore();
  var logger = makeLogger(store);
  var now = 1700000000000;
  var adapter = {
    openChatByTarget: function (target) { return { ok: true, chatName: "Alice" , target: target }; },
    verifyCurrentChatTarget: function () { return { ok: true }; },
    sendText: function () { return { ok: true }; }
  };
  var flow = new ProactiveMessageFlow({ store: store, adapter: adapter, logger: logger, clock: function () { return now; } });
  var searched = flow.search({ target: "wxid_alice", message: "测试" });
  assert.strictEqual(searched.ok, true);
  assert.strictEqual(flow.confirm(searched.task.id).ok, true);
  var blocked = flow.search({ target: "wxid_bob", message: "再次测试" });
  assert.strictEqual(blocked.ok, false);
  assert.strictEqual(blocked.guard.code, "PROACTIVE_MESSAGE_COOLDOWN");
});

test("proactive message flow refuses to send after chat target changes", function () {
  var store = makeStore();
  var logger = makeLogger(store);
  var adapter = {
    openChatByTarget: function () { return { ok: true, chatName: "Alice" }; },
    verifyCurrentChatTarget: function () { return { ok: false, code: "CHAT_TARGET_CHANGED" }; },
    sendText: function () { throw new Error("must not send"); }
  };
  var flow = new ProactiveMessageFlow({ store: store, adapter: adapter, logger: logger, clock: function () { return 1700000000000; } });
  var task = flow.search({ target: "Alice", message: "不应发送" }).task;
  var result = flow.confirm(task.id);
  assert.strictEqual(result.ok, false);
  assert.strictEqual(result.task.status, "failed");
  assert.strictEqual(result.task.errorCode, "CHAT_TARGET_CHANGED");
});

test("active friend add flow requires confirmation and records sent task", function () {
  var store = makeStore();
  var logger = makeLogger(store);
  var now = 1700000000000;
  var calls = [];
  var adapter = {
    openAddFriend: function () { calls.push("open"); return { ok: true }; },
    searchFriend: function (target) { calls.push("search:" + target); return { ok: true }; },
    readSearchResult: function () { calls.push("read"); return { status: "found", nickname: "Alice" }; },
    fillFriendRequest: function () { calls.push("fill"); return { ok: true }; },
    submitFriendRequest: function () { calls.push("submit"); return { ok: true }; }
  };
  var flow = new FriendAddFlow({ store: store, adapter: adapter, logger: logger, clock: function () { return now; } });
  var searched = flow.search({ target: "alice123", verifyText: "Hi", remark: "Alice" });
  assert.strictEqual(searched.ok, true);
  assert.strictEqual(searched.task.status, "waiting_confirm");
  assert.deepStrictEqual(calls, ["open", "search:alice123", "read"]);
  var sent = flow.confirm(searched.task.id);
  assert.strictEqual(sent.ok, true);
  assert.strictEqual(sent.task.status, "sent");
  assert.deepStrictEqual(calls, ["open", "search:alice123", "read", "fill", "submit"]);
  assert.strictEqual(store.getRuntime().lastFriendAddAt, now);
});

test("active friend add flow pauses after rate limit", function () {
  var store = makeStore();
  var logger = makeLogger(store);
  var now = 1700000000000;
  var adapter = {
    openAddFriend: function () { return { ok: true }; },
    searchFriend: function () { return { ok: true }; },
    readSearchResult: function () { return { status: "found", nickname: "Alice" }; },
    fillFriendRequest: function () { return { ok: true }; },
    submitFriendRequest: function () { return { ok: false, code: "WECHAT_RATE_LIMITED" }; }
  };
  var flow = new FriendAddFlow({ store: store, adapter: adapter, logger: logger, clock: function () { return now; } });
  var task = flow.search({ target: "alice123" }).task;
  var result = flow.confirm(task.id);
  assert.strictEqual(result.task.status, "rate_limited");
  assert.strictEqual(store.getRuntime().friendRateLimitedUntil, now + 3600 * 1000);
  var blocked = flow.search({ target: "bob123" });
  assert.strictEqual(blocked.ok, false);
  assert.strictEqual(blocked.guard.code, "WECHAT_RATE_LIMITED");
});

console.log("\nPassed " + passed + " tests.");


