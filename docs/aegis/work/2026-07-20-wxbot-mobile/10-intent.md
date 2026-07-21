# Task Intent Draft: AutoX.js 微信移动端 MVP

- Goal: 在 AutoX.js V6/Rhino 上实现同机微信自动化 MVP。
- Priority: 主动添加好友、私聊监听、关键词回复、白名单/黑名单、启停/日志/失败恢复。
- Non-goals: 被动通过好友申请、群聊、朋友圈、AI、CRM、MQTT、多账号、APK 打包。
- Compatibility: Android 8-14；微信控件必须通过真机校准，未知页面安全停止。
- Architecture boundary: 所有微信 UI 操作归 `wechat/adapter.js`；UI 只控制 worker，不直接操作微信。
- Baseline refs: `F:\github_work\wxbot_pyweixin\wxbot\friend_add.py`; `F:\github_work\wxbot_pyweixin\docs\API.md`; `F:\github_work\wxbot_pyweixin\docs\MANUAL.md`.
- Verification: Node 纯逻辑测试 + AutoX 语法/结构检查 + 真机手工验证清单。
