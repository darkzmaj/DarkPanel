// Dark Panel — tabs, per-site controls and the extensions list.
// Popup Guard itself lives in guard.js.
import { hostOf } from '../core/domain.js';

const $ = (id) => document.getElementById(id);
const notice = (text, error = false) => {
  const n = $('notice');
  n.hidden = !text;
  n.textContent = text || '';
  n.classList.toggle('error', error);
};
const open = (url) => chrome.tabs.create({ url });

// --- Tabs (#guard / #extensions in the URL preselects one) ---------------
function selectTab(name) {
  for (const t of document.querySelectorAll('[role=tab]')) t.setAttribute('aria-selected', String(t.dataset.tab === name));
  for (const p of document.querySelectorAll('[data-panel]')) p.hidden = p.dataset.panel !== name;
  if (name === 'extensions') renderExtensions();
}
for (const t of document.querySelectorAll('[role=tab]')) t.addEventListener('click', () => selectTab(t.dataset.tab));
const fromHash = () => {
  const name = location.hash.slice(1);
  if (['site', 'guard', 'extensions'].includes(name)) selectTab(name);
};
window.addEventListener('hashchange', fromHash);
fromHash();

// --- This site ------------------------------------------------------------
// type -> allowed values (Chrome's contentSettings API).
const PERMS = [
  ['javascript', 'JavaScript', ['allow', 'block']],
  ['popups', 'Pop-ups & redirects', ['allow', 'block']],
  ['cookies', 'Cookies', ['allow', 'session_only', 'block']],
  ['images', 'Images', ['allow', 'block']],
  ['notifications', 'Notifications', ['allow', 'block', 'ask']],
  ['location', 'Location', ['allow', 'block', 'ask']],
  ['camera', 'Camera', ['allow', 'block', 'ask']],
  ['microphone', 'Microphone', ['allow', 'block', 'ask']],
  ['automaticDownloads', 'Automatic downloads', ['allow', 'block', 'ask']],
];
const LABEL = { allow: 'Allow', block: 'Block', ask: 'Ask', session_only: 'Until close' };

let tab = null;
async function currentTab() {
  const id = Number(new URLSearchParams(location.search).get('tab'));
  if (Number.isInteger(id) && id > 0) return chrome.tabs.get(id).catch(() => null);
  const [t] = await chrome.tabs.query({ active: true, currentWindow: true });
  return t && !t.url?.startsWith(location.origin) ? t : null;
}

async function renderSite() {
  tab = await currentTab();
  const url = tab?.url || '';
  const host = hostOf(url);
  const box = $('perms');
  box.replaceChildren();
  for (const id of ['clear-site', 'open-site-settings']) $(id).disabled = !host;
  if (!host) {
    $('security').textContent = '';
    $('perms-hint').textContent = 'Open a website to see its settings.';
    return;
  }
  $('security').textContent = url.startsWith('https:') ? '🔒 Secure connection (HTTPS)' : '⚠ Not secure (HTTP)';
  $('security').classList.toggle('warn', !url.startsWith('https:'));

  const pattern = `${new URL(url).protocol}//${host}/*`;
  for (const [type, label, values] of PERMS) {
    const api = chrome.contentSettings[type];
    if (!api) continue;
    const { setting } = await api.get({ primaryUrl: url, incognito: !!tab.incognito }).catch(() => ({}));
    const row = document.createElement('label');
    row.className = 'perm';
    const name = document.createElement('span');
    name.textContent = label;
    const select = document.createElement('select');
    select.setAttribute('aria-label', `${label} for ${host}`);
    for (const v of values) select.add(new Option(LABEL[v], v, false, v === setting));
    select.addEventListener('change', async () => {
      try {
        await api.set({ primaryPattern: pattern, setting: select.value, scope: tab.incognito ? 'incognito_session_only' : 'regular' });
        notice(`${label}: ${LABEL[select.value]} on ${host}. Reload the page to apply.`);
      } catch (e) { notice(e.message, true); }
    });
    row.append(name, select);
    box.append(row);
  }
  const cookies = await chrome.cookies.getAll({ domain: host }).catch(() => []);
  $('cookie-count').textContent = `Cookies: ${cookies.length}`;
}

