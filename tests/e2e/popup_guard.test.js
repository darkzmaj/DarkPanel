// Behavioral tests: real (headless) Chromium + the Popup Guard extension +
// local pages served under fake *.test hostnames. Chromium's own popup blocker
// is disabled so every block observed here is Popup Guard's doing.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { chromiumPath } from '../../scripts/browser.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '../..');
const EXT = join(root, 'extensions/dark-panel');
const EXT_ID = 'ggifibhodlacedemomakcpddllllcofa';
const FIXTURE = join(root, 'tests/e2e/fixture-ext');
const THEME = join(root, 'themes/graphite-dark');
const settle = (ms = 700) => new Promise((r) => setTimeout(r, ms));

let server, port, profile, ctx;
const url = (host, path) => `http://${host}:${port}${path}`;

const PAGES = {
  '/popup.html': () => `<button id="ext" onclick="window.open('${url('ads.test', '/ad.html')}')">ext</button>
    <button id="same" onclick="window.open('${url('www.protected.test', '/ok.html')}')">same</button>
    <a id="extlink" href="${url('ads.test', '/ad.html')}">link</a>
    <script>if (location.search === '?auto') window.open('${url('ads.test', '/ad.html')}');</script>`,
  '/redirect.html': () => `<p>redirecting</p><script>setTimeout(() => { location.href = '${url('ads.test', '/ad.html')}'; }, 150);</script>`,
  '/blank.html': () => `<a id="overlay" target="_blank" href="${url('ads.test', '/ad.html')}" style="position:fixed;inset:0">x</a>`,
  '/iframe.html': () => `<iframe id="f" src="${url('ads.test', '/frame.html')}" width="300" height="200"></iframe>`,
  '/frame.html': () => `<button id="b" style="width:100%;height:150px" onclick="window.open('${url('ads.test', '/ad.html')}')">play</button>`,
  '/ad.html': () => '<h1>AD</h1>',
  '/ok.html': () => '<h1>OK</h1>',
};

async function launch() {
  ctx = await chromium.launchPersistentContext(profile, {
    executablePath: chromiumPath(),
    headless: true,
    args: [
      `--disable-extensions-except=${EXT},${FIXTURE},${THEME}`, `--load-extension=${EXT},${FIXTURE},${THEME}`,
      '--host-resolver-rules=MAP *.test 127.0.0.1', '--disable-popup-blocking',
    ],
  });
  if (!ctx.serviceWorkers().length) await ctx.waitForEvent('serviceworker');
  await settle(300);
}

async function ui() {
  const p = await ctx.newPage();
  await p.goto(`chrome-extension://${EXT_ID}/ui/guard.html#guard`);
  await p.waitForSelector('#sites li');
  return p;
}

async function pagesAfter(fn) {
  const before = new Set(ctx.pages());
  await fn();
  await settle();
  return ctx.pages().filter((p) => !before.has(p) && !p.isClosed());
}

async function closeAllButOne() {
  const pages = ctx.pages();
  for (const p of pages.slice(1)) await p.close();
  return pages[0] || ctx.newPage();
}

