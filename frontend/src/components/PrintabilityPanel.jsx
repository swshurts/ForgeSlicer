// Pre-flight Printability Checks panel — right-rail surface that lists
// the current scene's findings, each with a severity pill, plain-
// language headline, primary fix CTA, and a collapsible technical
// detail. iter-108.x ships Check #1 (non-manifold); the same panel
// will render Checks #2-#7 unchanged.

import React, { useEffect, useState } from "react";
import { ShieldCheck, ShieldAlert, X, Loader2, ChevronDown } from "lucide-react";
import { usePrintability } from "../lib/printabilityStore";
import { useScene } from "../lib/store";
import { runFix } from "../lib/printabilityFixes";

const SEV_STYLE = {
    "will-fail":   { pill: "bg-red-500/15 border-red-500/40 text-red-300", chip: "Will fail" },
    "likely-fail": { pill: "bg-amber-500/15 border-amber-500/40 text-amber-300", chip: "Likely to fail" },
    "quality":     { pill: "bg-yellow-500/15 border-yellow-500/40 text-yellow-300", chip: "Quality issue" },
    "ok":          { pill: "bg-emerald-500/15 border-emerald-500/40 text-emerald-300", chip: "All good" },
};

function FindingRow({ finding }) {
    const setHovered = usePrintability((s) => s.setHovered);
    const [expanded, setExpanded] = useState(false);
    const [busyFixId, setBusyFixId] = useState(null);
    const style = SEV_STYLE[finding.severity] || SEV_STYLE.quality;

    const onFix = async (fixId) => {
        setBusyFixId(fixId);
        try { await runFix(finding, fixId); } catch (_) { /* toast handled in runFix */ }
        finally { setBusyFixId(null); }
    };

    return (
        <div
            data-testid={`printability-finding-${finding.checkId}-${finding.affectedObjectIds?.[0] || "scene"}`}
            className="border-b border-slate-800 px-4 py-3 hover:bg-slate-900/40 transition-colors"
            onMouseEnter={() => setHovered(finding.id)}
            onMouseLeave={() => setHovered(null)}
        >
            <div className="flex items-start gap-2">
                <span className={`inline-flex items-center px-2 py-0.5 rounded-full border text-[10px] font-bold uppercase tracking-wider ${style.pill}`}>
                    {style.chip}
                </span>
                <div className="flex-1 min-w-0">
                    <p className="text-[13px] text-white font-semibold leading-snug">{finding.title}</p>
                    <p className="mt-0.5 text-[11px] text-slate-500">{finding.affectedObjectName}</p>
                </div>
            </div>
            <div className="mt-3 flex flex-wrap gap-2">
                {(finding.fixes || []).map((fix) => (
                    <button
                        key={fix.id}
                        data-testid={`printability-fix-${fix.id}-${finding.id}`}
                        disabled={busyFixId === fix.id}
                        onClick={() => onFix(fix.id)}
                        className={`h-8 px-3 inline-flex items-center gap-1.5 rounded text-[12px] font-semibold transition-colors ${
                            fix.primary
                                ? "bg-orange-500 hover:bg-orange-600 text-white"
                                : "bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700"
                        } disabled:opacity-50 disabled:cursor-wait`}
                    >
                        {busyFixId === fix.id && <Loader2 size={12} className="animate-spin" />}
                        {fix.label}
                    </button>
                ))}
            </div>
            <button
                data-testid={`printability-details-toggle-${finding.id}`}
                onClick={() => setExpanded((e) => !e)}
                className="mt-3 inline-flex items-center gap-1 text-[10px] text-slate-500 hover:text-slate-300"
            >
                <ChevronDown size={11} className={`transition-transform ${expanded ? "rotate-180" : ""}`} />
                {expanded ? "Hide details" : "Show details"}
            </button>
            {expanded && (
                <p className="mt-2 text-[11px] text-slate-400 font-mono leading-snug">
                    {finding.technicalDetail}
                </p>
            )}
        </div>
    );
}

