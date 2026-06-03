import axios from "axios";

// Resolve the backend base URL at runtime.
//
// On the preview environment this is the same host as the page (the deploy
// preview URL), so REACT_APP_BACKEND_URL works as-is.
//
// On production with a CUSTOM DOMAIN (e.g. https://forgeslicer.com pointing
// at the Emergent deployment), REACT_APP_BACKEND_URL was baked at deploy
// time to the original *.emergent.host URL. Using it directly causes API
// calls to go cross-origin, which means the httpOnly `session_token` cookie
// (set on forgeslicer.com after sign-in) is NEVER sent — every /me call
// 401s and the auth state collapses, bouncing the user back to sign-in.
//
// Detect that case and prefer the page's own origin so cookies stay
// first-party. We still fall back to the env var when running in Node /
// SSR contexts where `window` doesn't exist.
const ENV_BACKEND_URL = process.env.REACT_APP_BACKEND_URL || "";
function resolveBackendUrl() {
  if (typeof window === "undefined") return ENV_BACKEND_URL;
  if (!ENV_BACKEND_URL) return window.location.origin;
  try {
    const envHost = new URL(ENV_BACKEND_URL).host;
    if (envHost === window.location.host) return ENV_BACKEND_URL;
    // Page is being served from a different host than the env var — use
    // the page's origin so cookies stay first-party. The Emergent ingress
    // routes /api/* on the custom domain to the same backend.
    return window.location.origin;
  } catch {
    return window.location.origin;
  }
}

const BACKEND_URL = resolveBackendUrl();
export const API = `${BACKEND_URL}/api`;

// Heavy list endpoints (gallery + components) currently ship a large JSON
// payload (~1.9 MB at time of writing because every card includes its
// inline base64 thumbnail). The Kubernetes ingress sometimes drops the
// connection mid-transfer on slow networks, surfacing as axios's generic
// "Network Error" with no status. We wrap those calls in a small retry
// helper with an explicit longer timeout so transient ingress hiccups
// don't leave the user looking at an empty page.
const HEAVY_LIST_TIMEOUT_MS = 45000;
const HEAVY_LIST_RETRIES = 2;

async function fetchHeavyList(url, { params } = {}) {
  let lastErr = null;
  for (let attempt = 0; attempt <= HEAVY_LIST_RETRIES; attempt++) {
    try {
      const { data } = await axios.get(url, { params, timeout: HEAVY_LIST_TIMEOUT_MS });
      return data;
    } catch (err) {
      lastErr = err;
      const status = err?.response?.status;
      // Retry only on network-level failures (no response or 5xx). 4xx is a
      // real client error — let it bubble immediately.
      if (status && status < 500) throw err;
      // eslint-disable-next-line no-console
      console.warn(`[api] heavy list ${url} failed (attempt ${attempt + 1}/${HEAVY_LIST_RETRIES + 1}):`, err?.message || err);
      if (attempt < HEAVY_LIST_RETRIES) {
        await new Promise((r) => setTimeout(r, 800 * (attempt + 1)));
      }
    }
  }
  throw lastErr || new Error("Network error");
}

export const galleryApi = {
  list: async ({ material, mine } = {}) => {
    const params = {};
    if (material && material !== "all") params.material = material;
    if (mine) params.mine = true;
    return fetchHeavyList(`${API}/gallery`, { params });
  },
  create: async (payload) => {
    const { data } = await axios.post(`${API}/gallery`, payload);
    return data;
  },
  downloadUrl: (id) => `${API}/gallery/${id}/download`,
  delete: async (id) => {
    const { data } = await axios.delete(`${API}/gallery/${id}`);
    return data;
  },
};

export const printersApi = {
  list: async () => {
    const { data } = await axios.get(`${API}/printers`);
    return data;
  },
  create: async (payload) => {
    const { data } = await axios.post(`${API}/printers`, payload);
    return data;
  },
  use: async (id) => {
    try {
      await axios.post(`${API}/printers/${id}/use`);
    } catch (err) {
      // Non-fatal — analytics counter only. Surface for debugging anyway.
      // eslint-disable-next-line no-console
      console.warn("printersApi.use failed (non-fatal):", err);
    }
  },
  upvote: async (id) => {
    const { data } = await axios.post(`${API}/printers/${id}/upvote`);
    return data;
  },
  delete: async (id) => {
    const { data } = await axios.delete(`${API}/printers/${id}`);
    return data;
  },
};

