import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeDomain, matchesDomain, hostPatterns } from '../../extensions/dark-panel/core/domain.js';
import {
  defaultConfig, sanitizeConfig, addSite, removeSite, setSiteEnabled, setSiteMode, setGlobalEnabled,
  findRule, activeRule, decideNewTab, decideRedirect, RuleError,
} from '../../extensions/dark-panel/core/rules.js';
import { createStore, memoryArea, CONFIG_KEY } from '../../extensions/dark-panel/core/store.js';

test('normalizes the documented example inputs', () => {
  assert.equal(normalizeDomain('myflixerfree.io'), 'myflixerfree.io');
  assert.equal(normalizeDomain('https://myflixerfree.io/'), 'myflixerfree.io');
  assert.equal(normalizeDomain('www.example.com'), 'example.com');
  assert.equal(normalizeDomain('example.org'), 'example.org');
  assert.equal(normalizeDomain('  HTTPS://Sub.Example.COM:8443/path?q=1#x '), 'sub.example.com');
  assert.equal(normalizeDomain('*.example.net'), 'example.net');
  assert.equal(normalizeDomain('example.com.'), 'example.com');
  assert.equal(normalizeDomain('example.com:8080/x'), 'example.com');
  assert.equal(normalizeDomain('//cdn.example.com/a.js'), 'cdn.example.com');
  assert.equal(normalizeDomain('localhost'), 'localhost');
  assert.equal(normalizeDomain('192.168.0.1'), '192.168.0.1');
  assert.equal(normalizeDomain('www.co'), 'www.co'); // "www." kept when it is the registrable label
});

test('normalizes internationalized domain names to punycode', () => {
  assert.equal(normalizeDomain('müller.de'), 'xn--mller-kva.de');
  assert.equal(normalizeDomain('https://пример.рф/'), 'xn--e1afmkfd.xn--p1ai');
  assert.equal(normalizeDomain('xn--mller-kva.de'), 'xn--mller-kva.de');
});

test('rejects invalid input', () => {
  for (const bad of ['', '   ', 'not a domain', 'localhostx', 'javascript:alert(1)', 'data:text/html,hi',
    'chrome://settings', 'file:///C:/x', 'ftp://example.com', 'https://user:pw@example.com',
    'exa mple.com', '-bad.com', 'bad-.com', 'example.c', 'example.123', '[::1]', '999.1.1.1',
    'a'.repeat(64) + '.com', 'mailto:me@example.com', null, undefined, 42]) {
    assert.equal(normalizeDomain(bad), null, `should reject ${String(bad)}`);
  }
});

test('matches on label boundaries only', () => {
  assert.ok(matchesDomain('myflixerfree.io', 'myflixerfree.io'));
  assert.ok(matchesDomain('www.myflixerfree.io', 'myflixerfree.io'));
  assert.ok(matchesDomain('a.b.myflixerfree.io', 'myflixerfree.io'));
  assert.ok(!matchesDomain('notmyflixerfree.io', 'myflixerfree.io'));
  assert.ok(!matchesDomain('myflixerfree.io.evil.net', 'myflixerfree.io'));
  assert.ok(!matchesDomain('myflixerfree.iox', 'myflixerfree.io'));
  assert.deepEqual(hostPatterns('example.com'), ['*://example.com/*', '*://*.example.com/*']);
});

test('default config preconfigures MyFlixer in Strict mode', () => {
  assert.deepEqual(defaultConfig().sites, [{ domain: 'myflixerfree.io', enabled: true, mode: 'strict' }]);
});

test('adds valid domains, deduplicates, rejects invalid', () => {
  let c = { version: 1, enabled: true, sites: [] };
  c = addSite(c, 'https://www.Example.com/watch').config;
  assert.deepEqual(c.sites, [{ domain: 'example.com', enabled: true, mode: 'balanced' }]);
  const again = addSite(c, 'example.com', 'strict');
  assert.equal(again.existed, true);
  assert.equal(again.config.sites.length, 1);
  assert.throws(() => addSite(c, 'nope'), RuleError);
  assert.throws(() => addSite(c, 'ok.com', 'turbo'), RuleError);
});

test('deletes domains and toggles per-domain switches and modes', () => {
  let c = addSite(addSite(defaultConfig(), 'a.com').config, 'b.org', 'strict').config;
  c = setSiteEnabled(c, 'a.com', false);
  assert.equal(findRule(c, 'a.com').enabled, false);
  assert.equal(activeRule(c, 'https://a.com/'), null, 'disabled rule must not protect');
  c = setSiteMode(c, 'https://b.org/x', 'balanced');
  assert.equal(findRule(c, 'b.org').mode, 'balanced');
  c = removeSite(c, 'www.b.org');
  assert.equal(findRule(c, 'b.org'), null);
  assert.throws(() => removeSite(c, 'b.org'), RuleError);
  assert.throws(() => setSiteEnabled(c, 'a.com', 'yes'), RuleError);
});

