import axios from "axios";

const BACKEND_URL = process.env.REACT_APP_BACKEND_URL;
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
  list: async ({ material } = {}) => {
    const params = {};
    if (material && material !== "all") params.material = material;
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
  list: async ({ modifier, category, q } = {}) => {
    const params = {};
    if (modifier) params.modifier = modifier;
    if (category) params.category = category;
    if (q) params.q = q;
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
