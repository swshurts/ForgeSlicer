// iter-105.11 — LithoForge → ForgeSlicer inbox watcher.
//
// Mounts inside the workspace. Polls /api/litho/inbox at sign-in and
// every 60s thereafter. Each pending item triggers a Sonner toast
// with a one-click "Open" action that:
//   1. Streams the STL/3MF down from the backend.
//   2. Pipes it through the existing import pipeline (importAnyMeshFile
//      / import3MFFileMulti) — same code path as drag-and-drop, so it
//      slots into the build plate exactly the same way.
//   3. The store auto-selects the new mesh, which causes the Inspector
//      to switch to it automatically (no extra wiring needed).
//   4. Deletes the inbox record so reloads don't re-import.

import React, { useEffect, useRef, useCallback, useState } from "react";
import { toast } from "sonner";
import { Inbox, Sparkles } from "lucide-react";
import { useScene } from "../lib/store";
import {
  listLithoInbox,
  fetchLithoInboxFile,
  deleteLithoInboxItem,
} from "../lib/lithoInboxApi";
import {
  importAnyMeshFile,
  import3MFFileMulti,
  countMeshTriangles,
  HEAVY_MESH_TRIANGLE_THRESHOLD,
} from "../lib/exporters";

// Poll cadence. 60s strikes a balance: a user who left ForgeSlicer
// open all day still sees new lithophanes within a minute, and we're
// not hammering the API.
const POLL_MS = 60 * 1000;

// Friendly labels for the source_shape field LithoForge sends so
// the toast reads naturally ("New lithophane on a cylinder" rather
// than "litho_cylinder").
const SHAPE_LABEL = {
  flat: "flat panel",
  curved: "curved panel",
  cylinder: "cylinder",
  disc: "disc",
  lightbox_rect: "rectangular lightbox",
  lightbox_circle: "circular lightbox",
};

export default function LithoInboxWatcher() {
  const addImportedMesh = useScene((s) => s.addImportedMesh);
  const setPristineImport = useScene((s) => s.setPristineImport);
  // Track which inbox items we've already shown a toast for so the
  // 60s poll doesn't spawn a fresh toast every cycle for the same
  // file. We use a ref (not state) because setState triggers a
  // re-render of every component subscribed to this store, and we
  // don't actually render anything visible from this watcher.
  const dismissedIds = useRef(new Set());
  const inflightImports = useRef(new Set());
  const [pollTick, setPollTick] = useState(0); // forces useCallback rebind on retry

  const handleImport = useCallback(async (inbox) => {
    if (inflightImports.current.has(inbox.inbox_id)) return;
    inflightImports.current.add(inbox.inbox_id);
    const shapeLabel = SHAPE_LABEL[inbox.source_shape] || inbox.source_shape;
    const toastId = toast.loading(`Importing "${inbox.name}" (${shapeLabel})…`);
    try {
      const file = await fetchLithoInboxFile(inbox);
      let importedCount = 0;
      let totalTriangles = 0;
      if (inbox.format === "3mf") {
        const buf = await file.arrayBuffer();
        setPristineImport(new Uint8Array(buf), file.name);
        const multi = await import3MFFileMulti(file);
        multi.objects.forEach((o) => {
          addImportedMesh(o.name, o.vertices, o.indices, o.originalBbox, {
            customColor: o.displaycolor || undefined,
            materialName: o.materialName || undefined,
          });
          totalTriangles += countMeshTriangles(o.vertices, o.indices);
          importedCount++;
        });
      } else {
        const mesh = await importAnyMeshFile(file);
        addImportedMesh(mesh.name, mesh.vertices, mesh.indices, mesh.originalBbox);
        totalTriangles += countMeshTriangles(mesh.vertices, mesh.indices);
        importedCount = 1;
      }
      await deleteLithoInboxItem(inbox.inbox_id).catch(() => { /* best-effort */ });
      toast.success(
        `Imported "${inbox.name}" from LithoForge — selected & ready to slice.`,
        { id: toastId, duration: 5000 },
      );
      if (totalTriangles > HEAVY_MESH_TRIANGLE_THRESHOLD) {
        toast.warning("Heavy lithophane", {
          description: `${totalTriangles.toLocaleString()} triangles — slicing will take a moment. Consider Mesh Detail = Standard in LithoForge for faster iteration.`,
          duration: 10000,
        });
      }
      // Mark dismissed so the next poll cycle doesn't re-toast this
      // one (we deleted server-side too, but a race between the
      // delete and the next list could otherwise dupe the toast).
      dismissedIds.current.add(inbox.inbox_id);
    } catch (e) {
      // eslint-disable-next-line no-console
      console.error("Litho import failed:", e);
      toast.error(`Couldn't import "${inbox.name}": ${e.message || e}`, { id: toastId });
    } finally {
      inflightImports.current.delete(inbox.inbox_id);
    }
  }, [addImportedMesh, setPristineImport]);

  const handlePoll = useCallback(async () => {
    const items = await listLithoInbox();
    if (!Array.isArray(items) || items.length === 0) return;
    for (const item of items) {
      if (dismissedIds.current.has(item.inbox_id)) continue;
      dismissedIds.current.add(item.inbox_id);
      const shapeLabel = SHAPE_LABEL[item.source_shape] || item.source_shape;
      toast.message(
        <div className="flex items-center gap-2">
          <Sparkles size={14} className="text-amber-400 flex-shrink-0" />
          <div className="flex-1 min-w-0">
            <div className="text-[13px] font-semibold text-slate-100 truncate">
              New lithophane from LithoForge
            </div>
            <div className="text-[11px] text-slate-400 truncate">
              {item.name} · {shapeLabel} · {Math.round(item.file_size / 1024)} KB
            </div>
          </div>
        </div>,
        {
          id: `litho-inbox-${item.inbox_id}`,
          duration: 12000,
          icon: <Inbox size={16} className="text-amber-400" />,
          action: {
            label: "Open",
            onClick: () => handleImport(item),
          },
          cancel: {
            label: "Later",
            onClick: () => { /* dismiss; we already marked it dismissed-for-this-session */ },
          },
        },
      );
    }
  }, [handleImport]);

  // Initial poll on mount + every POLL_MS thereafter.
  useEffect(() => {
    let alive = true;
    let timer = null;
    const tick = async () => {
      if (!alive) return;
      await handlePoll();
      if (!alive) return;
      timer = setTimeout(tick, POLL_MS);
    };
    // Slight delay on first poll so the workspace finishes its own
    // init burst (auth checks, project load) before we add network
    // noise.
    timer = setTimeout(tick, 1500);
    return () => {
      alive = false;
      if (timer) clearTimeout(timer);
    };
  }, [handlePoll, pollTick]);

  // Listen for an "open all inbox" event so a future LithoForge-side
  // postMessage handshake can force-trigger a poll without waiting for
  // the 60s cadence.
  useEffect(() => {
    const onForce = () => setPollTick((t) => t + 1);
    window.addEventListener("forgeslicer:litho-inbox-refresh", onForce);
    return () => window.removeEventListener("forgeslicer:litho-inbox-refresh", onForce);
  }, []);

  // No visible DOM — all UX flows through Sonner toasts.
  return null;
}
