// Popup Guard — configuration model and pure decision logic.
// Every mutation returns a NEW config object; persistence lives in store.js.
import { normalizeDomain, matchesDomain, hostOf } from './domain.js';

export const MODES = Object.freeze(['balanced', 'strict']);
export const MAX_SITES = 500;
export const SCHEMA_VERSION = 1;

/** Factory defaults. MyFlixer ships preconfigured in Strict mode. */
export function defaultConfig() {
  return {
    version: SCHEMA_VERSION,
    enabled: true,
    sites: [{ domain: 'myflixerfree.io', enabled: true, mode: 'strict' }],
  };
}

/** Validates untrusted stored data; drops invalid/duplicate entries. */
export function sanitizeConfig(raw) {
  if (!raw || typeof raw !== 'object' || !Array.isArray(raw.sites)) return defaultConfig();
  const seen = new Set();
  const sites = [];
  for (const s of raw.sites) {
    const domain = s && normalizeDomain(String(s.domain ?? ''));
    if (!domain || seen.has(domain) || sites.length >= MAX_SITES) continue;
    seen.add(domain);
    sites.push({
      domain,
      enabled: s.enabled !== false,
      mode: MODES.includes(s.mode) ? s.mode : 'balanced',
    });
  }
  return { version: SCHEMA_VERSION, enabled: raw.enabled !== false, sites };
}

export class RuleError extends Error {}

function requireDomain(input) {
  const domain = normalizeDomain(input);
  if (!domain) throw new RuleError('Enter a valid domain or http(s) URL, e.g. example.com');
  return domain;
}

function indexOf(config, domain) {
  return config.sites.findIndex((s) => s.domain === domain);
}

/** Adds a domain (or re-enables an existing one). Returns {config, domain, existed}. */
export function addSite(config, input, mode = 'balanced') {
  const domain = requireDomain(input);
  if (!MODES.includes(mode)) throw new RuleError('Unknown protection mode');
  const sites = config.sites.map((s) => ({ ...s }));
  const i = indexOf(config, domain);
  if (i !== -1) {
    sites[i].enabled = true;
    return { config: { ...config, sites }, domain, existed: true };
  }
  if (sites.length >= MAX_SITES) throw new RuleError(`Limit reached (${MAX_SITES} websites)`);
  sites.push({ domain, enabled: true, mode });
  return { config: { ...config, sites }, domain, existed: false };
}

function update(config, input, patch) {
  const domain = requireDomain(input);
  const i = indexOf(config, domain);
  if (i === -1) throw new RuleError(`${domain} is not in the list`);
  const sites = config.sites.map((s, j) => (j === i ? { ...s, ...patch } : s));
  return { ...config, sites };
}

export function removeSite(config, input) {
  const domain = requireDomain(input);
  if (indexOf(config, domain) === -1) throw new RuleError(`${domain} is not in the list`);
  return { ...config, sites: config.sites.filter((s) => s.domain !== domain) };
}

export function setSiteEnabled(config, input, enabled) {
  if (typeof enabled !== 'boolean') throw new RuleError('Invalid switch value');
  return update(config, input, { enabled });
}

export function setSiteMode(config, input, mode) {
  if (!MODES.includes(mode)) throw new RuleError('Unknown protection mode');
  return update(config, input, { mode });
}

export function setGlobalEnabled(config, enabled) {
  if (typeof enabled !== 'boolean') throw new RuleError('Invalid switch value');
  return { ...config, enabled };
}

/**
 * Most specific rule covering a URL or hostname (longest matching domain), or
 * null. Disabled rules are returned too so the UI can show "paused".
 */
export function findRule(config, urlOrHost) {
  const host = urlOrHost && urlOrHost.includes('/') ? hostOf(urlOrHost) : urlOrHost;
  if (!host) return null;
  let best = null;
  for (const s of config.sites) {
    if (matchesDomain(host, s.domain) && (!best || s.domain.length > best.domain.length)) best = s;
  }
  return best;
}

/** The rule actively protecting a URL, honoring global and per-site switches. */
export function activeRule(config, url) {
  if (!config.enabled) return null;
  const rule = findRule(config, url);
  return rule && rule.enabled ? rule : null;
}

export function inScope(rule, url) {
  const host = hostOf(url);
  return !!host && matchesDomain(host, rule.domain);
}

/**
 * Decides whether a new tab/window opened BY a protected page may stay open.
 *   rule      the active rule of the opener tab
 *   targetUrl the URL the new tab was created for (may be about:blank)
 *   approval  {any:boolean} when the user explicitly asked for a new tab
 *             (modifier/middle click, context menu) moments before.
 */
export function decideNewTab(rule, targetUrl, approval) {
  if (!rule) return 'allow';
  if (approval) {
    if (rule.mode === 'balanced') return 'allow';
    // Strict: even user-requested new tabs must stay on the protected site.
    return inScope(rule, targetUrl) ? 'allow' : 'block';
  }
  if (rule.mode === 'balanced' && inScope(rule, targetUrl)) return 'allow';
  return 'block';
}

const USER_TRANSITIONS = new Set(['typed', 'auto_bookmark', 'generated', 'keyword', 'keyword_generated', 'reload', 'start_page', 'form_submit']);

/**
 * Decides whether a committed top-level navigation that LEFT a protected site
 * is an unsolicited redirect that should be reverted.
 *   fromUrl  previous committed URL in the tab (protected)
 *   nav      {url, transitionType, transitionQualifiers}
 */
export function decideRedirect(rule, fromUrl, nav) {
  if (!rule || !inScope(rule, fromUrl) || inScope(rule, nav.url)) return 'allow';
  if (!hostOf(nav.url)) return 'allow'; // browser pages, downloads, etc.
  const q = nav.transitionQualifiers || [];
  if (q.includes('forward_back') || q.includes('from_address_bar')) return 'allow';
  if (USER_TRANSITIONS.has(nav.transitionType) && nav.transitionType !== 'form_submit') return 'allow';
  if (q.includes('client_redirect')) return 'block'; // script / meta refresh
  if (rule.mode === 'strict' && nav.transitionType !== 'typed') return 'block';
  return 'allow';
}
