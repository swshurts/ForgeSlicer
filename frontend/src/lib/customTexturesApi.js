// iter-105.7 — Custom Textures API client.
//
// User-uploaded grayscale image textures are persisted server-side so
// they survive page reloads and follow the user across sessions.
// Storage shape per row:
//
//   {
//     id: "tex_<uuid>",
//     user_id,
//     name,
//     image_b64: "data:image/png;base64,…",  // PNG, ≤ 256x256 grayscale
//     thumb_b64,                              // 64x64 preview
//     tile_size_mm: 12,
//     default_height_mm: 1.2,
//     default_invert: false,
//     default_fit: "tile" | "stretch",
//     created_at: ISO timestamp
//   }
//
// IMPORTANT — auth: we MUST use the same `API` resolver as
// /app/frontend/src/lib/api.js. The env var REACT_APP_BACKEND_URL is
// baked at build time and on the production custom domain
// (forgeslicer.com) it still points at the original `*.emergent.host`
// URL. Hitting that URL directly is a cross-origin request, the
// httpOnly `session_token` cookie set on the custom domain is NOT
// included, and the backend rejects every request with 401. The
// shared resolver flips to `window.location.origin` whenever the
// page's host differs from the env var, keeping cookies first-party.

import { API } from "./api";

class NotAuthenticatedError extends Error {
  constructor() {
    super("Sign in to use custom textures.");
    this.name = "NotAuthenticatedError";
    this.code = "not_authenticated";
  }
}
export { NotAuthenticatedError };

async function jfetch(path, init = {}) {
  const res = await fetch(`${API}${path}`, {
    credentials: "include",
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(init.headers || {}),
    },
  });
  if (res.status === 401) throw new NotAuthenticatedError();
  if (!res.ok) {
    let detail = "";
    try { detail = (await res.json()).detail || ""; } catch (_e) { /* not JSON */ }
    throw new Error(`${res.status} ${res.statusText}${detail ? ` — ${detail}` : ""}`);
  }
  return res.json();
}

export async function listCustomTextures() {
  // Soft-handle 401 — callers that just want to populate the My Textures
  // grid should see an empty list (and the dialog will surface a
  // "sign in to upload" hint), not a thrown error that breaks the rest
  // of the dialog state.
  try {
    return await jfetch("/textures");
  } catch (e) {
    if (e instanceof NotAuthenticatedError) return { __unauthenticated: true, items: [] };
    throw e;
  }
}

export async function uploadCustomTexture(payload) {
  // payload: {name, image_b64, thumb_b64, tile_size_mm, default_height_mm,
  //           default_invert, default_fit}
  return jfetch("/textures", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export async function deleteCustomTexture(id) {
  return jfetch(`/textures/${id}`, { method: "DELETE" });
}
