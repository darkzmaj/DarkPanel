// DarkPanel / Popup Guard: MAIN-world guard. Injected at document_start, before any
// page script, only into frames of protected sites (registration decides).
(() => {
  'use strict';
  const mode = globalThis.__popupGuardMode === 'strict' ? 'strict' : 'balanced';
  try { delete globalThis.__popupGuardMode; } catch { /* non-configurable */ }

  // The exact rule domain lives in extension storage, which this world cannot
  // read synchronously. Approximate "same site" as the current host (minus
  // www.), its subdomains and its parent domains. shortcut: sibling
  // subdomains (a.site.io -> b.site.io) count as external here; the service
  // worker backstop uses the exact rule scope.
  const base = location.hostname.toLowerCase().replace(/^www\./, '');
  const under = (h, d) => h === d || h.endsWith('.' + d);
  const internal = (raw) => {
    let u;
    try { u = new URL(raw, location.href); } catch { return false; }
    if (u.protocol === 'about:' || u.protocol === 'javascript:') return true;
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return false;
    const h = u.hostname.toLowerCase();
    return under(h, base) || (under(base, h) && h.includes('.'));
  };
  const report = (kind) =>
    window.dispatchEvent(new CustomEvent('popup-guard-blocked', { detail: kind }));

  const nativeOpen = window.open;
  function open(url, target) {
    const t = String(target ?? '_blank').toLowerCase();
    const sameFrame = t === '_self' || t === '_parent' || t === '_top';
    const gesture = !!navigator.userActivation?.isActive;
    // Same-frame targets are navigations, not popups.
    if (sameFrame && (internal(url ?? '') || (mode === 'balanced' && gesture))) {
      return nativeOpen.apply(this, arguments);
    }
    report('window.open');
    return null;
  }
  try {
    Object.defineProperty(window, 'open', { value: open, writable: false, configurable: false });
  } catch {
    try { window.open = open; } catch { /* locked by someone else */ }
  }

  // Script-initiated navigations of this frame to another site (location.href
  // = ..., location.replace, timed redirects) via the Navigation API.
  if (window.navigation) {
    window.navigation.addEventListener('navigate', (e) => {
      if (!e.cancelable || e.navigationType === 'traverse' || e.navigationType === 'reload') return;
      if (internal(e.destination.url)) return;
      if (e.userInitiated && mode === 'balanced') return;
      if (e.userInitiated && window !== window.top) return; // link-guard rules apply
      e.preventDefault();
      report('redirect');
    });
  }

  // Programmatic form.submit() to another site or a new window.
  const proto = HTMLFormElement.prototype;
  const nativeSubmit = proto.submit;
  const badForm = (f) => {
    const t = (f.getAttribute('target') || '').toLowerCase();
    return (t && t !== '_self') || !internal(f.getAttribute('action') || location.href);
  };
  proto.submit = function submit() {
    if (badForm(this)) { report('form'); return; }
    return nativeSubmit.apply(this, arguments);
  };
})();
