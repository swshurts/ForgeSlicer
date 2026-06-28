// Zustand store for the Printability Checks feature. Holds the
// current findings list, the set of silenced finding IDs (session-
// scoped, persisted in sessionStorage so a panel close/reopen keeps
// silences), and the currently-hovered finding for the viewport
// overlay.

import { create } from "zustand";
import { runAllChecks, sortBySeverity } from "./printabilityChecks";

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

export const usePrintability = create((set, get) => ({
    findings: [],            // visible findings (silenced ones already filtered out)
    silencedIds: loadSilenced(),
    hoveredFindingId: null,  // drives the viewport edge overlay
    panelOpen: false,

    setPanelOpen: (open) => set({ panelOpen: !!open }),
    setHovered: (id) => set({ hoveredFindingId: id }),

    /** Re-runs all checks against the live scene and stores the result.
     *  Cheap enough to call on every mutate (~20-50 ms for a typical
     *  scene); callers can debounce if they want. */
    recheck: (scene) => {
        const raw = runAllChecks(scene);
        const silenced = get().silencedIds;
        const visible = sortBySeverity(raw.filter((f) => !silenced.has(f.id)));
        set({ findings: visible });
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

    /** Count of "will-fail" findings — drives the toolbar badge + the
     *  ExportDialog / slicer gate. */
    get blockingCount() {
        return get().findings.filter((f) => f.severity === "will-fail").length;
    },
}));
