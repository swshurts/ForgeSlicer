// Small typed localStorage helpers + LRU for recently-used printers.
//
// Note on lint: these helpers ONLY store non-sensitive UI prefs (a list of
// recently-used printer IDs and a list of upvoted printer IDs). No tokens,
// passwords, or PII go here, so the generic "insecure localStorage" lint
// warning doesn't apply — silenced inline.

const LS_RECENT_PRINTERS = "forgeslicer.recentPrinters";
const LS_UPVOTED_PRINTERS = "forgeslicer.upvotedPrinters";
const MAX_RECENT = 4;

const read = (key, fallback) => {
  try {
    // eslint-disable-next-line no-restricted-globals
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch (err) {
    // localStorage can throw in privacy / quota / disabled modes. Log
    // once so devs see it but always return the caller's fallback so the
    // UI keeps working.
    // eslint-disable-next-line no-console
    console.warn(`persist.read(${key}) failed:`, err);
    return fallback;
  }
};
const write = (key, value) => {
  try {
    // eslint-disable-next-line no-restricted-globals
    localStorage.setItem(key, JSON.stringify(value));
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn(`persist.write(${key}) failed:`, err);
  }
};

export const recentPrinters = {
  list: () => read(LS_RECENT_PRINTERS, []),
  push: (printerId) => {
    if (!printerId) return;
    const cur = read(LS_RECENT_PRINTERS, []);
    const next = [printerId, ...cur.filter((p) => p !== printerId)].slice(0, MAX_RECENT);
    write(LS_RECENT_PRINTERS, next);
    return next;
  },
  clear: () => write(LS_RECENT_PRINTERS, []),
};

export const upvotedPrinters = {
  has: (id) => read(LS_UPVOTED_PRINTERS, []).includes(id),
  add: (id) => {
    const cur = read(LS_UPVOTED_PRINTERS, []);
    if (!cur.includes(id)) write(LS_UPVOTED_PRINTERS, [...cur, id]);
  },
};