export default function PrintabilityPanel() {
    const findings = usePrintability((s) => s.findings);
    const panelOpen = usePrintability((s) => s.panelOpen);
    const setPanelOpen = usePrintability((s) => s.setPanelOpen);
    const recheck = usePrintability((s) => s.recheck);
    const recheckAsync = usePrintability((s) => s.recheckAsync);
    const isScanning = usePrintability((s) => s.isScanning);
    const objects = useScene((s) => s.objects);
    const buildVolume = useScene((s) => s.buildVolume);

    // Re-run sync checks whenever the scene's object list changes shape
    // (add / remove / replace) or the build volume changes. Cheap
    // enough that we don't debounce for v1; revisit if the user
    // reports lag.
    useEffect(() => {
        recheck({ objects, buildVolume });
    }, [objects, buildVolume, recheck]);

    // Kick off the expensive async thin-wall scan once whenever the
    // panel is opened. The scan can take 200-800 ms on dense imported
    // meshes so we don't want to run it on every keystroke / drag.
    useEffect(() => {
        if (!panelOpen) return;
        recheckAsync({ objects, buildVolume });
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [panelOpen]);

    if (!panelOpen) return null;

    const blocking = findings.filter((f) => f.severity === "will-fail").length;

    return (
        <aside
            data-testid="printability-panel"
            className="fixed right-0 top-[56px] bottom-0 w-[360px] z-30 bg-slate-950/95 backdrop-blur border-l border-slate-800 flex flex-col shadow-2xl"
        >
            <header className="flex items-center justify-between px-4 py-3 border-b border-slate-800">
                <div className="flex items-center gap-2">
                    {blocking > 0 ? (
                        <ShieldAlert size={16} className="text-red-400" />
                    ) : (
                        <ShieldCheck size={16} className="text-emerald-400" />
                    )}
                    <h2 className="text-sm font-bold text-white">Printability check</h2>
                    {isScanning && (
                        <span
                            data-testid="printability-scanning"
                            className="ml-1 inline-flex items-center gap-1 text-[10px] text-slate-400"
                        >
                            <Loader2 size={11} className="animate-spin" />
                            scanning…
                        </span>
                    )}
                </div>
                <div className="flex items-center gap-1">
                    <button
                        data-testid="printability-rescan-btn"
                        onClick={() => recheckAsync({ objects, buildVolume })}
                        disabled={isScanning}
                        className="text-[10px] uppercase tracking-wider text-slate-400 hover:text-white disabled:opacity-50 px-2 py-1 rounded hover:bg-slate-800"
                        title="Re-run all checks against the current scene"
                    >
                        Re-scan
                    </button>
                    <button
                        data-testid="printability-panel-close"
                        onClick={() => setPanelOpen(false)}
                        className="p-1 rounded hover:bg-slate-800 text-slate-400"
                        aria-label="Close printability panel"
                    >
                        <X size={15} />
                    </button>
                </div>
            </header>
            <div className="flex-1 overflow-y-auto" data-testid="printability-findings-list">
                {findings.length === 0 && !isScanning ? (
                    <div className="px-6 py-10 text-center" data-testid="printability-empty-state">
                        <ShieldCheck size={32} className="text-emerald-400 mx-auto mb-3" />
                        <p className="text-sm font-semibold text-emerald-300">Ready to print — no issues found.</p>
                        <p className="mt-2 text-[11px] text-slate-500 leading-relaxed">
                            Manifold geometry · fits the build volume · no floating parts ·
                            no thin walls or steep overhangs detected.
                        </p>
                    </div>
                ) : findings.length === 0 && isScanning ? (
                    <div className="px-6 py-10 text-center">
                        <Loader2 size={28} className="text-orange-400 mx-auto mb-3 animate-spin" />
                        <p className="text-sm font-semibold text-slate-200">Scanning your scene…</p>
                        <p className="mt-2 text-[11px] text-slate-500">Checking for thin walls and other hidden defects.</p>
                    </div>
                ) : (
                    findings.map((f) => <FindingRow key={f.id} finding={f} />)
                )}
            </div>
        </aside>
    );
}
