# 仓库指南

## 项目结构与模块组织

本仓库是基于 AutoX.js V6/Rhino 的微信移动端自动化 MVP。`main.js` 是应用入口，`project.json` 保存 AutoX 打包和权限配置。

- `config/`：默认配置与配置规范化。
- `runtime/`：控制器、Worker、状态机和串行任务队列。
- `wechat/`：微信 UI 适配器及主动添加好友流程；选择器修改应集中在此处。
- `rules/`：回复匹配与消息去重。
- `storage/`：数据持久化和数据结构迁移。
- `diagnostics/`：日志、健康检查和失败截图。
- `tests/`：基于 Node.js 的逻辑测试，入口为 `tests/run_tests.js`。
- `xuqiu/`：需求或参考图片；`logs/` 保存运行输出，不应提交运行日志。

## 构建、测试与开发命令

在仓库根目录运行逻辑测试：

```sh
node tests/run_tests.js
```

测试不需要 AutoX.js 或 Android 设备。端到端验证时，将仓库复制到 Android 设备的 AutoX.js 工作目录并运行 `main.js`，同时确认已开启无障碍和通知监听权限。使用 `project.json` 进行应用打包。本仓库没有包管理器、独立构建脚本或已配置的代码检查工具。

## 编码风格与命名约定

使用兼容 Rhino/AutoX.js 的 CommonJS JavaScript：`var`、`require` 和 `module.exports`。遵循现有的四空格缩进、分号和双引号风格。构造函数式导出使用 `PascalCase`（如 `ReplyEngine`），函数和变量使用 `camelCase`；持久化或配置字段可按现有约定使用 `snake_case`。微信 UI 选择器及相关行为应保持在 `wechat/adapter.js` 内。

## 测试规范

在 `tests/run_tests.js` 中使用 Node.js 内置 `assert` 和现有的 `test("描述", function () { ... })` 模式编写回归测试。重点覆盖配置、状态转换、队列行为、规则匹配和选择器边界情况。提交前运行完整测试命令；当前没有正式的覆盖率要求。

## 提交与合并请求规范

近期提交使用简短、命令式的中文说明，例如 `修复长备注联系人名称读取`。提交应保持单一目的，并描述行为变化而非实现细节。合并请求应说明修改的业务流程、测试命令及结果，并注明 AutoX/Android/微信版本或设备假设。涉及仪表盘或选择器的修改，应附截图或相关日志；如有对应需求或 issue，请一并关联。

## 安全与配置提示

不要提交运行日志、凭据、联系人数据或设备专属状态。必须保留二次确认、每日上限、黑白名单和消息方向判断等安全限制；无法识别选择器或页面状态时，应采取不点击、不回复的保守策略。
