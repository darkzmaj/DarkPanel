// DarkPanel / Popup Guard: ISOLATED-world guard for clicks and form submissions on
// protected sites. Knows the exact rule scope (reads extension storage).
(() => {
  'use strict';
  let scope = location.hostname.toLowerCase().replace(/^www\./, '');
  let mode = 'balanced';
  chrome.storage.local.get('popupGuard.config').then((got) => {
    const sites = got['popupGuard.config']?.sites || [];
    const host = location.hostname.toLowerCase();
    const rule = sites
      .filter((s) => s.enabled && (host === s.domain || host.endsWith('.' + s.domain)))
      .sort((a, b) => b.domain.length - a.domain.length)[0];
    if (rule) { scope = rule.domain; mode = rule.mode; }
  }).catch(() => {});

  const send = (msg) => { try { chrome.runtime.sendMessage(msg).catch(() => {}); } catch { /* reloaded */ } };
  const external = (raw) => {
    if (!raw) return false;
    let u;
    try { u = new URL(raw, document.baseURI); } catch { return true; }
    if (u.protocol === 'javascript:') return false;
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return true;
    const h = u.hostname.toLowerCase();
    return !(h === scope || h.endsWith('.' + scope));
  };
  const block = (e) => { e.preventDefault(); e.stopImmediatePropagation(); send({ cmd: 'blocked' }); };

  function onClick(e) {
    const el = e.target instanceof Element ? e.target : e.target?.parentElement;
    const a = el?.closest('a[href], area[href]');
    if (!a) return;
    const target = (a.getAttribute('target') || '').toLowerCase();
    const userNewTab = e.isTrusted && (e.ctrlKey || e.metaKey || e.shiftKey || e.button === 1);
    const pageNewTab = !!target && target !== '_self' && target !== '_top' && target !== '_parent';
    const ext = external(a.href);

    if (!e.isTrusted) { // a.click() from script: never treat as user intent
      if (ext || pageNewTab) block(e);
      return;
    }
    if (userNewTab) { // explicit user choice (Ctrl/Shift/middle click)
      if (mode === 'strict' && ext) return block(e);
      return send({ cmd: 'approveOpen' });
    }
    if (pageNewTab) { // target=_blank: the classic ad-overlay pattern
      if (ext) return block(e);
      return send({ cmd: 'approveOpen' });
    }
    if (ext && mode === 'strict') block(e);
  }

  function onSubmit(e) {
    const f = e.target;
    if (!(f instanceof HTMLFormElement)) return;
    const target = (e.submitter?.getAttribute('formtarget') || f.getAttribute('target') || '').toLowerCase();
    const action = e.submitter?.getAttribute('formaction') || f.getAttribute('action');
    const newWin = !!target && target !== '_self';
    if (!e.isTrusted || mode === 'strict' || newWin) {
      if (external(action) || (newWin && mode === 'strict')) block(e);
    }
  }

  window.addEventListener('click', onClick, true);
  window.addEventListener('auxclick', onClick, true);
  window.addEventListener('submit', onSubmit, true);
  // "Open link in new tab" from the context menu is a user choice too.
  window.addEventListener('contextmenu', (e) => {
    if (e.isTrusted && e.target instanceof Element && e.target.closest('a[href]')) send({ cmd: 'approveOpen', menu: true });
  }, true);

  let last = 0;
  window.addEventListener('popup-guard-blocked', () => {
    const now = Date.now();
    if (now - last > 250) { last = now; send({ cmd: 'blocked' }); } // throttle page-forgeable signal
  });
})();
