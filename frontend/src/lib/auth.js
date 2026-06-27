import axios from "axios";
import { API } from "./api";

// Ensure cookies are sent with every backend request so the session_token
// httpOnly cookie established at /api/auth/session is automatically applied
// to gallery / components / me calls. (Set globally because the existing
// API helpers don't pass `withCredentials` per-call.)
axios.defaults.withCredentials = true;

// Defensive: also pass `{ withCredentials: true }` per-call. The global
// default above runs at module load, but webpack/CRA may evaluate api.js
// before auth.js and instantiate fetches before defaults are mutated.
// Per-call wins are deterministic.
const cfg = { withCredentials: true };

// Where the user was before they clicked Sign in — we restore them there
// after OAuth completes. Persisted in sessionStorage so it survives the
// full external round-trip through auth.emergentagent.com → Google → back.
const RETURN_PATH_KEY = "forgeslicer.auth.returnPath";

export const setReturnPath = (path) => {
  try { sessionStorage.setItem(RETURN_PATH_KEY, path || "/"); } catch { /* private mode */ }
};
export const popReturnPath = (fallback = "/") => {
  try {
    const v = sessionStorage.getItem(RETURN_PATH_KEY);
    sessionStorage.removeItem(RETURN_PATH_KEY);
    return v || fallback;
  } catch { return fallback; }
};

export const authApi = {
  // Exchange a one-time Emergent OAuth session_id (received in the URL
  // fragment after Google sign-in) for our app's persistent session_token.
  // The backend sets the httpOnly cookie; we just need the user payload.
  exchange: async (sessionId) => {
    // 45 s — covers the backend's worst-case retry budget against the
    // Emergent OAuth provider (4 attempts × up to 15 s httpx timeout +
    // ~5.4 s of exponential backoffs). The earlier 20 s ceiling
    // truncated legitimate retries on slow upstream-provider days,
    // surfacing as "timeout of 20000ms exceeded" to users.
    const { data } = await axios.post(
      `${API}/auth/session`,
      { session_id: sessionId },
      { ...cfg, timeout: 45000 },
    );
    return data;
  },
  me: async () => {
    // 12 s — same-region hop to FastAPI behind ingress should complete
    // in <1 s; the explicit ceiling prevents the bootstrap spinner from
    // pinning the UI for minutes on a transient network blip (axios
    // defaults to no timeout, which let earlier sessions stall for 2–3
    // minutes before falling through to the sign-in gate).
    const { data } = await axios.get(`${API}/auth/me`, { ...cfg, timeout: 12000 });
    return data;
  },
  logout: async () => {
    await axios.post(`${API}/auth/logout`, null, cfg);
  },
  // ---- Local auth (email/password + magic link + password reset) ----
  register: async ({ name, email, password }) => {
    const { data } = await axios.post(`${API}/auth/register`, { name, email, password }, cfg);
    return data;
  },
  login: async ({ email, password }) => {
    const { data } = await axios.post(`${API}/auth/login`, { email, password }, cfg);
    return data;
  },
  requestMagicLink: async (email) => {
    const { data } = await axios.post(`${API}/auth/magic-link/request`, { email }, cfg);
    return data;
  },
  consumeMagicLink: async (token) => {
    const { data } = await axios.post(`${API}/auth/magic-link/consume`, { token }, cfg);
    return data;
  },
  forgotPassword: async (email) => {
    const { data } = await axios.post(`${API}/auth/password/forgot`, { email }, cfg);
    return data;
  },
  resetPassword: async ({ token, new_password }) => {
    const { data } = await axios.post(`${API}/auth/password/reset`, { token, new_password }, cfg);
    return data;
  },
  updateProfile: async (patch) => {
    const { data } = await axios.put(`${API}/me/profile`, patch, cfg);
    return data;
  },
};

// Build the Emergent OAuth redirect URL. The redirect target MUST be derived
// from `window.location.origin` so the user comes back to the SAME host they
// signed in from (preview vs production domains differ).
// REMINDER: DO NOT HARDCODE THE URL, OR ADD ANY FALLBACKS OR REDIRECT URLS, THIS BREAKS THE AUTH
export const buildLoginUrl = (returnPath = "/") => {
  // Persist returnPath so AuthCallback can route us back to where we started
  // (not always /) after the external OAuth round-trip.
  setReturnPath(returnPath);
  // The OAuth provider only knows our origin — the path it sees is also the
  // path it appends "#session_id=…" to, so we use origin + returnPath as the
  // redirect target so AppRouter's hash-detect runs on the same page.
  const redirectUrl = window.location.origin + returnPath;
  return `https://auth.emergentagent.com/?redirect=${encodeURIComponent(redirectUrl)}`;
};

export const startLogin = (returnPath = "/") => {
  window.location.href = buildLoginUrl(returnPath);
};

// Private library helpers — only callable when authenticated.
export const meApi = {
  designs: async () => {
    const { data } = await axios.get(`${API}/me/designs`, cfg);
    return data;
  },
  components: async () => {
    const { data } = await axios.get(`${API}/me/components`, cfg);
    return data;
  },
  contributorStatus: async () => {
    const { data } = await axios.get(`${API}/me/contributor-status`, cfg);
    return data;
  },
};
