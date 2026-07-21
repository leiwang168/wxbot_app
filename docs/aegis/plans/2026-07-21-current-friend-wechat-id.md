# 当前聊天好友资料读取实现计划

## Goal
在当前已打开的微信私聊中查看好友资料，读取好友微信号，写入 `logs/runtime.log`，并返回原聊天页面。

## Architecture
微信资料读取由 `wechat/adapter.js` 负责；`runtime/worker.js` 负责串行命令执行；`main.js` 负责用户触发和结果展示；测试集中在 `tests/run_tests.js`。

## Tech Stack
AutoX.js UI XML、Rhino JavaScript、Node.js 静态语法检查、现有 Store/Logger/TaskQueue。

## Baseline/Authority Refs
- `main.js`：固定主入口和现有命令按钮模式。
- `runtime/worker.js`：现有 runtime 命令分发和串行队列。
- `wechat/adapter.js`：微信 UI 定位、点击、文本读取和返回页面的唯一适配器。
- `diagnostics/logger.js`：项目日志写入 `logs/runtime.log`。

## Compatibility Boundary
- 不从聊天列表搜索联系人。
- 不点击其他联系人。
- 不改变现有通知监听、未读角标扫描和私聊读取流程。
- 资料读取失败必须返回明确错误并尽量返回原聊天页。
- 主入口仍为 `main.js`，不新增常驻死循环。

## Requirement Ready Check
已确认：目标是当前已经打开的聊天好友；结果至少包含联系人备注名和微信号；日志必须写入项目运行日志；操作完成后回到原聊天页。

## Files
- 修改 `wechat/adapter.js`：增加当前聊天资料入口、微信号提取、返回原聊天页。
- 修改 `runtime/worker.js`：增加 `read_current_friend_profile` 命令。
- 修改 `main.js`：增加“读取当前好友微信号”按钮和结果展示。
- 修改 `tests/run_tests.js`：覆盖微信号提取、资料读取成功和失败返回。

## Change Necessity
现有项目只有添加好友和私聊读取流程，没有资料页导航或微信号读取入口；必须在微信适配器增加该能力，并通过现有 runtime 命令边界触发，不能在 UI 层直接操作微信。

## Tasks
1. 在适配器中增加当前聊天标题点击和资料页微信号提取方法；使用现有 UI 选择、边界和返回方法；成功和失败都记录结构化日志。
2. 在 worker 命令分发中接入 `read_current_friend_profile`，将结果写入 `commandResult`。
3. 在主界面增加按钮和结果文本，点击前启动 worker 并写入命令。
4. 添加 Node 模拟控件测试，验证标签“微信号”旁边的值被读取，正文内容不能作为微信号，操作结束返回逻辑可调用。
5. 运行语法检查、全部测试、项目 JSON 校验和 Unicode 转义残留检查。

## Verification
- `node --check wechat/adapter.js`
- `node --check runtime/worker.js`
- `node --check tests/run_tests.js`
- `node tests/run_tests.js`
- `project.json` 可被 JSON 解析。
- 源码不出现 Unicode 转义编码。

## Risks
微信不同版本的资料页布局可能不同，微信号可能没有展示或被隐私设置隐藏；实现返回明确的 `WECHAT_ID_NOT_FOUND`，并记录候选控件诊断信息。

## Retirement
新命令复用现有 runtime 命令和适配器，不保留并行资料读取逻辑；若后续微信版本提供稳定资源 ID，应将文本候选读取收敛到资源 ID，并删除兼容扫描分支。