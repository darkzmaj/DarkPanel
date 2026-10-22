// DarkPanel / Popup Guard: service worker.
// Layers (see docs/POPUP_GUARD.md):
//  1. MAIN-world page guard on protected hosts (pre-emptive window.open /
//     script-redirect blocking), registered dynamically per mode.
//  2. ISOLATED-world link guard (target=_blank / external clicks, approvals).
//  3. Strict mode: declarativeNetRequest blocks main-frame requests initiated
//     by the protected site to other sites.
//  4. Backstop here: closes unsolicited tabs opened by protected tabs
//     (covers third-party iframes) and reverts script redirects.
import { hostPatterns } from './core/domain.js';
import {
  activeRule, addSite, removeSite, setSiteEnabled, setSiteMode, setGlobalEnabled,
  decideNewTab, decideRedirect, findRule, RuleError,
} from './core/rules.js';
import { createStore } from './core/store.js';

const store = createStore(chrome.storage.local);
const SCRIPT_IDS = { strict: 'pg-main-strict', balanced: 'pg-main-balanced', links: 'pg-links' };
const DNR_BASE = 1000;
const APPROVAL_MS = 1500;
const APPROVAL_WAIT_MS = 150;
const MENU_APPROVAL_MS = 15000; // time to pick "Open link in new tab"

// tabId -> {until, url|null}. Lives in memory: approvals are only meaningful
// for ~1.5 s, so losing them on worker shutdown is harmless.
const approvals = new Map();

async function apply(config) {
  const on = config.enabled ? config.sites.filter((s) => s.enabled) : [];
  const byMode = { strict: [], balanced: [] };
  for (const s of on) byMode[s.mode].push(...hostPatterns(s.domain));

  const existing = (await chrome.scripting.getRegisteredContentScripts()).map((s) => s.id);
  const ours = existing.filter((id) => Object.values(SCRIPT_IDS).includes(id));
  if (ours.length) await chrome.scripting.unregisterContentScripts({ ids: ours });

  const scripts = [];
  for (const mode of ['strict', 'balanced']) {
    if (!byMode[mode].length) continue;
    scripts.push({
      id: SCRIPT_IDS[mode], matches: byMode[mode], allFrames: true, matchOriginAsFallback: true,
      runAt: 'document_start', world: 'MAIN', persistAcrossSessions: true,
      js: [`content/mode-${mode}.js`, 'content/page-guard.js'],
    });
  }
  const all = [...byMode.strict, ...byMode.balanced];
  if (all.length) {
    scripts.push({
      id: SCRIPT_IDS.links, matches: all, allFrames: true, runAt: 'document_start',
      world: 'ISOLATED', persistAcrossSessions: true, js: ['content/link-guard.js'],
    });
  }
  if (scripts.length) await chrome.scripting.registerContentScripts(scripts);

  const old = await chrome.declarativeNetRequest.getDynamicRules();
  const strict = on.filter((s) => s.mode === 'strict');
  await chrome.declarativeNetRequest.updateDynamicRules({
    removeRuleIds: old.map((r) => r.id).filter((id) => id >= DNR_BASE),
    addRules: strict.map((s, i) => ({
      id: DNR_BASE + i, priority: 1, action: { type: 'block' },
      condition: { initiatorDomains: [s.domain], excludedRequestDomains: [s.domain], resourceTypes: ['main_frame'] },
    })),
  });
  return config;
}

async function state(tabUrl) {
  const [config, stats] = await Promise.all([store.load(), store.stats()]);
  const rule = tabUrl ? findRule(config, tabUrl) : null;
  return { config, stats, current: tabUrl ? { url: tabUrl, rule, active: !!activeRule(config, tabUrl) } : null };
}

async function countBlock(tab, domain) {
  if (tab?.incognito) return; // no statistics are recorded for private windows
  await store.countBlocked(domain);
}

