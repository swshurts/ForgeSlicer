// ForgeSlicer voice-command executor.
//
// The browser captures speech via Web Speech API (SpeechRecognition). The
// transcript is POSTed to POST /api/voice/command which uses GPT-5.2 to
// translate it into a structured JSON command. This module executes that
// command against the Zustand scene store.

import axios from "axios";
import { API } from "./api";
import { useScene } from "./store";
import { combineTwoAsync, exportSTLBytesAsync, export3MFBytesAsync } from "./workerClient";
import { downloadBlob, saveProjectJSON } from "./exporters";

// Look up the SpeechRecognition constructor — vendor-prefixed on some browsers.
export function getSpeechRecognition() {
  if (typeof window === "undefined") return null;
  return window.SpeechRecognition || window.webkitSpeechRecognition || null;
}

export function isVoiceSupported() {
  return !!getSpeechRecognition();
}

// Parse a transcript through the backend LLM into a structured command.
export async function parseTranscript(transcript) {
  const { data } = await axios.post(`${API}/voice/command`, { transcript });
  return data; // { action, raw, transcript }
}

// Map the structured command onto store actions. Returns a human-readable
// description of what happened (used for the on-screen banner).
export async function executeCommand(cmd) {
  if (!cmd || !cmd.action) return "Unknown command";
  const raw = cmd.raw || {};
  const s = useScene.getState();

  switch (raw.action) {
    case "add": {
      const type = raw.type;
      const modifier = raw.modifier === "negative" ? "negative" : "positive";
      const id = s.addPrimitive(type, modifier);
      if (raw.dims && Object.keys(raw.dims).length) {
        s.updateDims(id, raw.dims);
      }
      return `Added ${modifier} ${type}${raw.dims ? ` (${Object.entries(raw.dims).map(([k,v]) => `${k}=${v}`).join(", ")})` : ""}`;
    }
    case "translate": {
      const d = raw.delta || {};
      const ids = s.selectedIds.length ? s.selectedIds : (s.selectedId ? [s.selectedId] : []);
      if (ids.length === 0) return "Nothing selected to translate";
      s.translateSelected([d.x || 0, d.y || 0, d.z || 0]);
      return `Moved ${ids.length} part${ids.length > 1 ? "s" : ""} (${d.x || 0}, ${d.y || 0}, ${d.z || 0}) mm`;
    }
    case "rotate": {
      const d = raw.delta || {};
      const ids = s.selectedIds.length ? s.selectedIds : (s.selectedId ? [s.selectedId] : []);
      if (ids.length === 0) return "Nothing selected to rotate";
      s.rotateSelected([d.x || 0, d.y || 0, d.z || 0]);
      return `Rotated ${ids.length} part${ids.length > 1 ? "s" : ""} (${d.x || 0}°, ${d.y || 0}°, ${d.z || 0}°)`;
    }
    case "scale": {
      const f = raw.factor || {};
      const id = s.selectedId;
      if (!id) return "Nothing selected to scale";
      const obj = s.objects.find((o) => o.id === id);
      if (!obj) return "Selection lost";
      const ns = [
        obj.scale[0] * (f.x ?? 1),
        obj.scale[1] * (f.y ?? 1),
        obj.scale[2] * (f.z ?? 1),
      ];
      s.setTransformWithHistory(id, "scale", ns);
      return `Scaled by (${f.x ?? 1}, ${f.y ?? 1}, ${f.z ?? 1})`;
    }
    case "resize": {
      const id = s.selectedId;
      if (!id) return "Nothing selected to resize";
      const dims = raw.dims || {};
      if (Object.keys(dims).length === 0) return "No dimensions provided";
      s.updateDims(id, dims);
      return `Resized to ${Object.entries(dims).map(([k,v]) => `${k}=${v}`).join(", ")}`;
    }
    case "position": {
      const p = raw.pos || {};
      const id = s.selectedId;
      if (!id) return "Nothing selected to position";
      const obj = s.objects.find((o) => o.id === id);
      if (!obj) return "Selection lost";
      const np = [
        p.x ?? obj.position[0],
        p.y ?? obj.position[1],
        p.z ?? obj.position[2],
      ];
      s.setTransformWithHistory(id, "position", np);
      return `Positioned at (${np[0]}, ${np[1]}, ${np[2]}) mm`;
    }
    case "drop": {
      const ids = s.selectedIds.length ? s.selectedIds : (s.selectedId ? [s.selectedId] : []);
      ids.forEach((id) => s.dropToBed(id, false));
      return `Dropped ${ids.length} part${ids.length > 1 ? "s" : ""} to bed`;
    }
    case "delete": {
      const n = s.selectedIds.length || (s.selectedId ? 1 : 0);
      s.removeSelected();
      return `Deleted ${n} part${n === 1 ? "" : "s"}`;
    }
    case "duplicate": {
      s.duplicateSelected({ mirrorAxis: raw.mirror || null });
      return raw.mirror ? `Duplicated + mirrored on ${raw.mirror.toUpperCase()}` : "Duplicated selection";
    }
    case "group": {
      s.groupSelected("Assembly");
      return "Grouped selection";
    }
    case "ungroup": {
      s.ungroupSelected();
      return "Ungrouped selection";
    }
    case "select_all": {
      const ids = s.objects.map((o) => o.id);
      useScene.setState({ selectedIds: ids, selectedId: ids[ids.length - 1] || null });
      return `Selected all ${ids.length} parts`;
    }
    case "clear_selection": {
      s.clearSelection();
      return "Cleared selection";
    }
    case "undo": { s.undo(); return "Undo"; }
    case "redo": { s.redo(); return "Redo"; }
    case "boolean": {
      const objs = s.objects;
      if (objs.length < 2) return "Boolean needs at least 2 objects";
      const a = s.selectedId ? objs.find((o) => o.id === s.selectedId) : objs[objs.length - 2];
      const b = objs[objs.length - 1] === a ? objs[objs.length - 2] : objs[objs.length - 1];
      const merged = await combineTwoAsync(a, b, raw.op || "subtract");
      s.removeObject(a.id);
      s.removeObject(b.id);
      s.addRawObject({
        name: `${a.name} ${raw.op === "union" ? "∪" : raw.op === "intersect" ? "∩" : "∖"} ${b.name}`,
        type: "imported",
        modifier: "positive",
        visible: true, locked: false,
        position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1], dims: {},
        geometry: merged,
      });
      return `Boolean ${raw.op || "subtract"} complete`;
    }
    case "mode": {
      const m = raw.mode;
      if (["translate", "rotate", "scale"].includes(m)) {
        s.setTransformMode(m);
        return `Mode: ${m}`;
      }
      return `Unknown mode "${m}"`;
    }
    case "export": {
      const fmt = (raw.format || "stl").toLowerCase();
      const objs = s.objects;
      const safe = (s.projectName || "model").replace(/[^a-z0-9-_]/gi, "_");
      if (fmt === "stl") {
        const { bytes } = await exportSTLBytesAsync(objs);
        downloadBlob(new Blob([bytes], { type: "model/stl" }), `${safe}.stl`);
      } else if (fmt === "3mf") {
        const { bytes } = await export3MFBytesAsync(objs);
        downloadBlob(new Blob([bytes], { type: "model/3mf" }), `${safe}.3mf`);
      } else if (fmt === "project") {
        saveProjectJSON(s.serialize(), `${safe}.forge.json`);
      } else {
        return `Export "${fmt}" not yet supported via voice`;
      }
      return `Exporting ${fmt.toUpperCase()}`;
    }
    case "open": {
      // Dialog opening is handled by the UI layer; we just emit an event.
      window.dispatchEvent(new CustomEvent("forgeslicer:open-dialog", { detail: { name: raw.dialog } }));
      return `Opening ${raw.dialog}`;
    }
    case "unknown":
    default:
      return `Could not understand: "${cmd.transcript || ""}"`;
  }
}
