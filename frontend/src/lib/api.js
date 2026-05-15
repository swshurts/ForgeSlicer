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