export const componentsApi = {
  list: async ({ modifier, category, q, mine } = {}) => {
    const params = {};
    if (modifier) params.modifier = modifier;
    if (category) params.category = category;
    if (q) params.q = q;
    if (mine) params.mine = true;
    return fetchHeavyList(`${API}/components`, { params });
  },
  create: async (payload) => {
    const { data } = await axios.post(`${API}/components`, payload);
    return data;
  },
  getProject: async (id) => {
    const { data } = await axios.get(`${API}/components/${id}/project`);
    return data;
  },
  upvote: async (id) => {
    const { data } = await axios.post(`${API}/components/${id}/upvote`);
    return data;
  },
  delete: async (id) => {
    const { data } = await axios.delete(`${API}/components/${id}`);
    return data;
  },
};

// Hierarchical user projects — /api/projects/* (auth-required).
// Backend stores a flat list of nodes with parent_id; the UI builds the
// tree client-side from the meta list, then fetches a node's `forge_json`
// detail blob on demand when the user picks "Open".
export const projectsApi = {
  list: async () => {
    const { data } = await axios.get(`${API}/projects`);
    return data;
  },
  get: async (pid) => {
    const { data } = await axios.get(`${API}/projects/${pid}`);
    return data;
  },
  create: async ({ name, description = "", parent_id = null, forge_json = null }) => {
    const { data } = await axios.post(`${API}/projects`, {
      name, description, parent_id, forge_json,
    });
    return data;
  },
  update: async (pid, patch) => {
    const { data } = await axios.put(`${API}/projects/${pid}`, patch);
    return data;
  },
  remove: async (pid) => {
    const { data } = await axios.delete(`${API}/projects/${pid}`);
    return data;
  },
};

// OrcaSlicer engine — opt-in production-quality slicer. The built-in
// JS slicer remains the default; this is invoked only when the user
// flips the Engine selector in the Slicer popover.
export const orcaApi = {
  status: async () => {
    const { data } = await axios.get(`${API}/slice/orca/status`, { timeout: 8000 });
    return data;
  },
  preset: async ({ vendor, kind, name }) => {
    const { data } = await axios.get(
      `${API}/slice/orca/preset`,
      { params: { vendor, kind, name }, timeout: 15000 },
    );
    return data;
  },
  reinstall: async ({ force = false } = {}) => {
    const { data } = await axios.post(
      `${API}/slice/orca/reinstall`,
      null,
      { params: { force }, timeout: 30000 },
    );
    return data;
  },
  slice: async ({
    stlBase64, jobId,
    printerProfile, processProfile, filamentProfile,
    printerPresetName, printerVendor,
    processPresetName, processVendor,
    filamentPresetName, filamentVendor,
    userPrinterId,
  }) => {
    // Kick off the slice — returns 202 with `{job_id}` immediately.
    // The actual work runs as a backend asyncio task; we then poll
    // `result()` once SSE reports `done`. This avoids Cloudflare's
    // 100s origin-timeout (HTTP 524) for slices that exceed it.
    const { data } = await axios.post(
      `${API}/slice/orca/slice`,
      {
        stl_base64: stlBase64,
        job_id: jobId || null,
        printer_profile: printerProfile || {},
        process_profile: processProfile || {},
        filament_profile: filamentProfile || {},
        printer_preset_name:  printerPresetName  || null,
        printer_vendor:       printerVendor      || null,
        process_preset_name:  processPresetName  || null,
        process_vendor:       processVendor      || null,
        filament_preset_name: filamentPresetName || null,
        filament_vendor:      filamentVendor     || null,
        // Per-user custom printer id (iter-72). When set, the backend
        // ignores the bundled-preset hints above and uses the stored
        // user_printers doc to build the printer profile.
        user_printer_id:      userPrinterId      || null,
      },
      { timeout: 30000 }, // 30s — the POST itself is fast now
    );
    return data;
  },
  // Fetch the final GCODE + stats for a slice job kicked off via slice().
  // Returns the OrcaSliceResponse shape (gcode + stats + engine + job_id)
  // when the job is complete. Callers should subscribe to the SSE
  // progress endpoint and only call this once they see done=true.
  sliceResult: async ({ jobId }) => {
    const { data } = await axios.get(
      `${API}/slice/orca/result/${encodeURIComponent(jobId)}`,
      { timeout: 30000 },
    );
    return data;
  },
  // Poll `/result/{jobId}` until the job either finishes (returns the
  // OrcaSliceResponse) or fails (axios throws with the 4xx/5xx detail).
  // While the backend still returns 202 we sleep and retry. Used by
  // Engine Comparison, which doesn't need the live progress bar that
  // `useOrcaSlice` drives via SSE.
  //
  // `maxWaitMs` is a safety net (default 6 min — matches the backend's
  // 5-min slice timeout + headroom). `pollIntervalMs` controls the
  // cadence; 1500 ms keeps server load minimal for slices that take
  // ~2 min while still feeling snappy for the <30 s common case.
  waitForSliceResult: async ({ jobId, maxWaitMs = 360000, pollIntervalMs = 1500 }) => {
    const t0 = Date.now();
    // axios treats 202 as a success by default, so the loop runs as
    // long as the body says `status: "running"`.
    while (true) {
      const { data, status } = await axios.get(
        `${API}/slice/orca/result/${encodeURIComponent(jobId)}`,
        {
          timeout: 30000,
          // Don't throw on 2xx — we explicitly want to see the 202s.
          validateStatus: (s) => s >= 200 && s < 300,
        },
      );
      if (status === 200) return data; // OrcaSliceResponse
      // status === 202 — job still running.
      if (Date.now() - t0 > maxWaitMs) {
        throw new Error(
          `OrcaSlicer job ${jobId} did not finish within ${Math.round(maxWaitMs / 1000)}s.`,
        );
      }
      await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
    }
  },
  // Cancel an in-flight slice job (iter-77). Returns
  // `{status: 'cancelling' | 'already_done'}` on success; 404 for
  // unknown jobs is treated as a no-op so fire-and-forget cancels
  // on tab-close don't surface noise.
  cancel: async ({ jobId }) => {
    const { data } = await axios.delete(
      `${API}/slice/orca/job/${encodeURIComponent(jobId)}`,
      {
        timeout: 10000,
        validateStatus: (s) => (s >= 200 && s < 300) || s === 404,
      },
    );
    return data;
  },
};

