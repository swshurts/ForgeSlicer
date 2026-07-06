/**
 * Print-Readiness Report — dockable slide-in panel.
 *
 * The UX skeleton for the "AI-mesh → printable file" workflow. Shows:
 *   - a 0-100 score ring (color-coded)
 *   - a verdict badge (Ready / Needs work / Not printable)
 *   - metric strip (triangles, volume, bbox, components)
 *   - an itemised issue list, each with a "Fix" button that maps to a
 *     downstream tool (Auto-Clean, Decimate, Add Base, ...) via a
 *     `fix_action` code from the backend.
 *
 * Trigger: toolbar button "Print-Readiness" opens the panel. Panel
 * auto-runs analysis on the current scene when opened, with a Refresh
 * button for repeat runs.
 *
 * Fix buttons are wired to a `onFixAction(code)` handler that the
 * parent (workspace) provides — for now most actions are stubs that
 * toast "coming soon" but the plumbing is in place for Auto-Clean etc.
 */
import React, { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { X, RefreshCcw, ShieldAlert, ShieldCheck, ShieldQuestion, Loader2, Wrench, ExternalLink } from "lucide-react";
import { useScene } from "../lib/store";
import { exportSceneToSTLBytes } from "../lib/exporters";
import { analyzePrintability } from "../lib/printabilityApi";

const SEV_META = {
  critical: { label: "CRITICAL", cls: "bg-red-500/15 text-red-300 border-red-500/40" },
  major:    { label: "MAJOR",    cls: "bg-orange-500/15 text-orange-300 border-orange-500/40" },
  minor:    { label: "MINOR",    cls: "bg-amber-500/15 text-amber-300 border-amber-500/40" },
  info:     { label: "INFO",     cls: "bg-slate-500/15 text-slate-300 border-slate-500/40" },
};

const VERDICT_META = {
  ready:         { label: "Ready to print",   Icon: ShieldCheck,    cls: "text-emerald-400" },
  needs_work:    { label: "Needs work",       Icon: ShieldQuestion, cls: "text-amber-400" },
  not_printable: { label: "Not printable",    Icon: ShieldAlert,    cls: "text-red-400" },
};

function ScoreRing({ score }) {
  // Larger stroke value = better score → arc fills clockwise
  const clamped = Math.max(0, Math.min(100, score));
  const r = 44, c = 2 * Math.PI * r;
  const dash = (clamped / 100) * c;
  const color = clamped >= 80 ? "#10B981" : clamped >= 45 ? "#F59E0B" : "#EF4444";
  return (
    <svg width="112" height="112" className="-rotate-90" data-testid="printability-score-ring">
      <circle cx="56" cy="56" r={r} stroke="#1E293B" strokeWidth="10" fill="none" />
      <circle
        cx="56" cy="56" r={r} stroke={color} strokeWidth="10" fill="none"
        strokeDasharray={`${dash} ${c - dash}`} strokeLinecap="round"
        style={{ transition: "stroke-dasharray 400ms ease-out" }}
      />
      <text
        x="56" y="56" textAnchor="middle" dominantBaseline="central"
        className="rotate-90 origin-center font-mono font-bold" fill="white" fontSize="26"
        transform="rotate(90 56 56)"
        data-testid="printability-score-number"
      >
        {clamped}
      </text>
    </svg>
  );
}

function MetricStrip({ metrics }) {
  const fmt = (n, d = 1) => Number(n || 0).toLocaleString("en-US", {
    maximumFractionDigits: d, minimumFractionDigits: 0,
  });
  const bbox = metrics.bbox_size_mm || [0, 0, 0];
  return (
    <div className="grid grid-cols-2 gap-2 text-[11px] font-mono" data-testid="printability-metrics">
      <div className="bg-slate-900 rounded p-2">
        <div className="text-slate-500 uppercase text-[9px] tracking-wider">Triangles</div>
        <div className="text-slate-100">{fmt(metrics.triangle_count, 0)}</div>
      </div>
      <div className="bg-slate-900 rounded p-2">
        <div className="text-slate-500 uppercase text-[9px] tracking-wider">Volume</div>
        <div className="text-slate-100">{fmt(metrics.volume_mm3 / 1000, 2)} cm³</div>
      </div>
      <div className="bg-slate-900 rounded p-2">
        <div className="text-slate-500 uppercase text-[9px] tracking-wider">BBox</div>
        <div className="text-slate-100">
          {fmt(bbox[0], 1)} × {fmt(bbox[1], 1)} × {fmt(bbox[2], 1)}mm
        </div>
      </div>
      <div className="bg-slate-900 rounded p-2">
        <div className="text-slate-500 uppercase text-[9px] tracking-wider">Watertight</div>
        <div className={metrics.is_watertight ? "text-emerald-300" : "text-red-300"}>
          {metrics.is_watertight ? "Yes" : "No"}
        </div>
      </div>
      <div className="bg-slate-900 rounded p-2">
        <div className="text-slate-500 uppercase text-[9px] tracking-wider">Parts</div>
        <div className="text-slate-100">{metrics.connected_components}</div>
      </div>
      <div className="bg-slate-900 rounded p-2">
        <div className="text-slate-500 uppercase text-[9px] tracking-wider">Flat base</div>
        <div className={metrics.has_flat_base ? "text-emerald-300" : "text-amber-300"}>
          {metrics.has_flat_base ? "Yes" : "No"}
        </div>
      </div>
    </div>
  );
}

function IssueRow({ issue, onFix }) {
  const sev = SEV_META[issue.severity] || SEV_META.info;
  return (
    <div
      data-testid={`printability-issue-${issue.code}`}
      className="bg-slate-900 border border-slate-800 rounded p-2.5 hover:border-slate-700 transition-colors"
    >
      <div className="flex items-start gap-2">
        <span className={`shrink-0 text-[9px] font-bold px-1.5 py-0.5 rounded border ${sev.cls}`}>
          {sev.label}
        </span>
        <div className="flex-1 min-w-0">
          <div className="text-[12px] text-slate-100">{issue.message}</div>
          {issue.detail && (
            <div className="text-[10px] text-slate-500 mt-0.5 leading-relaxed">{issue.detail}</div>
          )}
        </div>
      </div>
      {issue.fix_action && issue.fix_action !== "none" && (
        <button
          data-testid={`printability-fix-${issue.code}`}
          onClick={() => onFix(issue.fix_action, issue)}
          className="mt-2 h-7 px-2 bg-slate-800 hover:bg-orange-500/25 hover:text-orange-100 text-slate-200 text-[11px] font-medium rounded flex items-center gap-1.5 border border-slate-700 hover:border-orange-500/40"
        >
          <Wrench size={11} /> Fix with {actionLabel(issue.fix_action)}
        </button>
      )}
    </div>
  );
}

function actionLabel(code) {
  return {
    auto_clean: "Auto-Clean",
    decimate_with_intent: "Decimate",
    voxel_remesh: "Voxel Remesh",
    add_base: "Add Base",
    thicken_walls: "Thicken",
    reorient: "Reorient",
  }[code] || code;
}

export default function PrintabilityReportPanel({ open, onClose }) {
  const objects = useScene((s) => s.objects);
  const [loading, setLoading] = useState(false);
  const [report, setReport] = useState(null);
  const [err, setErr] = useState("");

  const runAnalysis = useCallback(async () => {
    setErr("");
    setLoading(true);
    setReport(null);
    try {
      if (!objects || objects.filter((o) => !o.locked && (o.visible ?? true)).length === 0) {
        throw new Error("Nothing to analyze. Add or import a part first.");
      }
      // Bake the current scene to STL and send it up. Full-scene analysis
      // is a solid starting point; per-object analysis is a future
      // refinement (backend already supports it — just pass one object).
      const { bytes } = await exportSceneToSTLBytes(objects);
      const rep = await analyzePrintability(bytes, "scene.stl", "stl");
      setReport(rep);
    } catch (e) {
      setErr(e.message || "Analysis failed.");
    } finally {
      setLoading(false);
    }
  }, [objects]);

  useEffect(() => {
    if (open) runAnalysis();
  }, [open, runAnalysis]);

  const handleFix = useCallback((code, issue) => {
    // Fix actions will be wired to real tools in follow-up iterations
    // (Auto-Clean → mesh_repair; Add Base → boolean union with a base
    // primitive; Decimate → new endpoint using open3d). For now surface
    // a clear "coming next" message with the mapped tool name so the
    // report's UX is complete end-to-end.
    toast.info(`${actionLabel(code)} — coming in the next update`, {
      description: `Will address: ${issue.message}`,
    });
  }, []);

  if (!open) return null;

  const verdict = report ? (VERDICT_META[report.verdict] || VERDICT_META.needs_work) : null;
  const VerdictIcon = verdict?.Icon;

  return (
    <div
      data-testid="printability-panel"
      className="fixed right-4 top-16 bottom-4 w-[380px] bg-slate-950 border border-slate-800 rounded-lg shadow-2xl flex flex-col z-40"
    >
      <div className="flex items-center justify-between p-3 border-b border-slate-800">
        <div className="flex items-center gap-2">
          <ShieldCheck size={16} className="text-orange-400" />
          <h3 className="text-sm font-semibold text-white">Print-Readiness</h3>
        </div>
        <div className="flex items-center gap-1">
          <button
            data-testid="printability-refresh"
            onClick={runAnalysis}
            disabled={loading}
            className="h-7 w-7 flex items-center justify-center rounded hover:bg-slate-800 text-slate-300 disabled:opacity-50"
            title="Re-run analysis"
          >
            {loading ? <Loader2 className="animate-spin" size={13} /> : <RefreshCcw size={13} />}
          </button>
          <button
            data-testid="printability-close"
            onClick={onClose}
            className="h-7 w-7 flex items-center justify-center rounded hover:bg-slate-800 text-slate-300"
            title="Close"
          >
            <X size={14} />
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-3 space-y-3">
        {loading && (
          <div className="text-center py-12 text-slate-500 text-sm">
            <Loader2 className="animate-spin mx-auto mb-2" size={20} />
            Analyzing scene…
          </div>
        )}
        {err && (
          <div
            data-testid="printability-error"
            className="p-3 bg-red-500/10 border border-red-500/40 rounded text-red-300 text-xs"
          >
            {err}
          </div>
        )}
        {report && !loading && (
          <>
            <div className="flex items-center gap-3">
              <ScoreRing score={report.score} />
              <div className="flex-1 min-w-0">
                <div className={`flex items-center gap-1.5 text-sm font-semibold ${verdict.cls}`} data-testid="printability-verdict">
                  {VerdictIcon && <VerdictIcon size={16} />}
                  {verdict.label}
                </div>
                <div className="text-[11px] text-slate-500 mt-1 leading-relaxed">
                  {report.issues.length === 0
                    ? "No issues detected — this mesh is ready to slice."
                    : `${report.issues.length} issue${report.issues.length === 1 ? "" : "s"} detected across the current scene.`
                  }
                </div>
              </div>
            </div>

            <MetricStrip metrics={report.metrics} />

            {report.issues.length > 0 && (
              <div className="space-y-2 pt-1" data-testid="printability-issue-list">
                <div className="text-[10px] uppercase tracking-wider text-slate-500 font-semibold pl-1">
                  Issues ({report.issues.length})
                </div>
                {report.issues.map((issue, i) => (
                  <IssueRow key={`${issue.code}-${i}`} issue={issue} onFix={handleFix} />
                ))}
              </div>
            )}
          </>
        )}
      </div>

      <div className="p-2.5 border-t border-slate-800 bg-slate-950">
        <div className="text-[10px] text-slate-500 leading-relaxed">
          Scoring based on watertightness, topology, tesselation, and base
          contact. Fix tools land in the next update.
          <a
            href="https://forgeslicer.com/docs/printability"
            target="_blank" rel="noreferrer"
            data-testid="printability-help-link"
            className="inline-flex items-center gap-0.5 text-orange-300 hover:text-orange-200 ml-1"
          >
            Learn more <ExternalLink size={9} />
          </a>
        </div>
      </div>
    </div>
  );
}
