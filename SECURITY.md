# Security policy

## Reporting a vulnerability

Please report security problems privately through the contact form at https://darkzmaj.eu/#contact, not in a public issue. Include the DarkPanel version, browser version, and steps to reproduce. You'll get a reply within a week.

## Supported versions

Only the latest release receives fixes.

## Design notes

- Web pages are treated as hostile. Settings can be changed only from the extension's own pages; messages from content scripts can't change settings.
- Messages a page could forge only affect the blocked counter, and they're rate-limited.
- Stored settings are validated every time they're read.
- The extension loads no remote code and makes no network requests.
