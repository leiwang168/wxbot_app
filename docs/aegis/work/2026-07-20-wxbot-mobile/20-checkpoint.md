# Todo Checkpoint

- Completed: project skeleton, defaults, migrations, storage, logger, dedupe, reply engine, state machine, queue, controller, adapter boundary, active friend-add flow, health and screenshot helpers, worker notification loop and runtime command channel.
- Completed: dashboard UI, permission buttons, task/result polling, rule editing, worker stop command, structured DETAIL/ACTION/INFO/WARN/ERROR logging and message-preview redaction.
- Verification: `node tests/run_tests.js` passes 8 tests; pure modules load successfully; Node syntax checks pass for all non-UI-JSX scripts; direct微信 UI API scan only reports `wechat/adapter.js` (plus intentional AutoX UI bindings in `main.js`).
- Active slice: real-device calibration and AutoX runtime validation.
- Blockers: real device selector values are not yet known; adapter uses candidate selectors and records calibration failures. `main.js` uses AutoX UI JSX and cannot be parsed by plain Node.
- Drift check: remains inside approved MVP; no passive friend-request acceptance or remote/MQTT surface added.
