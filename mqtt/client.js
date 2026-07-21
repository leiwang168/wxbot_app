(function () {
  "use strict";

  function now() { return Date.now(); }

  function text(value) {
    try { return value === null || value === undefined ? "" : String(value); } catch (ignore) { return ""; }
  }

  function parseJson(value) {
    try { return JSON.parse(text(value)); } catch (ignore) { return null; }
  }

  function clone(value) {
    try { return JSON.parse(JSON.stringify(value)); } catch (ignore) { return value; }
  }

  function defaultLogger() {
    return {
      debug: function () {},
      detail: function () {},
      info: function () {},
      warn: function () {},
      error: function () {},
      action: function () {}
    };
  }

  function javaStringBytes(value) {
    var message = text(value);
    if (typeof java !== "undefined" && java.lang && java.lang.String) {
      return new java.lang.String(message).getBytes("UTF-8");
    }
    return message;
  }

  function javaMessageText(message) {
    try {
      if (message && typeof message.getPayload === "function" && typeof java !== "undefined" && java.lang && java.lang.String) {
        return new java.lang.String(message.getPayload(), "UTF-8").toString();
      }
    } catch (ignorePayload) {}
    try { return message === null || message === undefined ? "" : String(message); } catch (ignore) { return ""; }
  }

  function passwordChars(value) {
    var password = text(value);
    try {
      if (typeof Array !== "undefined" && Array.from) return Array.from(password);
    } catch (ignoreArrayFrom) {}
    return password.split("");
  }

  function loadPahoApi() {
    if (typeof importPackage !== "function" || typeof importClass !== "function" || typeof Packages === "undefined") {
      throw new Error("AutoX Rhino MQTT API unavailable");
    }
    importPackage(Packages["org.eclipse.paho.client.mqttv3"]);
    importClass("org.eclipse.paho.client.mqttv3.MqttAsyncClient");
    return {
      MqttAsyncClient: MqttAsyncClient,
      MqttConnectOptions: MqttConnectOptions,
      MqttCallbackExtended: MqttCallbackExtended,
      IMqttActionListener: IMqttActionListener
    };
  }

  function normalizeConfig(config) {
    config = config || {};
    return {
      enabled: config.enabled === true,
      serverUri: text(config.serverUri || config.url).trim(),
      clientId: text(config.clientId).trim(),
      username: text(config.username),
      password: text(config.password),
      commandTopic: text(config.commandTopic || "wxbot/command").trim(),
      eventTopic: text(config.eventTopic || "wxbot/event").trim(),
      qos: Math.max(0, Math.min(2, Number(config.qos === undefined ? 1 : config.qos))),
      retained: config.retained === true,
      cleanSession: config.cleanSession !== false,
      autoReconnect: config.autoReconnect !== false,
      reconnectIntervalSec: Math.max(3, Number(config.reconnectIntervalSec || 10)),
      willTopic: text(config.willTopic).trim(),
      willMessage: text(config.willMessage || "offline"),
      willQos: Math.max(0, Math.min(2, Number(config.willQos === undefined ? 1 : config.willQos))),
      willRetained: config.willRetained !== false,
      allowedCommands: (Array.isArray(config.allowedCommands) ? config.allowedCommands : []).map(function (item) { return text(item).trim(); }).filter(function (item) { return !!item; })
    };
  }

  function expandTopic(topic, clientId) {
    return text(topic).replace(/\{clientId\}/g, text(clientId));
  }

  function MqttClient(options) {
    options = options || {};
    this.getConfig = options.getConfig || function () { return options.config || {}; };
    this.logger = options.logger || defaultLogger();
    this.onEvent = options.onEvent || function () {};
    this.onMessage = options.onMessage || function () {};
    this.context = options.context || (typeof context !== "undefined" ? context : null);
    this.api = options.api || null;
    this.client = null;
    this.config = null;
    this.clientId = "";
    this.connected = false;
    this.connecting = false;
    this.started = false;
    this.lastError = "";
    this.lastErrorAt = 0;
    this.connectedAt = 0;
    this.nextConnectAt = 0;
    this.lastConfigKey = "";
    this.inbox = [];
    this.subscriptionRequested = false;
  }

  MqttClient.prototype._config = function () {
    return normalizeConfig(this.getConfig() || {});
  };

  MqttClient.prototype._configKey = function (config) {
    return [config.serverUri, config.clientId, config.username, config.password, config.commandTopic, config.eventTopic, config.qos, config.retained, config.cleanSession, config.autoReconnect, config.reconnectIntervalSec, config.willTopic, config.willMessage, config.willQos, config.willRetained].join("|");
  };

  MqttClient.prototype._emit = function (type, meta) {
    var event = { type: type, at: now(), meta: clone(meta || {}) };
    try { this.onEvent(event); } catch (ignoreCallback) {}
    return event;
  };

  MqttClient.prototype._setError = function (error, code) {
    this.lastError = code ? code + ": " + text(error) : text(error);
    this.lastErrorAt = now();
    this.logger.error("MQTT " + this.lastError, { code: code || "MQTT_ERROR" });
    this._emit("error", { code: code || "MQTT_ERROR", error: this.lastError });
  };

  MqttClient.prototype._api = function () {
    if (!this.api) this.api = loadPahoApi();
    return this.api;
  };

  MqttClient.prototype._makeOptions = function (config) {
    var api = this._api();
    var options = new api.MqttConnectOptions();
    options.setAutomaticReconnect(config.autoReconnect);
    options.setCleanSession(config.cleanSession);
    if (config.username) options.setUserName(config.username);
    if (config.password) options.setPassword(passwordChars(config.password));
    if (config.willTopic) options.setWill(expandTopic(config.willTopic, this.clientId), javaStringBytes(config.willMessage), config.willQos, config.willRetained);
    return options;
  };

  MqttClient.prototype._subscribe = function () {
    var self = this;
    var config = this.config;
    if (!this.client || !this.connected || !config.commandTopic || this.subscriptionRequested) return false;
    this.subscriptionRequested = true;
    try {
      this.client.subscribe(expandTopic(config.commandTopic, this.clientId), config.qos, null, new (this._api().IMqttActionListener)({
        onSuccess: function () {
          self.subscriptionRequested = false;
          self.logger.info("MQTT 命令主题订阅成功", { topic: expandTopic(config.commandTopic, self.clientId), qos: config.qos });
          self._emit("subscribed", { topic: expandTopic(config.commandTopic, self.clientId), qos: config.qos });
        },
        onFailure: function (token, error) {
          self.subscriptionRequested = false;
          self._setError(error, "MQTT_SUBSCRIBE_FAILED");
        }
      }));
      return true;
    } catch (error) {
      this.subscriptionRequested = false;
      this._setError(error, "MQTT_SUBSCRIBE_EXCEPTION");
      return false;
    }
  };

  MqttClient.prototype._connect = function () {
    var self = this;
    var config = this.config || this._config();
    if (!config.serverUri || !config.clientId) {
      this._setError("请配置 broker 地址和 clientId", "MQTT_CONFIG_INCOMPLETE");
      this.nextConnectAt = now() + config.reconnectIntervalSec * 1000;
      return false;
    }
    try {
      var api = this._api();
      this.subscriptionRequested = false;
      // Use the Java async client so AutoX child engines do not bind the Android MQTT service.
      this.client = new api.MqttAsyncClient(config.serverUri, this.clientId, null);
      this.client.setCallback(new api.MqttCallbackExtended({
        connectComplete: function (reconnect, serverUri) {
          self.connecting = false;
          self.connected = true;
          self.connectedAt = now();
          self.lastError = "";
          self.lastErrorAt = 0;
          self.logger.info("MQTT 连接成功", { reconnect: !!reconnect, serverUri: text(serverUri) });
          self._emit("connected", { reconnect: !!reconnect, serverUri: text(serverUri) });
          self._subscribe();
        },
        connectionLost: function (cause) {
          self.connected = false;
          self.connecting = config.autoReconnect !== false;
          self.subscriptionRequested = false;
          self.nextConnectAt = now() + config.reconnectIntervalSec * 1000;
          self.logger.warn("MQTT 连接丢失", { cause: text(cause) });
          self._emit("disconnected", { cause: text(cause) });
        },
        messageArrived: function (topic, message) {
          var item = { topic: text(topic), payload: javaMessageText(message), receivedAt: now() };
          if (self.inbox.length >= 100) self.inbox.shift();
          self.inbox.push(item);
          try { self.onMessage(item); } catch (ignoreMessageCallback) {}
        },
        deliveryComplete: function () {}
      }));
      this.connecting = true;
      this.client.connect(this._makeOptions(config), null, new api.IMqttActionListener({
        onSuccess: function () {
          // Some Paho versions invoke connectComplete only for reconnects.
          if (self.connected) self._subscribe();
          self.logger.debug("MQTT connect token 已完成", {});
        },
        onFailure: function (token, error) {
          self.connected = false;
          self.connecting = false;
          self.nextConnectAt = now() + config.reconnectIntervalSec * 1000;
          self._setError(error, "MQTT_CONNECT_FAILED");
        }
      }));
      return true;
    } catch (error) {
      this.connected = false;
      this.connecting = false;
      this.nextConnectAt = now() + config.reconnectIntervalSec * 1000;
      this._setError(error, "MQTT_CONNECT_EXCEPTION");
      return false;
    }
  };

  MqttClient.prototype.start = function () {
    var config = this._config();
    this.started = true;
    this.config = config;
    this.clientId = config.clientId;
    this.lastConfigKey = this._configKey(config);
    if (!config.enabled) return { ok: true, disabled: true };
    if (this.connected || this.connecting) return { ok: true, connected: this.connected, connecting: this.connecting };
    return { ok: this._connect(), connecting: this.connecting };
  };

  MqttClient.prototype.stop = function () {
    var client = this.client;
    this.started = false;
    this.connected = false;
    this.connecting = false;
    this.subscriptionRequested = false;
    this.client = null;
    if (!client) return true;
    try { if (typeof client.disconnect === "function") client.disconnect(); } catch (ignoreDisconnect) {}
    try { if (typeof client.close === "function") client.close(); } catch (ignoreClose) {}
    this._emit("disconnected", { reason: "stopped" });
    return true;
  };

  MqttClient.prototype.tick = function () {
    var config = this._config();
    var key = this._configKey(config);
    if (key !== this.lastConfigKey) {
      this.logger.info("MQTT 配置已变化，重建连接", {});
      this.stop();
      this.config = config;
      this.clientId = config.clientId;
      this.lastConfigKey = key;
    }
    this.config = config;
    if (!config.enabled) {
      if (this.client || this.connected || this.connecting) this.stop();
      return;
    }
    this.started = true;
    this.clientId = config.clientId;
    if (!this.connected && !this.connecting && now() >= this.nextConnectAt) this._connect();
  };

  MqttClient.prototype.publish = function (topic, payload, qos, retained) {
    if (!this.client || !this.connected) return { ok: false, code: "MQTT_NOT_CONNECTED" };
    var target = expandTopic(topic, this.clientId);
    try {
      this.client.publish(target, javaStringBytes(typeof payload === "string" ? payload : JSON.stringify(payload)), qos === undefined ? this.config.qos : qos, retained === undefined ? this.config.retained : retained);
      return { ok: true, topic: target };
    } catch (error) {
      this._setError(error, "MQTT_PUBLISH_FAILED");
      return { ok: false, code: "MQTT_PUBLISH_FAILED", error: text(error) };
    }
  };

  MqttClient.prototype.publishEvent = function (event, payload) {
    if (!this.config) this.config = this._config();
    return this.publish(this.config.eventTopic, { event: event, clientId: this.clientId, at: now(), payload: payload || {} });
  };

  MqttClient.prototype.drainMessages = function (limit, handler) {
    var count = 0;
    var max = Number(limit || 10);
    while (count < max && this.inbox.length) {
      var item = this.inbox.shift();
      try { handler(item); } catch (error) { this._setError(error, "MQTT_MESSAGE_HANDLER_FAILED"); }
      count += 1;
    }
    return count;
  };

  MqttClient.prototype.status = function () {
    return {
      enabled: !!(this.config && this.config.enabled),
      connected: this.connected,
      connecting: this.connecting,
      clientId: this.clientId,
      lastError: this.lastError,
      lastErrorAt: this.lastErrorAt,
      connectedAt: this.connectedAt,
      nextConnectAt: this.nextConnectAt,
      inboxSize: this.inbox.length
    };
  };

  function parseCommand(item, allowedCommands) {
    var body = parseJson(item && item.payload);
    if (!body || typeof body !== "object") return { ok: false, code: "MQTT_COMMAND_JSON_INVALID" };
    var type = text(body.type || body.command).trim();
    var payload = body.payload && typeof body.payload === "object" ? body.payload : body;
    var allowed = allowedCommands || [];
    if (!type) return { ok: false, code: "MQTT_COMMAND_TYPE_REQUIRED" };
    if (allowed.length && allowed.indexOf(type) < 0) return { ok: false, code: "MQTT_COMMAND_NOT_ALLOWED", type: type };
    return {
      ok: true,
      command: {
        id: text(body.id || "mqtt-" + now().toString(36) + "-" + Math.floor(Math.random() * 100000).toString(36)),
        type: type,
        payload: payload,
        createdAt: now(),
        source: "mqtt",
        topic: text(item && item.topic)
      }
    };
  }

  if (typeof module !== "undefined" && module.exports) {
    module.exports = {
      MqttClient: MqttClient,
      normalizeConfig: normalizeConfig,
      parseCommand: parseCommand,
      expandTopic: expandTopic,
      loadPahoApi: loadPahoApi
    };
  } else {
    this.WxBotMqtt = {
      MqttClient: MqttClient,
      normalizeConfig: normalizeConfig,
      parseCommand: parseCommand,
      expandTopic: expandTopic,
      loadPahoApi: loadPahoApi
    };
  }
}());
