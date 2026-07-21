# Reflection

- The main risk remains UI drift across WeChat versions and Android ROMs; candidate text selectors are intentionally conservative and must be calibrated on-device.
- Structured logs now expose each adapter boundary step while masking message-like fields, so troubleshooting can be detailed without persisting reply content in clear text.
- The worker and dashboard communicate through persisted runtime commands, which makes restart state inspectable but still depends on a single live worker instance.
- The MVP keeps the required human confirmation before every friend request and pauses on rate-limit signals; later batch features must not bypass these controls.
