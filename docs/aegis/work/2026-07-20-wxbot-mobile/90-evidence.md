# Verification Evidence

Date: 2026-07-20

## Automated checks

- `node tests/run_tests.js`
  - Result: passed 8 tests.
  - Covers defaults/migration, structured logger redaction, reply matching, dedupe, state transitions, serial queue, active friend-add confirmation, and rate-limit pause.
- Node module loading
  - Result: passed for config, storage, diagnostics/logger, rules, runtime pure modules, friend-add flow, and adapter.
- Node syntax checks
  - Result: passed for all non-UI-JSX JavaScript modules.
- UI boundary scan
  - Result: direct微信控件 selectors and actions are confined to `wechat/adapter.js`; `main.js` only uses AutoX UI widgets for the app dashboard.

## Manual checks still required

- Android 8–14 representative devices.
- Current WeChat version selector calibration for 添加朋友、搜索、添加到通讯录、验证消息、备注、发送.
- AutoX notification listener API and notification getter compatibility.
- AutoX UI JSX rendering and `engines.execScriptFile()` worker lifecycle.
- Failure screenshot directory and storage persistence on device.
- Real success, not-found, ambiguous, rate-limit, network-failure, and restart/recovery flows.

No real device was connected in this workspace, so real微信 UI success is not claimed.