before(async () => {
  server = http.createServer((req, res) => {
    const body = PAGES[req.url.split('?')[0]];
    res.writeHead(body ? 200 : 404, { 'content-type': 'text/html' });
    res.end(body ? `<!doctype html><title>t</title>${body()}` : 'nf');
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  port = server.address().port;
  profile = mkdtempSync(join(tmpdir(), 'bravedark-pg-'));
  await launch();
});

after(async () => {
  await ctx?.close();
  server?.close();
  rmSync(profile, { recursive: true, force: true });
});

test('settings UI: adds a valid domain, rejects an invalid one, MyFlixer preset is Strict', async () => {
  const p = await ui();
  assert.equal(await p.locator('li[data-domain="myflixerfree.io"] select').inputValue(), 'strict');
  await p.fill('#domain', 'not a domain');
  await p.click('form button[type=submit]');
  await p.waitForSelector('#notice.error');
  await p.fill('#domain', `https://www.protected.test:${port}/some/page`);
  await p.click('form button[type=submit]');
  await p.waitForSelector('li[data-domain="protected.test"]');
  assert.equal(await p.locator('li[data-domain="protected.test"] select').inputValue(), 'balanced');
  assert.equal(await p.textContent('#count'), '2');
  await p.close();
});

test('blocks unsolicited window.open on a protected site and counts it', async () => {
  const p = await closeAllButOne();
  const opened = await pagesAfter(() => p.goto(url('protected.test', '/popup.html?auto')));
  assert.equal(opened.length, 0);
  const s = await ui();
  assert.ok(Number(await s.textContent('#blocked')) >= 1, 'blocked counter increments');
  await s.close();
});

test('balanced: user click opening an external ad window is closed, same-site window allowed', async () => {
  const p = await closeAllButOne();
  await p.goto(url('protected.test', '/popup.html'));
  assert.equal((await pagesAfter(() => p.click('#ext'))).length, 0);
  const same = await pagesAfter(() => p.click('#same'));
  assert.equal(same.length, 1);
  assert.match(same[0].url(), /protected\.test/);
});

test('balanced: user-approved new tab (Ctrl+click) stays open', async () => {
  const p = await closeAllButOne();
  await p.goto(url('protected.test', '/popup.html'));
  const opened = await pagesAfter(() => p.click('#extlink', { modifiers: ['Control'] }));
  assert.equal(opened.length, 1);
});

test('blocks target=_blank ad overlays', async () => {
  const p = await closeAllButOne();
  await p.goto(url('protected.test', '/blank.html'));
  assert.equal((await pagesAfter(() => p.mouse.click(50, 50))).length, 0);
});

test('blocks script redirects away from a protected site', async () => {
  const p = await closeAllButOne();
  await p.goto(url('protected.test', '/redirect.html'));
  await settle(1200);
  assert.match(p.url(), /protected\.test:\d+\/redirect\.html/);
  // Pre-emptive: the Navigation API guard cancels it, the page never unloads.
  assert.equal(await p.evaluate(() => performance.getEntriesByType('navigation').length), 1);
  assert.equal(await p.textContent('p'), 'redirecting');
});

test('closes popups triggered from a third-party iframe', async () => {
  const p = await closeAllButOne();
  await p.goto(url('protected.test', '/iframe.html'));
  const frame = p.frameLocator('#f');
  await frame.locator('#b').waitFor();
  assert.equal((await pagesAfter(() => frame.locator('#b').click())).length, 0);
});

test('non-protected websites are unaffected', async () => {
  const p = await closeAllButOne();
  assert.equal((await pagesAfter(() => p.goto(url('other.test', '/popup.html?auto')))).length, 1);
  await closeAllButOne();
  await p.goto(url('other.test', '/redirect.html'));
  await settle(1200);
  assert.match(p.url(), /ads\.test/);
});

test('strict mode blocks same-site windows and external link clicks', async () => {
  const s = await ui();
  await s.selectOption('li[data-domain="protected.test"] select', 'strict');
  await settle(300);
  await s.close();
  const p = await closeAllButOne();
  await p.goto(url('protected.test', '/popup.html'));
  assert.equal((await pagesAfter(() => p.click('#same'))).length, 0);
  await p.click('#extlink');
  await settle();
  assert.match(p.url(), /protected\.test/);
});

test('protection persists after a browser restart', async () => {
  await ctx.close();
  await launch();
  const p = await closeAllButOne();
  assert.equal((await pagesAfter(() => p.goto(url('protected.test', '/popup.html?auto')))).length, 0);
  const s = await ui();
  assert.equal(await s.locator('li[data-domain="protected.test"] select').inputValue(), 'strict');
  await s.close();
});

test('per-domain switch off disables protection; on re-enables it', async () => {
  let s = await ui();
  await s.click('li[data-domain="protected.test"] .switch input');
  await settle(300);
  await s.close();
  let p = await closeAllButOne();
  assert.equal((await pagesAfter(() => p.goto(url('protected.test', '/popup.html?auto')))).length, 1);
  s = await ui();
  await s.click('li[data-domain="protected.test"] .switch input');
  await settle(300);
  await s.close();
  p = await closeAllButOne();
  assert.equal((await pagesAfter(() => p.goto(url('protected.test', '/popup.html?auto')))).length, 0);
});

test('removing a domain removes its rules', async () => {
  const s = await ui();
  await s.click('li[data-domain="protected.test"] .remove');
  await s.waitForSelector('li[data-domain="protected.test"]', { state: 'detached' });
  await settle(300);
  await s.close();
  const p = await closeAllButOne();
  assert.equal((await pagesAfter(() => p.goto(url('protected.test', '/popup.html?auto')))).length, 1);
});

test('site tab: changing a permission writes the browser content setting', async () => {
  const site = await closeAllButOne();
  await site.goto(url('other.test', '/ok.html'));
  const tabId = await (await ctx.serviceWorkers()[0]).evaluate(async () => (await chrome.tabs.query({ url: '*://other.test/*' }))[0].id);
  const p = await ctx.newPage();
  await p.goto(`chrome-extension://${EXT_ID}/ui/guard.html?tab=${tabId}`);
  const select = p.locator('select[aria-label="JavaScript for other.test"]');
  await select.waitFor();
  assert.equal(await select.inputValue(), 'allow');
  await select.selectOption('block');
  await p.waitForSelector('#notice:not([hidden])');
  const setting = await p.evaluate((u) => chrome.contentSettings.javascript.get({ primaryUrl: u }).then((r) => r.setting), url('other.test', '/'));
  assert.equal(setting, 'block');
  await select.selectOption('allow');
  await p.close();
});

test('extensions tab lists other extensions and toggles them', async () => {
  const p = await ctx.newPage();
  await p.goto(`chrome-extension://${EXT_ID}/ui/guard.html#extensions`);
  const row = p.locator('li.ext', { hasText: 'Fixture Extension' });
  await row.waitFor();
  assert.equal(await p.locator('li.ext', { hasText: 'Graphite Dark' }).count(), 0, 'themes are not listed');
  await row.locator('.switch input').click();
  await settle(300);
  const enabled = await p.evaluate(async () => (await chrome.management.getAll()).find((x) => x.name === 'Fixture Extension').enabled);
  assert.equal(enabled, false);
  await p.close();
});

test('graphite theme is installed and active', async () => {
  const p = await ctx.newPage();
  await p.goto(`chrome-extension://${EXT_ID}/ui/guard.html`);
  const theme = await p.evaluate(async () => (await chrome.management.getAll()).find((x) => x.type === 'theme'));
  assert.equal(theme?.name, 'Graphite Dark');
  assert.equal(theme.enabled, true);
  await p.close();
});
