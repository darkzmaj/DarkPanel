# Changelog

## Unreleased

- Touch screens: 44 px tap targets, and the panel fits 360 px wide screens (it was 380 px minimum).
- Long site names no longer widen the panel.
- Phone-simulation tests (`tests/e2e/mobile.test.js`).

## 1.0.0 (2026-10-22)

First public release.

- Popup Guard: per-site blocking of popups, popunders, site-opened tabs, `target="_blank"` ad links, script redirects and popups from ad frames. Balanced and Strict modes, per-site switch, global switch, blocked counter, reset. `myflixerfree.io` preset to Strict.
- This site tab: connection status, per-site permissions, cookie count, clear site data, shortcuts to site settings and Shields.
- Extensions tab: list with icons, enable/disable, options and details.
- Graphite Dark theme.
- Optional Windows policy files to turn off Brave Wallet, Leo, News, VPN, Rewards and usage statistics.
