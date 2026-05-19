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

export const authApi = {
  // Exchange a one-time Emergent OAuth session_id (received in the URL
  // fragment after Google sign-in) for our app's persistent session_token.
  // The backend sets the httpOnly cookie; we just need the user payload.
  exchange: async (sessionId) => {
    const { data } = await axios.post(`${API}/auth/session`, { session_id: sessionId }, cfg);
    return data;
  },
  me: async () => {
    const { data } = await axios.get(`${API}/auth/me`, cfg);
    return data;
  },
  logout: async () => {
    await axios.post(`${API}/auth/logout`, null, cfg);
  },
};

// Build the Emergent OAuth redirect URL. The redirect target MUST be derived
// from `window.location.origin` so the user comes back to the SAME host they
// signed in from (preview vs production domains differ).
// REMINDER: DO NOT HARDCODE THE URL, OR ADD ANY FALLBACKS OR REDIRECT URLS, THIS BREAKS THE AUTH
export const buildLoginUrl = (returnPath = "/workspace") => {
  const redirectUrl = window.location.origin + returnPath;
  return `https://auth.emergentagent.com/?redirect=${encodeURIComponent(redirectUrl)}`;
};

export const startLogin = (returnPath = "/workspace") => {
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
};
