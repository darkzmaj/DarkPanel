# Popup Guard (in Dark Panel)

## Why the old extension's "add website" failed
In `brave-myflixer-popup-guard-v2`, `popup.js` called `chrome.permissions.request()` (an optional host permission) and only **after** it resolved sent the `add` message to the service worker. Opening the permission prompt closes the action popup, which destroys its JS context, so the `add` message was never sent and nothing was saved. Even when the message was sent, `modify()` refused any domain without granted host access.

The fix: host access is declared in the manifest (granted when you load the extension), so there is no runtime permission prompt. The service worker validates, persists and applies every change, and the UI only sends messages. Settings changes are accepted only from the extension's own pages, checked by sender URL origin.

## Rules
- Input is normalized (`https://www.Example.com/x` → `example.com`; IDNs → punycode; `javascript:`, `file:`, IPv6 and credentials are rejected).
- A rule `example.com` covers `example.com` and **all subdomains**, matched on label boundaries only. `notexample.com` and `example.com.evil.net` never match. The most specific rule wins.
- The config persists in `chrome.storage.local` (profile-local, never uploaded). All writes go through one queue, so there are no lost updates. Defaults: `myflixerfree.io` in **Strict** mode. A list you emptied yourself stays empty.
- Incognito: the same rules apply, and no statistics are recorded for private windows.

## Modes
| | Balanced (default) | Strict |
|---|---|---|
| `window.open` without a click | blocked | blocked |
| `window.open` from a click | allowed if it stays on the site, otherwise the tab is closed | blocked |
| `target=_blank` link | to the same site: allowed; external: blocked | to the same site: allowed; external: blocked |
| Ctrl/middle-click, "Open link in new tab" | allowed | same site only |
| Normal external link click | allowed | blocked |
| Script / meta redirect off-site | blocked | blocked |
| Off-site form submission | from script: blocked | blocked |

Strict can break sign-in pages, payment providers, and links you deliberately follow to other sites. Use it only on sites such as streaming mirrors.

## Enforcement layers
1. **MAIN-world guard** (`content/page-guard.js`, document_start, all frames of protected sites): replaces `window.open`, cancels script navigations through the Navigation API's `navigate` event (pre-emptive, verified by test), and guards `form.submit()`.
2. **ISOLATED-world guard** (`content/link-guard.js`): handles clicks/submits with the exact rule scope, treats synthetic `a.click()` as untrusted, and sends "user approved" signals for Ctrl/middle/context-menu opens.
3. **Strict:** a `declarativeNetRequest` rule blocks main-frame requests that the protected site initiates to other sites.
4. **Service-worker backstop:** closes unsolicited tabs whose opener tab is protected, which covers popups from third-party ad iframes, and reverts client redirects that left the site.

## Known limitations
- Popups from **cross-site iframes** are closed right after creation, not prevented, so a tab can flash briefly.
- An ad script that grabs `window.open` from a freshly created `about:blank` iframe before injection can bypass layer 1; layer 4 still closes the tab.
- The MAIN-world guard approximates "same site" (current host, its parents and its children). Sibling subdomains count as external for **script** navigations only.
- Redirects that a server performs off-site (HTTP 3xx) are allowed in Balanced mode.
- The rules apply to new page loads. Reload already-open tabs after you change settings.

## Tests
- `npm test`: normalization, IDN, matching, add/remove/toggle/mode, persistence across restart, concurrent writes, reset isolation, decision tables.
- `npm run test:e2e`: real headless Chromium, local `*.test` sites, and Chromium's own popup blocker **disabled**, so every block observed comes from Popup Guard. Covers add/reject in the UI, unsolicited popup, click popup to an ad, same-site window, Ctrl+click approval, `_blank` overlay, script redirect (verified pre-emptive), third-party iframe popup, unprotected site unaffected, strict mode, restart persistence, per-site toggle, and removal.
