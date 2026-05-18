// ForgeSlicer auto-save controller.
//
// Goal: persist the editable project JSON (not a baked STL) to the user's
// local disk so a crash, refresh, or "I-changed-my-mind" never costs work.
//
// Two strategies, picked at runtime:
//
//   1. File System Access API (showSaveFilePicker / writable streams) —
//      Chromium-based browsers. The user picks ONE file location the first
//      time; subsequent saves write to the same path silently (no download
//      bar, no filename junk).
//
//   2. Fallback: classic anchor-download. Browser writes to ~/Downloads
//      with browser-decided filename suffixes ("(1)", "(2)" etc).
//
// User can opt-in / opt-out via the right-panel "Auto-save project" toggle.
// Auto-save is debounced (~30s after the last edit) to avoid spamming the
// disk on every keystroke.

import { saveProjectJSON } from "./exporters";

const SUPPORTS_FS_ACCESS = typeof window !== "undefined" && !!window.showSaveFilePicker;

let activeHandle = null;          // FileSystemFileHandle (Chromium only)
let activeFilename = null;        // string fallback
let lastSavedAt = 0;
let writingNow = false;

export function isAutoSaveSupported() {
  return true; // fallback always works
}

export function isFileSystemAccessSupported() {
  return SUPPORTS_FS_ACCESS;
}

export function getActiveAutoSaveLabel() {
  if (activeHandle) return activeHandle.name || "auto-save file";
  if (activeFilename) return activeFilename;
  return null;
}

// Ask the user to pick the auto-save destination. Returns true on success.
export async function pickAutoSaveDestination(projectName) {
  if (SUPPORTS_FS_ACCESS) {
    try {
      const handle = await window.showSaveFilePicker({
        suggestedName: `${(projectName || "project").replace(/[^a-z0-9-_]/gi, "_")}.forge.json`,
        types: [{
          description: "ForgeSlicer project",
          accept: { "application/json": [".forge.json", ".json"] },
        }],
      });
      activeHandle = handle;
      activeFilename = handle.name;
      lastSavedAt = 0; // force next save
      return true;
    } catch (e) {
      // AbortError when user cancels the picker — that's fine, treat as no-op.
      if (e?.name !== "AbortError") {
        // eslint-disable-next-line no-console
        console.warn("FS Access picker failed, falling back:", e);
      }
      return false;
    }
  }
  // Fallback: just remember the desired filename; saves dump to Downloads.
  activeFilename = `${(projectName || "project").replace(/[^a-z0-9-_]/gi, "_")}.forge.json`;
  return true;
}

export function clearAutoSaveDestination() {
  activeHandle = null;
  activeFilename = null;
}

export async function performAutoSave(projectState) {
  if (writingNow) return;
  writingNow = true;
  try {
    if (activeHandle) {
      // Chromium path — write to the same file silently.
      const writable = await activeHandle.createWritable();
      await writable.write(JSON.stringify(projectState, null, 2));
      await writable.close();
    } else if (activeFilename) {
      // Fallback: dump to Downloads. Note: most browsers will append
      // " (1)", " (2)" suffixes when the same name reappears. There's no
      // way around that without FS Access API.
      saveProjectJSON(projectState, activeFilename);
    } else {
      return;
    }
    lastSavedAt = Date.now();
  } catch (e) {
    // If the handle was invalidated (rare — happens when the user deleted
    // the file or the disk became read-only) clear it so the UI prompts
    // the user to pick a new destination.
    if (e?.name === "InvalidStateError" || e?.name === "NotFoundError") {
      activeHandle = null;
    }
    // eslint-disable-next-line no-console
    console.warn("Auto-save failed:", e);
    throw e;
  } finally {
    writingNow = false;
  }
}

export function getLastSavedAt() {
  return lastSavedAt;
}
