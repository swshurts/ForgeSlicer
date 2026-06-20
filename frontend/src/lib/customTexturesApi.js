// iter-105.5 — Custom Textures API client.
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

const API = process.env.REACT_APP_BACKEND_URL;

async function jfetch(path, init = {}) {
  const res = await fetch(`${API}${path}`, {
    credentials: "include",
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(init.headers || {}),
    },
  });
  if (!res.ok) {
    let detail = "";
    try { detail = (await res.json()).detail || ""; } catch (_) {}
    throw new Error(`${res.status} ${res.statusText}${detail ? ` — ${detail}` : ""}`);
  }
  return res.json();
}

export async function listCustomTextures() {
  return jfetch("/api/textures");
}

export async function uploadCustomTexture(payload) {
  // payload: {name, image_b64, thumb_b64, tile_size_mm, default_height_mm,
  //           default_invert, default_fit}
  return jfetch("/api/textures", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export async function deleteCustomTexture(id) {
  return jfetch(`/api/textures/${id}`, { method: "DELETE" });
}
