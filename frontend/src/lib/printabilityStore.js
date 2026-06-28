// Zustand store for the Printability Checks feature. Holds the
// current findings list, the set of silenced finding IDs (session-
// scoped, persisted in sessionStorage so a panel close/reopen keeps
// silences), and the currently-hovered finding for the viewport
// overlay.
//
// iter-109 — `recheckAsync` runs the sync passes immediately, then
// kicks off the heavy thin-wall scan (per object) and merges its
// findings in when it settles. `isScanning` drives a spinner in the
// panel header so the user knows we're still working.

import { create } from "zustand";
import { runAllChecks, runAsyncChecks, sortBySeverity } from "./printabilityChecks";

const SILENCED_KEY = "forgeslicer.printability.silenced";
const loadSilenced = () => {
    try {
        const raw = sessionStorage.getItem(SILENCED_KEY);
        return raw ? new Set(JSON.parse(raw)) : new Set();
    } catch { return new Set(); }
};
const saveSilenced = (s) => {
    try { sessionStorage.setItem(SILENCED_KEY, JSON.stringify([...s])); } catch { /* noop */ }
};

// Monotonically-increasing scan id — guards against an in-flight
// `runAsyncChecks` clobbering a newer recheck's results when the
// user mutates the scene mid-scan.
let _scanSeq = 0;

export const usePrintability = create((set, get) => ({
    findings: [],            // visible findings (silenced ones already filtered out)
    silencedIds: loadSilenced(),
    hoveredFindingId: null,
    panelOpen: false,
    isScanning: false,

    setPanelOpen: (open) => set({ panelOpen: !!open }),
    setHovered: (id) => set({ hoveredFindingId: id }),

    /** Sync pass only — fast (< 50 ms typical), runs on every scene
     *  mutation if a caller wants instant feedback. */
    recheck: (scene) => {
        const raw = runAllChecks(scene);
        const silenced = get().silencedIds;
        const visible = sortBySeverity(raw.filter((f) => !silenced.has(f.id)));
        set({ findings: visible });
    },

    /** Sync + async pass — used by the toolbar `CHECK` button and the
     *  OrcaSlicer pre-flight gate. Runs the sync pass immediately so
     *  the panel paints right away, then folds in the thin-wall
     *  findings when the worker / BVH scan settles. Returns once
     *  everything is merged. */
    recheckAsync: async (scene) => {
        const myId = ++_scanSeq;
        const sync = runAllChecks(scene);
        const silenced = get().silencedIds;
        const syncVisible = sortBySeverity(sync.filter((f) => !silenced.has(f.id)));
        set({ findings: syncVisible, isScanning: true });

        try {
            const async = await runAsyncChecks(scene);
            // Bail if a newer recheck started while we were scanning.
            if (myId !== _scanSeq) return;
            const merged = sortBySeverity(
                [...sync, ...async].filter((f) => !get().silencedIds.has(f.id)),
            );
            set({ findings: merged });
        } finally {
            if (myId === _scanSeq) set({ isScanning: false });
        }
    },

    silence: (findingId) => {
        const next = new Set(get().silencedIds);
        next.add(findingId);
        saveSilenced(next);
        set({
            silencedIds: next,
            findings: get().findings.filter((f) => f.id !== findingId),
            hoveredFindingId: null,
        });
    },
}));
