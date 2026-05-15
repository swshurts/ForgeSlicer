// Small typed localStorage helpers + LRU for recently-used printers.

const LS_RECENT_PRINTERS = "forgeslicer.recentPrinters";
const LS_UPVOTED_PRINTERS = "forgeslicer.upvotedPrinters";
const MAX_RECENT = 4;

const read = (key, fallback) => {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch { return fallback; }
};
const write = (key, value) => {
  try { localStorage.setItem(key, JSON.stringify(value)); } catch {}
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
