// In-memory hand-off for files picked on the Landing page (or received
// from a sister app via postMessage handoff) and imported when the
// Workspace mounts.
//
// We keep the actual File object (not just bytes) in module scope so we
// don't have to serialize/deserialize through storage.
//
// Iter-92 — extended the value shape to carry optional source metadata
// (`sourceLabel`, `sourceUrl`) so the workspace can show an "Imported
// from LithoForge · filename.stl" attribution chip that links back to
// the originating project. The legacy `setPendingImport(file)` form is
// preserved — callers that pass just a File get null metadata.
//
// `consumed` makes takePendingImport idempotent: it returns the payload
// once, then null on every subsequent call (important for React
// StrictMode, which double-mounts effects in development).

let pendingFile = null;
let pendingMeta = null; // { sourceLabel, sourceUrl } | null
let consumed = false;

export function setPendingImport(file, meta = null) {
  pendingFile = file;
  pendingMeta = meta && typeof meta === "object" ? meta : null;
  consumed = false;
}

export function takePendingImport() {
  if (consumed) return null;
  consumed = true;
  if (!pendingFile) return null;
  // Backwards-compat: callers can still treat the return value as a
  // File via the `.name` / `.arrayBuffer()` properties, but we now
  // surface metadata on the same envelope for callers that want it.
  return { file: pendingFile, meta: pendingMeta };
}

export function hasPendingImport() {
  return !consumed && pendingFile !== null;
}
