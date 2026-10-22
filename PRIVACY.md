# Privacy

DarkPanel collects nothing.

- No analytics, telemetry, crash reporting, accounts or ads.
- The extension makes no network requests. Its code contains no `fetch`, `XMLHttpRequest` or `WebSocket` calls; you can check this in `extensions/dark-panel`.
- Your list of protected sites, its settings and the blocked counter are stored in your browser profile (`chrome.storage.local`). They are not synced or uploaded. Removing the extension deletes them.
- Nothing is counted in private windows.

## Why it needs its permissions

| Permission | Used for |
|---|---|
| Access to all http/https sites | Running the popup guard on the sites you add. Pages of sites you haven't added are not modified. |
| `tabs`, `webNavigation` | Seeing which tab opened a new tab, and detecting redirects on protected sites |
| `scripting` | Registering the guard scripts for the sites in your list |
| `declarativeNetRequest` | Strict mode's block on navigations to other sites |
| `storage` | Saving your settings |
| `contentSettings` | The permission menus on the This site tab |
| `cookies`, `browsingData` | The cookie count and Clear site data |
| `management` | The Extensions tab (list, enable and disable) |

The contact link opens darkzmaj.eu only when you click it.
