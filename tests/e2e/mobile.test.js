// Phone simulation: desktop Chromium emulating an Android phone (small
// viewport, touch input, coarse pointer). Checks the panel's layout and tap
// targets, and that Popup Guard behaves the same with touch taps. This is not
// a real mobile browser; see README "Mobile".
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { chromiumPath } from '../../scripts/browser.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '../..');
const EXT = join(root, 'extensions/dark-panel');
const FIXTURE = join(root, 'tests/e2e/fixture-ext');
const EXT_ID = 'ggifibhodlacedemomakcpddllllcofa';
const settle = (ms = 700) => new Promise((r) => setTimeout(r, ms));

let server, port, profile, ctx;
const url = (host, path) => `http://${host}:${port}${path}`;

const PAGES = {
  '/page.html': () => `
    <button id="play" style="width:200px;height:60px" onclick="window.open('${url('ads.test', '/ad.html')}')">play</button>
    <a id="overlay" target="_blank" href="${url('ads.test', '/ad.html')}" style="display:block;width:200px;height:60px">ad</a>
    <a id="samelink" target="_blank" href="${url('protected.test', '/ok.html')}" style="display:block;width:200px;height:60px">same site</a>`,
  '/ad.html': () => '<h1>AD</h1>',
  '/ok.html': () => '<h1>OK</h1>',
};

// Minimal stand-in for the extension APIs the panel calls, with sample data.
const FAKE_CHROME = () => {
  const state = {
    config: { version: 1, enabled: true, sites: [{ domain: 'myflixerfree.io', enabled: true, mode: 'strict' }, { domain: 'example.org', enabled: false, mode: 'balanced' }] },
    stats: { total: 12, byDomain: {} },
    current: { url: 'https://example.com/', rule: null, active: false },
  };
  const setting = { get: async () => ({ setting: 'allow' }), set: async () => {} };
  window.chrome = {
    runtime: { id: 'test', sendMessage: async () => ({ ok: true, data: state }) },
    tabs: { query: async () => [{ id: 1, url: 'https://example.com/' }], get: async () => ({ id: 1, url: 'https://example.com/' }), create: async () => {} },
    storage: { onChanged: { addListener() {} } },
    contentSettings: Object.fromEntries(['javascript', 'popups', 'cookies', 'images', 'notifications', 'location', 'camera', 'microphone', 'automaticDownloads'].map((k) => [k, setting])),
    cookies: { getAll: async () => [] },
    browsingData: { remove: async () => {} },
    management: { getAll: async () => [{ id: 'abc', name: 'Sample Extension', type: 'extension', enabled: true, mayDisable: true, optionsUrl: 'x', icons: [] }], setEnabled: async () => {} },
  };
};

async function pagesAfter(fn) {
  const before = new Set(ctx.pages());
  await fn();
  await settle();
  return ctx.pages().filter((p) => !before.has(p) && !p.isClosed());
}

