# wxbot_app

AutoX.js V6/Rhino 微信移动端自动化 MVP。

## 当前实现范围

- 主动添加好友：微信号/wxid、验证消息、备注、二次确认、频控、每日上限、任务记录。
- 主动给指定好友发消息：支持完整备注名或微信号/wxid 定位，定位后必须二次确认，支持冷却和每日上限。
- 私聊消息监听：通知唤醒、白名单/黑名单、关键词回复、去重和串行 UI 任务。
- MQTT：Paho MQTT 连接、订阅命令、事件上报、自动重连和命令白名单。
- 仪表盘：服务启停、权限检查、MQTT 配置、主动添加和主动消息表单、规则管理、日志。

## 运行方式

1. 将整个目录复制到 Android 设备上的 AutoX.js 工作目录。
2. 使用支持 MQTT 模块的 AutoX.js Rhino 版本（文档标注 MQTT 自 6.5.9 新增），然后运行 `main.js`。
3. 首次运行按界面提示开启无障碍和通知监听权限。
4. 在“主动添加”页面搜索目标，确认搜索结果后发送好友申请。
5. 在“主动发消息”页面输入好友完整备注名或微信号/wxid，定位成功后确认发送消息。
6. 如需远程控制，在“MQTT 远程控制与状态上报”区域填写 broker、唯一 clientId 和主题，保存后启用 MQTT。
7. 在“回复规则”页面配置私聊白名单和关键词规则。

## 重要限制

微信不同版本和厂商 ROM 的控件文本、层级及资源 ID 可能不同。`wechat/adapter.js` 已使用候选选择器和失败截图，但首次部署仍需在目标手机上校准搜索、添加、发送和聊天气泡控件。

默认安全策略：主动添加和主动发消息都必须二次确认；达到每日上限、发送冷却或检测到微信风控后暂停；主动发消息确认时如果当前聊天对象已变化则拒绝发送；无法识别页面或消息方向时不点击、不回复。

## Node 逻辑测试

```powershell
node tests/run_tests.js
```

测试不需要微信或 AutoX 运行时，只覆盖配置、状态机、任务队列、去重、关键词规则和主动添加业务层。

## 详情日志

应用日志现在保存为结构化记录，并在仪表盘“运行日志”区域显示最近 15 条：

- `DETAIL`：选择器检查、页面导航、输入框读取、通知唤醒、串行队列和冷却等待等步骤；
- `ACTION`：搜索目标、用户确认、提交申请、发送回复、启动/停止 worker 等动作；
- `INFO/WARN/ERROR`：成功、未找到、限流、控件异常和 worker 异常；
- 每条记录包含 ISO 时间、级别、消息和 JSON 详情字段，便于定位失败步骤；
- `preview`、`message`、`reply`、`verifyText` 等消息类字段默认脱敏，最多保留有限长度；
- 仍保留最近 200 条日志，失败截图路径由诊断模块单独记录。

- `logLine` 按 `[YYYY-MM-DD HH:mm:ss]` 格式写入 AutoX 控制台，并同步写入项目 `logs/runtime.log`；首次部署前请确认 AutoX 对项目目录有写入权限。


## 打包

项目入口和 AutoX 打包配置位于根目录 project.json，主入口固定为 main.js。

## MQTT 集成

仪表盘的“MQTT 远程控制与状态上报”区域用于配置 broker、唯一 `clientId`、认证信息和主题。配置保存后启用 MQTT，并启动自动化 worker；`mqtt/client.js` 使用 AutoX.js Rhino 可用的 Paho MQTT Android 客户端连接、订阅和发布。

- 命令主题：默认 `wxbot/{clientId}/command`；事件主题：默认 `wxbot/{clientId}/event`。
- `{clientId}` 会替换为当前设备的 MQTT clientId；多个设备必须使用不同 clientId。
- MQTT JSON 命令格式：

```json
{"id":"cmd-001","type":"proactive_message_search","payload":{"target":"好友完整备注名","message":"你好"}}
```

- 允许的命令来自 `config/defaults.js` 的 `mqtt.allowedCommands`，收到后仍进入 worker 串行队列。
- `proactive_message_confirm` 必须携带搜索结果返回的 `taskId`；主动消息的对象校验、冷却、每日上限和二次确认不会因 MQTT 而跳过。
- 事件主题会发布 `connected`、`subscribed`、`command_result` 和 `command_rejected` 等事件；消息正文在 MQTT 结果中脱敏。
- 生产环境应优先使用 `ssl://`、账号密码或 broker 的 ACL，并限制命令主题只允许可信控制端发布。