const mutations = {
  add: (m) => (c) => addSite(c, m.domain, m.mode || 'balanced').config,
  remove: (m) => (c) => removeSite(c, m.domain),
  setEnabled: (m) => (c) => setSiteEnabled(c, m.domain, m.enabled),
  setMode: (m) => (c) => setSiteMode(c, m.domain, m.mode),
  setGlobal: (m) => (c) => setGlobalEnabled(c, m.enabled),
};

async function handle(msg, sender) {
  // Settings changes only from our own pages (popup or tab), never from
  // content scripts, whose sender.url is the web page.
  const fromExtensionPage = sender.id === chrome.runtime.id && !!sender.url?.startsWith(chrome.runtime.getURL(''));
  switch (msg?.cmd) {
    case 'state': return state(msg.tabUrl);
    case 'resetStats': if (!fromExtensionPage) break; await store.resetStats(); return state(msg.tabUrl);
    case 'resetAll': if (!fromExtensionPage) break; await apply(await store.reset()); return state(msg.tabUrl);
    case 'approveOpen': // from link-guard: the user explicitly asked for a new tab
      if (sender.tab) approvals.set(sender.tab.id, { until: Date.now() + (msg.menu ? MENU_APPROVAL_MS : APPROVAL_MS) });
      return true;
    case 'blocked': { // from page-guard via link-guard
      const config = await store.load();
      const rule = sender.tab && activeRule(config, sender.tab.url);
      if (rule) await countBlock(sender.tab, rule.domain);
      return true;
    }
    default:
      if (mutations[msg?.cmd] && fromExtensionPage) {
        await apply(await store.mutate(mutations[msg.cmd](msg)));
        return state(msg.tabUrl);
      }
  }
  throw new RuleError('Unsupported request');
}

chrome.runtime.onMessage.addListener((msg, sender, respond) => {
  handle(msg, sender).then(
    (data) => respond({ ok: true, data }),
    (e) => respond({ ok: false, error: e instanceof RuleError ? e.message : 'Internal error' }),
  );
  return true;
});

// --- Backstop: new tabs opened by protected pages -------------------------
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

chrome.webNavigation.onCreatedNavigationTarget.addListener(async (d) => {
  let source;
  try { source = await chrome.tabs.get(d.sourceTabId); } catch { return; }
  const config = await store.load();
  const rule = activeRule(config, source.url || source.pendingUrl);
  if (!rule) return;
  // The click's approval message can race the tab creation event.
  if (!approvals.has(d.sourceTabId)) await sleep(APPROVAL_WAIT_MS);
  const a = approvals.get(d.sourceTabId);
  const approved = !!a && a.until > Date.now();
  if (decideNewTab(rule, d.url, approved) === 'block') {
    try { await chrome.tabs.remove(d.tabId); } catch { /* already gone */ }
    await countBlock(source, rule.domain);
  }
});

// --- Backstop: script redirects away from protected sites -----------------
// Previous committed top-level URL per tab, in session storage so it survives
// service-worker restarts but never touches disk.
const lastKey = (tabId) => `last:${tabId}`;

chrome.webNavigation.onCommitted.addListener(async (d) => {
  if (d.frameId !== 0) return;
  const key = lastKey(d.tabId);
  const prev = (await chrome.storage.session.get(key))[key];
  await chrome.storage.session.set({ [key]: d.url });
  if (!prev) return;
  const config = await store.load();
  const rule = activeRule(config, prev);
  if (rule && decideRedirect(rule, prev, d) === 'block') {
    await chrome.storage.session.set({ [key]: prev });
    try { await chrome.tabs.update(d.tabId, { url: prev }); } catch { return; }
    let tab; try { tab = await chrome.tabs.get(d.tabId); } catch { /* closed */ }
    await countBlock(tab, rule.domain);
  }
});

chrome.tabs.onRemoved.addListener((tabId) => {
  approvals.delete(tabId);
  chrome.storage.session.remove(lastKey(tabId));
});

const init = async () => apply(await store.load());
chrome.runtime.onInstalled.addListener(init);
chrome.runtime.onStartup.addListener(init);
