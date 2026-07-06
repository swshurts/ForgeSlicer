/**
 * Printability Report API client.
 *
 * Uploads a mesh (either an existing File or bytes we've built from the
 * current scene) to /api/printability/analyze and returns a structured
 * report the UI can render.
 */
import { API } from "./api";

export async function analyzePrintability(bytes, filename = "scene.stl", fileType = "stl") {
  const blob = bytes instanceof Blob ? bytes : new Blob([bytes], { type: "model/stl" });
  const fd = new FormData();
  fd.append("file", blob, filename);
  fd.append("file_type", fileType);
  const r = await fetch(`${API}/printability/analyze`, {
    method: "POST",
    credentials: "include",
    body: fd,
  });
  const body = await r.json().catch(() => ({}));
  if (!r.ok) {
    throw new Error(body.detail || `Analysis failed (${r.status})`);
  }
  return body;
}
