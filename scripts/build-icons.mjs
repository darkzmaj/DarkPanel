// Renders assets/icon.svg to the extension's PNG icons with a local Chromium.
import { chromium } from 'playwright';
import { readFileSync, writeFileSync } from 'node:fs';
import { chromiumPath } from './browser.mjs';

const svg = readFileSync(new URL('../assets/icon.svg', import.meta.url), 'utf8');
const browser = await chromium.launch({ executablePath: chromiumPath() });
const page = await browser.newPage();
for (const size of [16, 32, 48, 128]) {
  await page.setViewportSize({ width: size, height: size });
  await page.setContent(`<body style="margin:0">${svg.replace('<svg ', `<svg width="${size}" height="${size}" `)}</body>`);
  writeFileSync(new URL(`../extensions/dark-panel/icons/icon${size}.png`, import.meta.url),
    await page.screenshot({ omitBackground: true }));
}
await browser.close();
