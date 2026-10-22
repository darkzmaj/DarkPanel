// DarkPanel / Popup Guard: persistence on top of a chrome.storage.local-like area.
// All writes go through one promise queue so concurrent add/remove/toggle
// requests can never overwrite each other (a lost-update bug class that a
// read-modify-write per message would otherwise have).
import { defaultConfig, sanitizeConfig } from './rules.js';

export const CONFIG_KEY = 'popupGuard.config';
export const STATS_KEY = 'popupGuard.stats';

export function createStore(area) {
  let queue = Promise.resolve();
  const serialize = (job) => {
    const run = queue.then(job, job);
    queue = run.catch(() => {});
    return run;
  };

  async function readConfig() {
    const got = await area.get(CONFIG_KEY);
    return got[CONFIG_KEY] === undefined ? null : sanitizeConfig(got[CONFIG_KEY]);
  }

  return {
    /** Current config; seeds defaults once (an empty list stays empty). */
    load: () => serialize(async () => {
      const cfg = await readConfig();
      if (cfg) return cfg;
      const seeded = defaultConfig();
      await area.set({ [CONFIG_KEY]: seeded });
      return seeded;
    }),
    /** Applies fn(config) -> config atomically and persists it. */
    mutate: (fn) => serialize(async () => {
      const current = (await readConfig()) ?? defaultConfig();
      const next = sanitizeConfig(fn(current));
      await area.set({ [CONFIG_KEY]: next });
      return next;
    }),
    /** Resets ONLY Popup Guard keys; unrelated browser settings are untouched. */
    reset: () => serialize(async () => {
      const seeded = defaultConfig();
      await area.set({ [CONFIG_KEY]: seeded, [STATS_KEY]: { total: 0, byDomain: {} } });
      return seeded;
    }),
    stats: () => serialize(async () => {
      const got = await area.get(STATS_KEY);
      const s = got[STATS_KEY];
      return s && typeof s.total === 'number' ? s : { total: 0, byDomain: {} };
    }),
    countBlocked: (domain, n = 1) => serialize(async () => {
      const got = await area.get(STATS_KEY);
      const s = got[STATS_KEY] && typeof got[STATS_KEY].total === 'number'
        ? got[STATS_KEY] : { total: 0, byDomain: {} };
      const next = { total: s.total + n, byDomain: { ...s.byDomain, [domain]: (s.byDomain[domain] || 0) + n } };
      await area.set({ [STATS_KEY]: next });
      return next;
    }),
    resetStats: () => serialize(async () => {
      const empty = { total: 0, byDomain: {} };
      await area.set({ [STATS_KEY]: empty });
      return empty;
    }),
  };
}

/** In-memory storage area for tests (mirrors chrome.storage.local semantics). */
export function memoryArea(initial = {}) {
  const data = structuredClone(initial);
  return {
    data,
    async get(key) { return key in data ? { [key]: structuredClone(data[key]) } : {}; },
    async set(obj) { for (const [k, v] of Object.entries(obj)) data[k] = structuredClone(v); },
  };
}
