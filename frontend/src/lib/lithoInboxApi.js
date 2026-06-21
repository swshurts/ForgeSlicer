// iter-105.11 — LithoForge → ForgeSlicer inbox API client.
//
// LithoForge.net POSTs finished STL/3MF lithophanes to our backend.
// The workspace polls /api/litho/inbox at sign-in (and every 60s
// thereafter) and shows a "New lithophane from LithoForge" toast.
// Clicking opens the file straight on the build plate.
//
// Like customTexturesApi, we MUST use the shared API resolver from
// ./api.js so we get same-origin requests on the custom production
// domain (forgeslicer.com) — env-baked URLs would force a
// cross-origin POST and lose the session cookie.

import { API } from "./api";
import { NotAuthenticatedError } from "./customTexturesApi";

async function jget(path) {
  const res = await fetch(`${API}${path}`, { credentials: "include" });
  if (res.status === 401) throw new NotAuthenticatedError();
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
  return res.json();
}

export async function listLithoInbox() {
  // Soft-handle 401 the same way custom textures do — an unauth'd
  // workspace shouldn't render a red error stack just because the
  // inbox poller fired.
  try {
    return await jget("/litho/inbox");
  } catch (e) {
    if (e instanceof NotAuthenticatedError) return [];
    // eslint-disable-next-line no-console
    console.warn("Litho inbox poll failed:", e);
    return [];
  }
}

/**
 * Download a queued lithophane as a File so the existing import
 * pipeline (importAnyMeshFile / import3MFFileMulti) can consume it
 * directly. Backend marks consumed=true as a side-effect so we
 * don't keep re-importing the same item if the user reloads.
 */
export async function fetchLithoInboxFile(inbox) {
  const res = await fetch(`${API}/litho/inbox/${inbox.inbox_id}/download`, {
    credentials: "include",
  });
  if (!res.ok) throw new Error(`Download failed: ${res.status} ${res.statusText}`);
  const blob = await res.blob();
  const filename = `${inbox.name}.${inbox.format}`;
  return new File([blob], filename, {
    type: inbox.format === "stl" ? "model/stl" : "model/3mf",
  });
}

export async function deleteLithoInboxItem(inboxId) {
  const res = await fetch(`${API}/litho/inbox/${inboxId}`, {
    method: "DELETE",
    credentials: "include",
  });
  if (!res.ok && res.status !== 404) {
    // 404 is fine — somebody already cleaned it up.
    throw new Error(`${res.status} ${res.statusText}`);
  }
}
