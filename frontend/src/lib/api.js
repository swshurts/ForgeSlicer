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
    stlBase64, printerProfile, processProfile, filamentProfile,
    printerPresetName, printerVendor,
    processPresetName, processVendor,
    filamentPresetName, filamentVendor,
  }) => {
    const { data } = await axios.post(
      `${API}/slice/orca/slice`,
      {
        stl_base64: stlBase64,
        printer_profile: printerProfile || {},
        process_profile: processProfile || {},
        filament_profile: filamentProfile || {},
        // Preferred path: name a bundled OrcaSlicer system preset and
        // let the backend resolve its inheritance chain. The *_profile
        // dicts above are then applied as overrides on top. When these
        // are null/omitted the backend stays on the legacy raw-dict
        // path so older callers keep working.
        printer_preset_name:  printerPresetName  || null,
        printer_vendor:       printerVendor      || null,
        process_preset_name:  processPresetName  || null,
        process_vendor:       processVendor      || null,
        filament_preset_name: filamentPresetName || null,
        filament_vendor:      filamentVendor     || null,
      },
      { timeout: 360000 }, // 6 min — matches the backend's 5-min Orca cap + transport overhead
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
