import axios from "axios";

const BACKEND_URL = process.env.REACT_APP_BACKEND_URL;
export const API = `${BACKEND_URL}/api`;

export const galleryApi = {
  list: async () => {
    const { data } = await axios.get(`${API}/gallery`);
    return data;
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
    } catch (_) { /* non-fatal */ }
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
    const { data } = await axios.get(`${API}/components`, { params });
    return data;
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

