// Locates a Chromium for tooling/tests without downloading one: TEST_CHROMIUM,
// then any Playwright-managed Chromium already on this machine.
import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';

export function chromiumPath() {
  if (process.env.TEST_CHROMIUM) return process.env.TEST_CHROMIUM;
  const root = process.env.PLAYWRIGHT_BROWSERS_PATH ||
    (process.platform === 'win32' ? join(homedir(), 'AppData/Local/ms-playwright')
      : process.platform === 'darwin' ? join(homedir(), 'Library/Caches/ms-playwright')
        : join(homedir(), '.cache/ms-playwright'));
  if (!existsSync(root)) return undefined;
  const dirs = readdirSync(root).filter((d) => /^chromium-\d+$/.test(d)).sort().reverse();
  for (const d of dirs) {
    for (const exe of ['chrome-win64/chrome.exe', 'chrome-win/chrome.exe', 'chrome-linux64/chrome', 'chrome-linux/chrome',
      'chrome-mac/Chromium.app/Contents/MacOS/Chromium']) {
      if (existsSync(join(root, d, exe))) return join(root, d, exe);
    }
  }
  return undefined; // fall back to Playwright's own default
}