// Per-user custom printer definitions (iter-72). Backed by the
// `/api/me/printers/*` CRUD endpoints — let users register printers
// not in OrcaSlicer's bundled preset library (the 2026 wave of new
// hardware) and have them appear in the slicer dropdown.
export const userPrintersApi = {
  list: async () => {
    const { data } = await axios.get(`${API}/me/printers`, { timeout: 10000 });
    return data;
  },
  create: async (payload) => {
    const { data } = await axios.post(`${API}/me/printers`, payload, { timeout: 10000 });
    return data;
  },
  update: async (printerId, payload) => {
    const { data } = await axios.put(
      `${API}/me/printers/${encodeURIComponent(printerId)}`,
      payload,
      { timeout: 10000 },
    );
    return data;
  },
  remove: async (printerId) => {
    const { data } = await axios.delete(
      `${API}/me/printers/${encodeURIComponent(printerId)}`,
      { timeout: 10000 },
    );
    return data;
  },
  publish: async (printerId) => {
    const { data } = await axios.post(
      `${API}/me/printers/${encodeURIComponent(printerId)}/publish`,
      null,
      { timeout: 10000 },
    );
    return data;
  },
  unpublish: async (printerId) => {
    const { data } = await axios.post(
      `${API}/me/printers/${encodeURIComponent(printerId)}/unpublish`,
      null,
      { timeout: 10000 },
    );
    return data;
  },
};

// Iter-86: globally-synced printers fetched from SoftFever/OrcaSlicer's
// repo and merged by admins. Public anonymous read so every slicer
// popover can show the latest upstream models in the dropdown.
export const syncedPrintersApi = {
  list: async () => {
    const { data } = await axios.get(`${API}/synced-printers`, { timeout: 10000 });
    return data;
  },
};

// Iter-83: Shared Profile Library — community-published printer
// profiles, browsable without auth, clonable with auth.
export const sharedPrintersApi = {
  list: async ({ printerModel } = {}) => {
    const params = {};
    if (printerModel) params.printer_model = printerModel;
    const { data } = await axios.get(`${API}/shared-printers`, { params, timeout: 10000 });
    return data;
  },
  get: async (printerId) => {
    const { data } = await axios.get(
      `${API}/shared-printers/${encodeURIComponent(printerId)}`,
      { timeout: 10000 },
    );
    return data;
  },
  clone: async (printerId) => {
    const { data } = await axios.post(
      `${API}/shared-printers/${encodeURIComponent(printerId)}/clone`,
      null,
      { timeout: 10000 },
    );
    return data;
  },
  flag: async (printerId) => {
    const { data } = await axios.post(
      `${API}/shared-printers/${encodeURIComponent(printerId)}/flag`,
      null,
      { timeout: 10000 },
    );
    return data;
  },
};

// Human-friendly error formatter for the catch-block. axios's "Network Error"
// alone gives the user no actionable info — we expand on it.
export const apiErrorMessage = (err) => {
  if (!err) return "Unknown error";
  const status = err.response?.status;
  const detail = err.response?.data?.detail;
  if (status === 401) return "You need to sign in to do that.";
  if (status === 403) return "You don't have permission for that.";
  if (status === 404) return "Item not found.";
  if (detail) return `${detail}${status ? ` (HTTP ${status})` : ""}`;
  if (err.code === "ECONNABORTED") return "Server took too long to respond. Try again.";
  if (err.message === "Network Error") {
    return "Network error — the server didn't respond. This usually clears in a few seconds; press Retry.";
  }
  return err.message || "Request failed.";
};
