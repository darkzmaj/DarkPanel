// Popup Guard — domain normalization and matching.
// Pure ES module: shared by the service worker, the settings UI and the Node
// unit tests. No browser APIs.
//
// Matching semantics (documented in docs/POPUP_GUARD.md):
//   A rule "example.com" protects example.com and every subdomain of it
//   (www.example.com, a.b.example.com). It never matches by substring, so
//   "notexample.com" and "example.com.evil.net" are NOT matched.

const LABEL = /^(?!-)[a-z0-9-]{1,63}(?<!-)$/;
const IPV4 = /^\d{1,3}(\.\d{1,3}){3}$/;

/**
 * Turns user input (plain domain, full URL, "*.domain", IDN) into a canonical
 * lower-case ASCII (punycode) hostname, or returns null when invalid.
 * A single leading "www." is stripped because a rule covers subdomains anyway.
 */
export function normalizeDomain(input) {
  if (typeof input !== 'string') return null;
  let raw = input.trim();
  if (!raw || raw.length > 2048 || /\s/.test(raw)) return null;
  if (raw.startsWith('*.')) raw = raw.slice(2);
  if (raw.startsWith('//')) raw = 'https:' + raw;
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(raw)) {
    if (!/^https?:\/\//i.test(raw)) return null; // ftp://, chrome://, file://
  } else {
    // Reject javascript:, data:, mailto: etc. but allow "host:port/path".
    if (/^[a-z][a-z0-9+.-]*:(?!\d)/i.test(raw)) return null;
    raw = 'https://' + raw;
  }
  let url;
  try { url = new URL(raw); } catch { return null; }
  if (url.username || url.password) return null;
  let host = url.hostname.toLowerCase().replace(/\.$/, '');
  if (!host || host.length > 253 || host.startsWith('[')) return null; // no IPv6 rules
  if (host === 'localhost') return host;
  if (IPV4.test(host)) return host; // URL() already rejected out-of-range octets
  const labels = host.split('.');
  if (labels.length < 2 || !labels.every((l) => LABEL.test(l))) return null;
  const tld = labels[labels.length - 1];
  if (!/^(?:[a-z]{2,63}|xn--[a-z0-9-]{1,59})$/.test(tld)) return null;
  if (labels[0] === 'www' && labels.length > 2) host = labels.slice(1).join('.');
  return host;
}

/** True when `hostname` is `domain` or a subdomain of it (label boundary). */
export function matchesDomain(hostname, domain) {
  if (!hostname || !domain) return false;
  const host = String(hostname).toLowerCase().replace(/\.$/, '');
  return host === domain || host.endsWith('.' + domain);
}

/** Extracts the hostname of an http(s) URL, or null. */
export function hostOf(url) {
  try {
    const u = new URL(url);
    return u.protocol === 'http:' || u.protocol === 'https:' ? u.hostname.toLowerCase() : null;
  } catch { return null; }
}

/** Chrome match pattern covering a rule domain and its subdomains. */
export function hostPatterns(domain) {
  if (domain === 'localhost' || IPV4.test(domain)) return [`*://${domain}/*`];
  return [`*://${domain}/*`, `*://*.${domain}/*`];
}