let clearArmed = false;
$('clear-site').addEventListener('click', async () => {
  const host = hostOf(tab?.url || '');
  if (!host) return;
  if (!clearArmed) { // two-step confirm, no modal
    clearArmed = true;
    $('clear-site').textContent = 'Click again to clear';
    setTimeout(() => { clearArmed = false; $('clear-site').textContent = 'Clear site data'; }, 4000);
    return;
  }
  clearArmed = false;
  $('clear-site').textContent = 'Clear site data';
  const origins = [`https://${host}`, `http://${host}`];
  await chrome.browsingData.remove({ origins }, {
    cookies: true, localStorage: true, indexedDB: true, cacheStorage: true, serviceWorkers: true, fileSystems: true,
  });
  notice(`Cookies and storage for ${host} cleared.`);
  renderSite();
});
$('open-site-settings').addEventListener('click', () => {
  const u = new URL(tab.url);
  open(`chrome://settings/content/siteDetails?site=${encodeURIComponent(u.origin)}`);
});
$('open-shields').addEventListener('click', () => open('chrome://settings/shields'));
$('discord').addEventListener('click', (e) => { e.preventDefault(); open('https://darkdragon.dev/discord'); });

// --- Extensions -----------------------------------------------------------
async function renderExtensions() {
  const list = $('extensions');
  const all = (await chrome.management.getAll())
    .filter((x) => x.id !== chrome.runtime.id && x.type === 'extension')
    .sort((a, b) => Number(b.enabled) - Number(a.enabled) || a.name.localeCompare(b.name));
  list.replaceChildren();
  if (!all.length) {
    const li = document.createElement('li');
    li.className = 'empty';
    li.textContent = 'No other extensions installed.';
    list.append(li);
  }
  for (const x of all) {
    const li = document.createElement('li');
    li.className = 'ext';
    li.dataset.id = x.id;
    const icon = document.createElement('img');
    icon.alt = '';
    icon.width = icon.height = 18;
    const best = (x.icons || []).sort((a, b) => b.size - a.size)[0];
    icon.src = best ? `chrome://extension-icon/${x.id}/${Math.min(best.size, 32)}/${x.enabled ? 0 : 1}` : '../icons/icon16.png';
    icon.addEventListener('error', () => { icon.src = '../icons/icon16.png'; }, { once: true });
    const name = document.createElement('span');
    name.className = 'domain';
    name.textContent = x.name;
    name.title = x.description || x.name;

    const actions = document.createElement('span');
    actions.className = 'ext-actions';
    if (x.optionsUrl && x.enabled) {
      const opt = document.createElement('button');
      opt.type = 'button';
      opt.className = 'ghost small';
      opt.textContent = 'Options';
      opt.addEventListener('click', () => open(x.optionsUrl));
      actions.append(opt);
    }
    const details = document.createElement('button');
    details.type = 'button';
    details.className = 'ghost small';
    details.textContent = 'Details';
    details.addEventListener('click', () => open(`chrome://extensions/?id=${x.id}`));
    actions.append(details);

    const sw = document.createElement('label');
    sw.className = 'switch';
    const box = document.createElement('input');
    box.type = 'checkbox';
    box.setAttribute('role', 'switch');
    box.setAttribute('aria-label', `${x.name} enabled`);
    box.checked = x.enabled;
    box.disabled = !x.mayDisable;
    box.addEventListener('change', async () => {
      try { await chrome.management.setEnabled(x.id, box.checked); renderExtensions(); }
      catch (e) { box.checked = !box.checked; notice(e.message, true); }
    });
    sw.append(box, document.createElement('span'));

    li.append(icon, name, actions, sw);
    list.append(li);
  }
}
$('manage-extensions').addEventListener('click', () => open('chrome://extensions'));

renderSite();
