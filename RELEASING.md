# Releasing

1. Update `version` in `extensions/dark-panel/manifest.json`, `themes/graphite-dark/manifest.json` (if the theme changed) and `package.json`.
2. Add an entry to `CHANGELOG.md`.
3. Run `npm test` and `npm run test:e2e`.
4. Run `npm run package`. This writes `dist/darkpanel-<version>.zip` and `dist/graphite-dark-<version>.zip`. The packaged manifest has no `key` field.
5. Commit, then tag: `git tag v<version>` and `git push origin main --tags`.
6. The **Release** workflow builds the ZIPs and attaches them to a GitHub release for the tag. To do it by hand instead: `gh release create v<version> dist/*.zip --notes-file <notes>`.

## Chrome Web Store (optional)

Upload `dist/darkpanel-<version>.zip` in the Chrome Web Store developer dashboard. The store asks why each permission is needed; the answers are in `PRIVACY.md`.
