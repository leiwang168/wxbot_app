(function () {
  "use strict";

  var memoryStores = {};

  function MemoryStorage(name) {
    this.name = name;
    memoryStores[name] = memoryStores[name] || {};
    this.data = memoryStores[name];
  }
  MemoryStorage.prototype.get = function (key, fallback) { return this.data.hasOwnProperty(key) ? this.data[key] : fallback; };
  MemoryStorage.prototype.put = function (key, value) { this.data[key] = JSON.parse(JSON.stringify(value)); };
  MemoryStorage.prototype.remove = function (key) { delete this.data[key]; };

  function createStorage(name) {
    if (typeof storages !== "undefined" && storages && storages.create) return storages.create(name);
    return new MemoryStorage(name);
  }

  function Store(namespace, defaultsModule, migrationsModule) {
    this.namespace = namespace;
    this.defaultsModule = defaultsModule;
    this.migrationsModule = migrationsModule;
    this.configStorage = createStorage(namespace + ".config");
    this.runtimeStorage = createStorage(namespace + ".runtime");
    this.tasksStorage = createStorage(namespace + ".tasks");
    this.dedupeStorage = createStorage(namespace + ".dedupe");
    this.logsStorage = createStorage(namespace + ".logs");
  }

  Store.prototype.loadConfig = function () {
    var raw = this.configStorage.get("config", null);
    var config = this.migrationsModule.migrate(raw || {}, this.defaultsModule);
    this.configStorage.put("config", config);
    return config;
  };
  Store.prototype.saveConfig = function (config) {
    var normalized = this.defaultsModule.normalize(config || {});
    this.configStorage.put("config", normalized);
    return normalized;
  };
  Store.prototype.updateConfig = function (patch) {
    var config = this.loadConfig();
    Object.keys(patch || {}).forEach(function (key) {
      if (patch[key] && typeof patch[key] === "object" && !Array.isArray(patch[key]) && config[key] && typeof config[key] === "object") {
        Object.keys(patch[key]).forEach(function (nestedKey) { config[key][nestedKey] = patch[key][nestedKey]; });
      } else config[key] = patch[key];
    });
    return this.saveConfig(config);
  };
  Store.prototype.getRuntime = function () { return this.runtimeStorage.get("runtime", {}); };
  Store.prototype.setRuntime = function (patch) {
    var runtime = this.getRuntime();
    Object.keys(patch || {}).forEach(function (key) { runtime[key] = patch[key]; });
    runtime.updatedAt = Date.now();
    this.runtimeStorage.put("runtime", runtime);
    return runtime;
  };
  Store.prototype.clearRuntime = function () { this.runtimeStorage.put("runtime", {}); };
  Store.prototype.getTasks = function () { return this.tasksStorage.get("tasks", []); };
  Store.prototype.saveTasks = function (tasks) { this.tasksStorage.put("tasks", (tasks || []).slice(-200)); return this.getTasks(); };
  Store.prototype.addTask = function (task) { var tasks = this.getTasks(); tasks.push(task); return this.saveTasks(tasks); };
  Store.prototype.updateTask = function (id, patch) {
    var tasks = this.getTasks();
    tasks.forEach(function (task) { if (task.id === id) Object.keys(patch || {}).forEach(function (key) { task[key] = patch[key]; }); });
    this.saveTasks(tasks);
    return tasks.filter(function (task) { return task.id === id; })[0] || null;
  };
  Store.prototype.getDedupe = function () { return this.dedupeStorage.get("items", {}); };
  Store.prototype.saveDedupe = function (items) { this.dedupeStorage.put("items", items || {}); };
  Store.prototype.getLogs = function () { return this.logsStorage.get("logs", []); };
  Store.prototype.saveLogs = function (logs, limit) { this.logsStorage.put("logs", (logs || []).slice(-(limit || 200))); };

  if (typeof module !== "undefined" && module.exports) module.exports = { Store: Store, createStorage: createStorage };
  else this.WxBotStore = { Store: Store, createStorage: createStorage };
}());