before(async () => {
  server = http.createServer((req, res) => {
    const path = req.url.split('?')[0];
    if (path.startsWith('/ext/')) {
      // The panel served as a normal page: DevTools touch emulation does not
      // apply to chrome-extension:// pages.
      const file = join(EXT, path.slice(5));
      const type = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png' }[extname(file)];
      try { res.writeHead(200, { 'content-type': type }); res.end(readFileSync(file)); } catch { res.writeHead(404); res.end(); }
      return;
    }
    const body = PAGES[path];
    res.writeHead(body ? 200 : 404, { 'content-type': 'text/html' });
    res.end(body ? `<!doctype html><meta name="viewport" content="width=device-width">${body()}` : 'nf');
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  port = server.address().port;
  profile = mkdtempSync(join(tmpdir(), 'darkpanel-mobile-'));
  ctx = await chromium.launchPersistentContext(profile, {
    executablePath: chromiumPath(),
    headless: true,
    viewport: { width: 360, height: 760 },
    deviceScaleFactor: 2,
    isMobile: true,
    hasTouch: true,
    userAgent: 'Mozilla/5.0 (Linux; Android 15; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/156.0.0.0 Mobile Safari/537.36',
    args: [
      '--disable-gpu', `--disable-extensions-except=${EXT},${FIXTURE}`, `--load-extension=${EXT},${FIXTURE}`,
      '--host-resolver-rules=MAP *.test 127.0.0.1', '--disable-popup-blocking',
    ],
  });
  if (!ctx.serviceWorkers().length) await ctx.waitForEvent('serviceworker');
  const p = await ctx.newPage();
  await p.goto(`chrome-extension://${EXT_ID}/ui/guard.html`);
  const res = await p.evaluate(() => chrome.runtime.sendMessage({ cmd: 'add', domain: 'protected.test', mode: 'balanced' }));
  assert.equal(res.ok, true);
  await p.close();
});

after(async () => {
  await ctx?.close();
  server?.close();
  rmSync(profile, { recursive: true, force: true });
});

const RENDERED = { site: '#perms select', guard: 'li[data-domain="myflixerfree.io"]', extensions: 'li.ext' };
for (const tab of ['site', 'guard', 'extensions']) {
  test(`panel "${tab}" tab fits a 360px phone screen with 44px tap targets`, async () => {
    const p = await ctx.newPage();
    await p.addInitScript(FAKE_CHROME);
    await p.goto(url('panel.test', `/ext/ui/guard.html#${tab}`));
    await p.waitForSelector(RENDERED[tab]); // the panel rendered real content
    if (process.env.MOBILE_SCREENSHOTS) await p.screenshot({ path: join(process.env.MOBILE_SCREENSHOTS, `${tab}.png`), fullPage: true });
    const r = await p.evaluate(() => {
      const visible = (e) => e.getClientRects().length > 0 && getComputedStyle(e).visibility !== 'hidden';
      const targets = [...document.querySelectorAll('button, select, input, footer a')].filter(visible);
      return {
        coarse: matchMedia('(pointer: coarse)').matches,
        // Mobile browsers widen the layout to fit oversized content, so compare
        // against the device width rather than innerWidth alone.
        width: Math.max(innerWidth, document.documentElement.scrollWidth),
        wide: [...document.querySelectorAll('body *')].filter((e) => visible(e) && e.getBoundingClientRect().right > 360.5)
          .map((e) => `${e.tagName.toLowerCase()}${e.id ? '#' + e.id : ''}.${e.className}`).slice(0, 8),
        tooSmall: targets.map((e) => ({ e: e.id || e.textContent.trim() || e.getAttribute('aria-label'), h: Math.round(e.getBoundingClientRect().height) }))
          .filter((x) => x.h < 44),
      };
    });
    assert.equal(r.coarse, true, 'touch emulation active');
    assert.equal(r.width, 360, `fits the 360px screen without horizontal scrolling; too wide: ${r.wide.join(', ')}`);
    assert.deepEqual(r.tooSmall, [], 'every control is at least 44px tall');
    await p.close();
  });
}

test('touch: tapping a button that opens an ad window is blocked', async () => {
  const p = await ctx.newPage();
  await p.goto(url('protected.test', '/page.html'));
  assert.equal((await pagesAfter(() => p.tap('#play'))).length, 0);
  await p.close();
});

test('touch: tapping an invisible target=_blank ad link is blocked', async () => {
  const p = await ctx.newPage();
  await p.goto(url('protected.test', '/page.html'));
  assert.equal((await pagesAfter(() => p.tap('#overlay'))).length, 0);
  assert.match(p.url(), /protected\.test/);
  await p.close();
});

test('touch: tapping a same-site link that opens in a new tab still works', async () => {
  const p = await ctx.newPage();
  await p.goto(url('protected.test', '/page.html'));
  const opened = await pagesAfter(() => p.tap('#samelink'));
  assert.equal(opened.length, 1);
  assert.match(opened[0].url(), /protected\.test:\d+\/ok\.html/);
  await p.close();
});