test('global switch disables every rule', () => {
  const c = setGlobalEnabled(defaultConfig(), false);
  assert.equal(activeRule(c, 'https://myflixerfree.io/'), null);
  assert.ok(findRule(c, 'https://myflixerfree.io/'));
});

test('most specific rule wins', () => {
  let c = addSite({ version: 1, enabled: true, sites: [] }, 'example.com', 'strict').config;
  c = addSite(c, 'video.example.com', 'balanced').config;
  assert.equal(activeRule(c, 'https://cdn.video.example.com/').mode, 'balanced');
  assert.equal(activeRule(c, 'https://example.com/').mode, 'strict');
  assert.equal(activeRule(c, 'https://unrelated.org/'), null);
});

test('sanitizes corrupt or hostile stored data', () => {
  const c = sanitizeConfig({ enabled: 'x', sites: [{ domain: 'ok.com', mode: 'evil' }, { domain: 'OK.com' }, { domain: '<script>' }, null, 7] });
  assert.deepEqual(c.sites, [{ domain: 'ok.com', enabled: true, mode: 'balanced' }]);
  assert.deepEqual(sanitizeConfig(undefined), defaultConfig());
});

test('new-tab decisions per mode', () => {
  const bal = { domain: 'site.io', enabled: true, mode: 'balanced' };
  const strict = { ...bal, mode: 'strict' };
  assert.equal(decideNewTab(bal, 'https://ads.example/', false), 'block');
  assert.equal(decideNewTab(bal, 'about:blank', false), 'block', 'popunder shell');
  assert.equal(decideNewTab(bal, 'https://player.site.io/', false), 'block', 'site-opened tab, even same-site');
  assert.equal(decideNewTab(bal, 'https://player.site.io/', true), 'allow');
  assert.equal(decideNewTab(bal, 'https://other.example/', true), 'allow', 'user-approved new tab');
  assert.equal(decideNewTab(strict, 'https://player.site.io/', false), 'block');
  assert.equal(decideNewTab(strict, 'https://player.site.io/', true), 'allow');
  assert.equal(decideNewTab(strict, 'https://other.example/', true), 'block');
  assert.equal(decideNewTab(null, 'https://ads.example/', false), 'allow', 'unprotected sites unaffected');
});

test('redirect decisions', () => {
  const bal = { domain: 'site.io', enabled: true, mode: 'balanced' };
  const from = 'https://site.io/watch';
  const nav = (url, transitionType, transitionQualifiers = []) => ({ url, transitionType, transitionQualifiers });
  assert.equal(decideRedirect(bal, from, nav('https://ad.example/', 'link', ['client_redirect'])), 'block');
  assert.equal(decideRedirect(bal, from, nav('https://ad.example/', 'link')), 'allow', 'user click in balanced');
  assert.equal(decideRedirect({ ...bal, mode: 'strict' }, from, nav('https://ad.example/', 'link')), 'block');
  assert.equal(decideRedirect(bal, from, nav('https://ad.example/', 'typed', ['from_address_bar'])), 'allow');
  assert.equal(decideRedirect({ ...bal, mode: 'strict' }, from, nav('https://x.example/', 'typed', ['from_address_bar'])), 'allow');
  assert.equal(decideRedirect(bal, from, nav('https://a.site.io/', 'link', ['client_redirect'])), 'allow', 'same site');
  assert.equal(decideRedirect(bal, from, nav('https://ad.example/', 'link', ['forward_back'])), 'allow');
});

test('store persists across a simulated restart and serializes writes', async () => {
  const area = memoryArea();
  const s1 = createStore(area);
  assert.equal((await s1.load()).sites[0].domain, 'myflixerfree.io');
  // 20 concurrent adds must all survive (no lost updates).
  await Promise.all(Array.from({ length: 20 }, (_, i) => s1.mutate((c) => addSite(c, `site${i}.com`).config)));
  const s2 = createStore(area); // "restart": new store, same storage
  const cfg = await s2.load();
  assert.equal(cfg.sites.length, 21);
  await s2.mutate((c) => removeSite(c, 'site3.com'));
  assert.equal((await createStore(area).load()).sites.length, 20);
});

test('an intentionally emptied list is not re-seeded after restart', async () => {
  const area = memoryArea();
  const s = createStore(area);
  await s.load();
  await s.mutate((c) => removeSite(c, 'myflixerfree.io'));
  assert.deepEqual((await createStore(area).load()).sites, []);
});

test('reset touches only Popup Guard keys; stats count and reset', async () => {
  const area = memoryArea({ unrelated: { keep: true } });
  const s = createStore(area);
  await s.mutate((c) => addSite(c, 'x.com').config);
  await s.countBlocked('x.com'); await s.countBlocked('x.com');
  assert.equal((await s.stats()).byDomain['x.com'], 2);
  await s.resetStats();
  assert.equal((await s.stats()).total, 0);
  await s.countBlocked('x.com');
  await s.reset();
  assert.deepEqual(area.data.unrelated, { keep: true });
  assert.equal((await s.stats()).total, 0);
  assert.deepEqual(area.data[CONFIG_KEY], defaultConfig());
});
