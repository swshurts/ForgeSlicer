// In-memory hand-off for files picked on the Landing page and imported
// when the Workspace mounts. We keep the actual File object (not just bytes)
// in module scope so we don't have to serialize/deserialize through storage.
let pendingFile = null;

export function setPendingImport(file) {
  pendingFile = file;
}

export function takePendingImport() {
  const f = pendingFile;
  pendingFile = null;
  return f;
}

export function hasPendingImport() {
  return pendingFile !== null;
}
