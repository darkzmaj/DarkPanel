# Brave Dark setup

Your normal Brave (auto-updating, nothing forked) plus:

| Piece | What it gives you |
|---|---|
| `extensions/dark-panel` | **Dark Panel**: Popup Guard, per-site controls and an extensions menu in one toolbar icon |
| `themes/graphite-dark` | Black/graphite browser theme |
| `brave-policies/*.reg` | Turns off Brave Wallet, Leo AI, News, VPN, Rewards and usage pings |

## Install (about 2 minutes)
1. `brave://extensions` → turn on **Developer mode** (top right) → **Load unpacked** → pick `extensions\dark-panel`. Repeat for `themes\graphite-dark`.
2. Click the puzzle icon → pin **Dark Panel**.
3. `brave://settings/appearance` → **Brave colors: Dark**. To hide the puzzle icon, right-click it and look for "Hide" or "Unpin"; whether Brave offers this depends on your version.
4. Optional: double-click `brave-policies\disable-brave-extras.reg` (asks for admin) and restart Brave. Brave then shows "Managed by your organization", which is expected. Undo with `enable-brave-extras.reg`.

Keep the folder where it is: unpacked extensions load from it.

## Dark Panel
- **This site**: HTTPS status; Popup Guard status with "Protect this site"; JavaScript, pop-ups, cookies, images, notifications, location, camera, microphone and download permissions; cookie count; clear site data; shortcuts to full site settings and Shields settings.
- **Popup Guard**: add domains or full URLs, Balanced/Strict per site, per-site on/off, remove, blocked counter, reset. `myflixerfree.io` comes preset to Strict. Full behavior and limits: `docs/POPUP_GUARD.md`.
- **Extensions**: every installed extension with icon, on/off switch, Options and Details, plus Manage extensions.
- Footer: Darky community Discord. Everything is stored locally; nothing is uploaded.

## What extensions can't do
Brave doesn't let extensions change its own UI, so these aren't possible this way: centered bookmarks with hover names, a centered address bar, putting items into Brave's main menu or its site-info (lock icon) menu, and opening *other* extensions' popups from a list.

## Development
`npm test` (unit) · `npm run test:e2e` (headless Chromium) · `npm run icons` (re-render icons from `assets/icon.svg`)
