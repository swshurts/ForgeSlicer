// Captures every uncaught JS error & promise rejection in the browser
// and ships it to /api/client-error so we can debug Safari iPad issues
// without needing screenshots from the user.

const BACKEND = process.env.REACT_APP_BACKEND_URL;
const ENDPOINT = `${BACKEND}/api/client-error`;
// Bump this whenever errorReporter changes so we can tell from the
// backend log which build a given report came from (helps detect Safari
// cache issues where users still run an old bundle).
const REPORTER_VERSION = "v4-2026-02-23-console-intercept";

let lastSig = "";
let lastTime = 0;

const send = (payload) => {
  // De-duplicate identical bursts within 2s so a slider that fires 30
  // identical errors per drag doesn't flood logs.
  const sig = `${payload.message}|${payload.source}|${payload.line}`;
  const now = Date.now();
  if (sig === lastSig && now - lastTime < 2000) return;
  lastSig = sig;
  lastTime = now;
  try {
    const body = JSON.stringify({
      ...payload,
      reporter_version: REPORTER_VERSION,
      user_agent: navigator.userAgent,
      url: window.location.href,
    });
    if (navigator.sendBeacon) {
      navigator.sendBeacon(
        ENDPOINT,
        new Blob([body], { type: "application/json" })
      );
    } else {
      fetch(ENDPOINT, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body,
        keepalive: true,
      }).catch(() => {});
    }
  } catch {
    /* swallow — never break the app trying to report errors */
  }
};

/**
 * Wraps a callback so any synchronous error inside it is reported with
 * full message + stack (Safari can't sanitize errors caught inside our
 * own code the way it does cross-origin window.onerror events).
 */
export const safeCb = (label, fn) => (...args) => {
  try {
    return fn(...args);
  } catch (e) {
    send({
      message: `[${label}] ${e?.message || e}`,
      stack: e?.stack || "",
      source: "safeCb",
      line: 0,
      column: 0,
    });
    // Re-throw so React/Radix can still handle it if they want.
    throw e;
  }
};

export const installErrorReporter = () => {
  window.addEventListener("error", (e) => {
    send({
      message: e.message || "(no message)",
      stack: e.error?.stack || "",
      source: e.filename || "",
      line: e.lineno || 0,
      column: e.colno || 0,
    });
  });
  window.addEventListener("unhandledrejection", (e) => {
    const r = e.reason;
    send({
      message: `Unhandled rejection: ${r?.message || r || "(unknown)"}`,
      stack: r?.stack || "",
      source: "",
      line: 0,
      column: 0,
    });
  });

  // Intercept console.error — React calls this with the FULL error message
  // and stack BEFORE the browser sanitizes the window.onerror event to
  // "Script error.". This is our only reliable way to capture iPad Safari
  // errors that happen inside event handlers, since CRA serves bundle.js
  // without crossorigin="anonymous" and we can't change that without
  // ejecting.
  const orig = console.error.bind(console);
  console.error = (...args) => {
    try {
      // Find the Error instance (React passes it as one of the args).
      const errArg = args.find((a) => a instanceof Error);
      const formatted = args
        .map((a) => {
          if (a instanceof Error) return `${a.name}: ${a.message}`;
          if (typeof a === "string") return a;
          try { return JSON.stringify(a).slice(0, 300); } catch { return String(a); }
        })
        .join(" | ");
      // Skip noisy React dev warnings about deprecated APIs / keys etc.
      const looksLikeReactWarning =
        typeof args[0] === "string" &&
        (args[0].startsWith("Warning:") ||
          args[0].includes("validateDOMNesting") ||
          args[0].includes("act("));
      if (!looksLikeReactWarning) {
        send({
          message: `[console.error] ${formatted.slice(0, 500)}`,
          stack: errArg?.stack || "",
          source: "console.error",
          line: 0,
          column: 0,
        });
      }
    } catch {
      /* never break the original console.error path */
    }
    orig(...args);
  };
};
