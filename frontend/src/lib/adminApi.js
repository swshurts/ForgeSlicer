import axios from "axios";
import { API } from "./api";

// Admin API surface — every method requires the caller to be authed as
// admin (or super-admin where noted). The frontend AdminPage gates on
// /admin/me before showing the UI, but the backend re-checks on every
// call so a tampered client can't bypass.
const cfg = { withCredentials: true };

export const adminApi = {
  me: async () => {
    const { data } = await axios.get(`${API}/admin/me`, cfg);
    return data;
  },
  listUsers: async ({ q, limit = 100 } = {}) => {
    const params = { limit };
    if (q) params.q = q;
    const { data } = await axios.get(`${API}/admin/users`, { ...cfg, params });
    return data;
  },
  analytics: async () => {
    const { data } = await axios.get(`${API}/admin/analytics`, cfg);
    return data;
  },
  audit: async (limit = 100) => {
    const { data } = await axios.get(`${API}/admin/audit`, { ...cfg, params: { limit } });
    return data;
  },
  setAiQuota: async (user_id, quota) => {
    const { data } = await axios.post(`${API}/admin/users/ai-quota`, { user_id, quota }, cfg);
    return data;
  },
  setContributor: async (user_id, contributor_lifetime) => {
    const { data } = await axios.post(`${API}/admin/users/contributor`, { user_id, contributor_lifetime }, cfg);
    return data;
  },
  setBan: async (user_id, banned, reason) => {
    const { data } = await axios.post(`${API}/admin/users/ban`, { user_id, banned, reason }, cfg);
    return data;
  },
  promoteAdmin: async (user_id, is_admin) => {
    // Super-admin only — UI hides the button for non-super admins.
    const { data } = await axios.post(`${API}/admin/users/promote-admin`, { user_id, is_admin }, cfg);
    return data;
  },
  forcePasswordReset: async (user_id) => {
    const { data } = await axios.post(`${API}/admin/users/force-password-reset`, { user_id, is_admin: false }, cfg);
    return data;
  },
  removeContent: async (item_id, item_type, reason) => {
    const { data } = await axios.post(`${API}/admin/content/remove`, { item_id, item_type, reason }, cfg);
    return data;
  },
  // Iter-85 — OrcaSlicer upstream profile sync.
  orcaUpstream: {
    sync: async () => {
      const { data } = await axios.post(`${API}/admin/orca-upstream/sync`, null, cfg);
      return data;
    },
    runs: async (limit = 20) => {
      const { data } = await axios.get(`${API}/admin/orca-upstream/runs`, { ...cfg, params: { limit } });
      return data;
    },
    deltas: async (status = "pending", limit = 200) => {
      const { data } = await axios.get(`${API}/admin/orca-upstream/deltas`, { ...cfg, params: { status, limit } });
      return data;
    },
    deltaDiff: async (deltaId) => {
      const { data } = await axios.get(`${API}/admin/orca-upstream/deltas/${encodeURIComponent(deltaId)}/diff`, cfg);
      return data;
    },
    mergeDelta: async (deltaId) => {
      const { data } = await axios.post(`${API}/admin/orca-upstream/deltas/${encodeURIComponent(deltaId)}/merge`, null, cfg);
      return data;
    },
    dismissDelta: async (deltaId) => {
      const { data } = await axios.post(`${API}/admin/orca-upstream/deltas/${encodeURIComponent(deltaId)}/dismiss`, null, cfg);
      return data;
    },
    // Iter-88: admin digest. The scheduler fires the digest at most
    // once a week; the "send now" route bypasses the cooldown for
    // QA / copy-tweaking flows.
    digestState: async () => {
      const { data } = await axios.get(`${API}/admin/orca-upstream/digest/state`, cfg);
      return data;
    },
    sendDigestNow: async () => {
      const { data } = await axios.post(`${API}/admin/orca-upstream/digest/send-now`, null, cfg);
      return data;
    },
  },
};
