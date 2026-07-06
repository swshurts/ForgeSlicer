// Lithophane Studio API client — merged LithoForge backend.
//
// Endpoints under /api/litho/studio/*. All calls go through the shared
// API resolver so cookies attach on the production domain (same-origin).

import { API } from "./api";

async function jget(path) {
  const res = await fetch(`${API}${path}`, { credentials: "include" });
  if (!res.ok) throw new Error((await res.text()) || `${res.status}`);
  return res.json();
}

async function jpost(path, body) {
  const res = await fetch(`${API}${path}`, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const t = await res.text();
    throw new Error(t || `${res.status}`);
  }
  return res.json();
}

export const getDefaultFilaments = async () => {
  const d = await jget("/litho/studio/filaments/default");
  return d.filaments || [];
};

export const getFilamentLibrary = async () => {
  const d = await jget("/litho/studio/filaments/library");
  return d.filaments || [];
};

export const getPrinters = async () => {
  const d = await jget("/litho/studio/printers");
  return d.printers || [];
};

export const uploadImageAsFile = async (file) => {
  // Encode to base64 (data URL) and POST to /upload.
  const b64 = await new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result);
    r.onerror = reject;
    r.readAsDataURL(file);
  });
  return jpost("/litho/studio/upload", { image_base64: b64, filename: file.name });
};

export const suggestPalette = async (image_id, palette_size, vibrancy) =>
  (await jpost("/litho/studio/palette/suggest", { image_id, palette_size, vibrancy })).filaments;

export const optimizeLitho = async (payload) => jpost("/litho/studio/optimize", payload);

export const downloadLithoFile = async (jobId, kind, opts = {}) => {
  const qs = new URLSearchParams();
  if (opts.printer) qs.set("printer", opts.printer);
  if (opts.base_layers) qs.set("base_layers", String(opts.base_layers));
  const q = qs.toString();
  const url = `${API}/litho/studio/export/${jobId}/${kind}${q ? `?${q}` : ""}`;
  const res = await fetch(url, { credentials: "include" });
  if (!res.ok) throw new Error(`Download failed: ${res.status}`);
  return res.blob();
};
