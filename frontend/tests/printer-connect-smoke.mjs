// Smoke tests for printerConnect.js — save/load, protocol registry,
// Moonraker URL building. We don't hit a real printer (no Klipper in CI)
// but we DO mock fetch to assert request shape so the upload path stays
// honest.
//
// Run: cd /app/frontend && node tests/printer-connect-smoke.mjs

import { JSDOM } from "jsdom";

const PASS = "\x1b[32mPASS\x1b[0m";
const FAIL = "\x1b[31mFAIL\x1b[0m";
const results = [];
function check(label, cond, extra = "") {
  results.push({ label, cond });
  console.log(`${cond ? PASS : FAIL} — ${label}${extra ? ` — ${extra}` : ""}`);
}

// Set up a minimal browser-ish global so the module's localStorage +
// fetch references don't crash on import. jsdom requires a non-opaque
// origin for localStorage to be usable, hence the `url:` option.
const dom = new JSDOM("", { url: "http://localhost/" });
globalThis.window = dom.window;
globalThis.localStorage = dom.window.localStorage;
globalThis.XMLHttpRequest = class {
  open() {}
  setRequestHeader() {}
  send() {}
};

let fetchCalls = [];
globalThis.fetch = async (url, opts = {}) => {
  fetchCalls.push({ url, opts });
  return {
    ok: true,
    status: 200,
    json: async () => ({ result: { hostname: "fake-printer", software_version: "Moonraker 0.9.0", state: "ready" } }),
  };
};

const mod = await import("../src/lib/printerConnect.js");
const {
  listConnections, saveConnection, deleteConnection,
  PROTOCOLS, testMoonraker, PrinterUploadError,
  listHistory, addHistoryEntry, clearHistory,
} = mod;

// ---- Persistence round trip ----
check("clean start: no saved connections", listConnections().length === 0);

const a = saveConnection({ name: "Voron", protocol: "moonraker", host: "192.168.1.50", port: 80 });
check("saved connection has generated id", typeof a.id === "string" && a.id.startsWith("pr-"));
check("listConnections returns the saved record", listConnections().length === 1);

const b = saveConnection({ id: a.id, name: "Voron in basement", protocol: "moonraker", host: "192.168.1.50" });
check("update preserves id", b.id === a.id);
const list = listConnections();
check("update mutates record in place (count still 1)", list.length === 1);
check("update applies new name", list[0].name === "Voron in basement");

const c = saveConnection({ name: "SV08", protocol: "moonraker", host: "sovol-sv08.local" });
check("second connection adds rather than replaces", listConnections().length === 2);
deleteConnection(c.id);
check("delete removes only the targeted connection", listConnections().length === 1);

// ---- Protocol registry ----
const proto = PROTOCOLS.find((p) => p.id === "moonraker");
check("Moonraker protocol present", !!proto);
check("Moonraker is marked implemented", proto.implemented === true);
check("Moonraker exposes test + upload", typeof proto.test === "function" && typeof proto.upload === "function");
check("Moonraker exposes CORS help with snippet", !!proto.corsHelp?.snippet);
check("CORS snippet mentions forgeslicer.com", proto.corsHelp.snippet.includes("forgeslicer.com"));

for (const id of ["prusalink", "octoprint", "bambu"]) {
  const p = PROTOCOLS.find((x) => x.id === id);
  check(`${id} placeholder is present`, !!p);
  check(`${id} placeholder is not implemented`, p && p.implemented === false);
  check(`${id} placeholder has a user-facing note`, !!p?.note);
}

// ---- Moonraker URL/header building (via testMoonraker which hits
//      `${base}/printer/info`) ----
fetchCalls = [];
await testMoonraker({ host: "192.168.1.50", port: 80, apiKey: "" });
check("testMoonraker calls /printer/info on the right URL",
  fetchCalls[0]?.url === "http://192.168.1.50:80/printer/info");
check("testMoonraker omits X-Api-Key when key is empty",
  !(fetchCalls[0]?.opts?.headers && "X-Api-Key" in fetchCalls[0].opts.headers));

fetchCalls = [];
await testMoonraker({ host: "https://printer.lan/api", apiKey: "abc123" });
check("testMoonraker preserves explicit https://",
  fetchCalls[0]?.url === "https://printer.lan/api/printer/info");
check("testMoonraker sends X-Api-Key when key is set",
  fetchCalls[0]?.opts?.headers?.["X-Api-Key"] === "abc123");

// ---- Failure path ----
fetchCalls = [];
globalThis.fetch = async () => { throw new Error("network down"); };
let caught = null;
try {
  await testMoonraker({ host: "10.0.0.99", port: 80 });
} catch (e) {
  caught = e;
}
check("testMoonraker wraps network failure as PrinterUploadError",
  caught instanceof PrinterUploadError);
check("PrinterUploadError carries a CORS hint", !!caught?.hint && caught.hint.toLowerCase().includes("cors"));

// ---- History persistence ----
clearHistory();
check("history starts empty after clear", listHistory().length === 0);
const h1 = addHistoryEntry({
  connId: "pr-fake1", printerName: "Voron 2.4", filename: "model.gcode", size: 512_000, started: true,
});
check("addHistoryEntry returns the new record with id+ts",
  typeof h1.id === "string" && typeof h1.ts === "string");
check("history.length === 1 after first add", listHistory().length === 1);
check("history record preserves started flag", listHistory()[0].started === true);
addHistoryEntry({ connId: "pr-fake1", printerName: "Voron 2.4", filename: "part2.gcode", size: 8000, started: false });
check("history sorts newest-first", listHistory()[0].filename === "part2.gcode");
// Cap at 50 entries.
for (let i = 0; i < 60; i++) {
  addHistoryEntry({ connId: "pr-fake1", printerName: "x", filename: `bulk-${i}.gcode`, size: 100, started: false });
}
check("history caps at 50 entries", listHistory().length === 50,
  `count=${listHistory().length}`);
clearHistory();
check("history clearable", listHistory().length === 0);

const failed = results.filter((r) => !r.cond);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
if (failed.length) {
  for (const f of failed) console.log("  - " + f.label);
  process.exit(1);
}
