// Popup Guard — settings UI. Works as the toolbar/menu popup and as a
// full page. The page never writes storage itself: every change is a message
// to the service worker, which validates, persists and applies it.
import { hostOf } from '../core/domain.js';

const $ = (id) => document.getElementById(id);
let tabUrl = null;
let lastState = null;

async function resolveTabUrl() {
  // Optional ?tab=<id> selects which tab counts as the current website.
  const id = Number(new URLSearchParams(location.search).get('tab'));
  try {
    if (Number.isInteger(id) && id > 0) return (await chrome.tabs.get(id)).url || null;
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    return tab && !tab.url?.startsWith(location.origin) ? tab.url : null;
  } catch { return null; }
}

async function send(msg) {
  const res = await chrome.runtime.sendMessage({ ...msg, tabUrl });
  if (!res?.ok) throw new Error(res?.error || 'Something went wrong');
  return res.data;
}

function notice(text, error = false) {
  const n = $('notice');
  n.hidden = !text;
  n.textContent = text || '';
  n.classList.toggle('error', error);
}

async function run(msg, okText) {
  notice('');
  try {
    render(await send(msg));
    if (okText) notice(okText);
    return true;
  } catch (e) {
    notice(e.message, true);
    return false;
  }
}

function render(s) {
  lastState = s;
  const { config, stats, current } = s;
  $('global').checked = config.enabled;
  document.body.classList.toggle('off', !config.enabled);
  $('blocked').textContent = String(stats.total);
  $('count').textContent = String(config.sites.length);

  const host = hostOf(tabUrl || '');
  $('current-host').textContent = host || 'No website in this tab';
  const status = !host ? '' : !config.enabled ? 'Popup Guard is off'
    : current?.active ? `Protected · ${current.rule.mode === 'strict' ? 'Strict' : 'Balanced'} (${current.rule.domain})`
      : current?.rule ? `Paused (${current.rule.domain})` : 'Not protected';
  $('current-status').textContent = status;
  $('current').classList.toggle('active', !!current?.active);
  $('add-current').hidden = !host || !!current?.active;
  $('add-current').textContent = current?.rule ? 'Resume protection' : 'Protect this site';

  const list = $('sites');
  list.replaceChildren();
  if (!config.sites.length) {
    const li = document.createElement('li');
    li.className = 'empty';
    li.textContent = 'No protected websites yet.';
    list.append(li);
  }
  for (const site of [...config.sites].sort((a, b) => a.domain.localeCompare(b.domain))) {
    const li = document.createElement('li');
    li.dataset.domain = site.domain;
    const name = document.createElement('span');
    name.className = 'domain';
    name.textContent = site.domain;
    name.title = site.domain;

    const mode = document.createElement('select');
    mode.setAttribute('aria-label', `Mode for ${site.domain}`);
    for (const m of ['balanced', 'strict']) mode.add(new Option(m[0].toUpperCase() + m.slice(1), m, false, site.mode === m));
    mode.addEventListener('change', () => run({ cmd: 'setMode', domain: site.domain, mode: mode.value }));

    const sw = document.createElement('label');
    sw.className = 'switch';
    const box = document.createElement('input');
    box.type = 'checkbox';
    box.setAttribute('role', 'switch');
    box.setAttribute('aria-label', `Protection for ${site.domain}`);
    box.checked = site.enabled;
    box.addEventListener('change', () => run({ cmd: 'setEnabled', domain: site.domain, enabled: box.checked }));
    sw.append(box, document.createElement('span'));

    const rm = document.createElement('button');
    rm.type = 'button';
    rm.className = 'ghost small remove';
    rm.textContent = 'Remove';
    rm.setAttribute('aria-label', `Remove ${site.domain}`);
    rm.addEventListener('click', () => run({ cmd: 'remove', domain: site.domain }, `${site.domain} removed.`));

    li.append(name, mode, sw, rm);
    list.append(li);
  }
}

$('add-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const ok = await run({ cmd: 'add', domain: $('domain').value, mode: $('new-mode').value }, 'Added. Reload open tabs of that site to protect them.');
  if (ok) $('domain').value = '';
});
$('add-current').addEventListener('click', () => {
  const rule = lastState?.current?.rule;
  return rule
    ? run({ cmd: 'setEnabled', domain: rule.domain, enabled: true }, 'Protection resumed. Reload the tab to apply.')
    : run({ cmd: 'add', domain: tabUrl, mode: 'balanced' }, 'Added. Reload the tab to apply.');
});
$('global').addEventListener('change', (e) => run({ cmd: 'setGlobal', enabled: e.target.checked }));
$('reset-stats').addEventListener('click', () => run({ cmd: 'resetStats' }, 'Statistics reset.'));
let armed = false;
$('reset-all').addEventListener('click', async () => {
  if (!armed) { // two-step confirmation instead of a modal dialog
    armed = true;
    $('reset-all').textContent = 'Click again to reset list and statistics';
    setTimeout(() => { armed = false; $('reset-all').textContent = 'Reset Popup Guard…'; }, 4000);
    return;
  }
  armed = false;
  $('reset-all').textContent = 'Reset Popup Guard…';
  await run({ cmd: 'resetAll' }, 'Popup Guard reset to defaults. Other browser settings were not changed.');
});

chrome.storage.onChanged.addListener((_c, area) => {
  if (area === 'local') send({ cmd: 'state' }).then(render).catch(() => {});
});

tabUrl = await resolveTabUrl();
send({ cmd: 'state' }).then(render).catch((e) => notice(`Could not load settings: ${e.message}`, true));
