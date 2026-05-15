// In-memory hand-off for files picked on the Landing page and imported
// when the Workspace mounts. We keep the actual File object (not just bytes)
// in module scope so we don't have to serialize/deserialize through storage.
// `consumed` makes takePendingImport idempotent: it returns the File once,
// then null on every subsequent call (important for React StrictMode, which
// double-mounts effects in development).
let pendingFile = null;
let consumed = false;

export function setPendingImport(file) {
  pendingFile = file;
  consumed = false;
}

export function takePendingImport() {
  if (consumed) return null;
  consumed = true;
  return pendingFile;
}

export function hasPendingImport() {
  return !consumed && pendingFile !== null;
}
