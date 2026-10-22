# Contributing

Bug reports and pull requests are welcome.

## Reporting a bug

Open an issue with:
- DarkPanel version (shown in `brave://extensions`) and browser version
- the site, if it's public and safe to share, and its mode (Balanced or Strict)
- what you expected and what happened

For sites with aggressive ads, please describe the behavior instead of linking to it.

## Pull requests

1. Fork the repository and create a branch.
2. `npm ci`, then make your change.
3. Add or update tests. Popup Guard behavior changes need a browser test in `tests/e2e/`.
4. Run `npm test` and `npm run test:e2e`. Both must pass.
5. Keep the extension free of network requests, remote code and new permissions unless the change requires them; explain any new permission in the PR and in `PRIVACY.md`.
6. Describe what changed and why.

## Code style

Plain JavaScript modules, no build step and no runtime dependencies. Match the surrounding code. Rule logic belongs in `extensions/dark-panel/core/`, which must not use browser APIs.

By contributing you agree that your contribution is licensed under the MIT License.
