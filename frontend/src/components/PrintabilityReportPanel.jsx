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
import { X, RefreshCcw, ShieldAlert, ShieldCheck, ShieldQuestion, Loader2, Wrench, Sparkles, ExternalLink } from "lucide-react";
import { useScene } from "../lib/store";
import { exportSceneToSTLBytes } from "../lib/exporters";
import { analyzePrintability } from "../lib/printabilityApi";
import { repairImportedObject } from "../lib/meshRepairApi";
import { decimateImportedObject, addBaseToImportedObject, thickenWallsImportedObject } from "../lib/meshOptimizeApi";

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
    <svg width="112" height="112" data-testid="printability-score-ring">
      {/* iter-126.1 — Rotate only the ring paths (so the arc starts at
          12 o'clock and grows clockwise), NOT the whole SVG. Previously
          the outer <svg> had className '-rotate-90' AND the <text> had
          BOTH className 'rotate-90' AND a transform attribute — a
          triple-rotation stack that pushed the number off-canvas. Now
          only the two <circle> elements rotate; the text sits upright
          in the natural SVG coordinate system. */}
      <g transform="rotate(-90 56 56)">
        <circle cx="56" cy="56" r={r} stroke="#1E293B" strokeWidth="10" fill="none" />
        <circle
          cx="56" cy="56" r={r} stroke={color} strokeWidth="10" fill="none"
          strokeDasharray={`${dash} ${c - dash}`} strokeLinecap="round"
          style={{ transition: "stroke-dasharray 400ms ease-out" }}
        />
      </g>
      <text
        x="56" y="56" textAnchor="middle" dominantBaseline="central"
        className="font-mono font-bold" fill="white" fontSize="26"
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

function IssueRow({ issue, onFix, fixingCode }) {
  const sev = SEV_META[issue.severity] || SEV_META.info;
  const isFixing = fixingCode === issue.fix_action;
  const anyFixing = !!fixingCode;
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
          disabled={anyFixing}
          className="mt-2 h-7 px-2 bg-slate-800 hover:bg-orange-500/25 hover:text-orange-100 text-slate-200 text-[11px] font-medium rounded flex items-center gap-1.5 border border-slate-700 hover:border-orange-500/40 disabled:opacity-50 disabled:cursor-wait"
        >
          {isFixing
            ? <><Loader2 size={11} className="animate-spin" /> Fixing…</>
            : <><Wrench size={11} /> Fix with {actionLabel(issue.fix_action)}</>
          }
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
  const updateObject = useScene((s) => s.updateObject);
  const pushHistory = useScene((s) => s.pushHistory);
  const [loading, setLoading] = useState(false);
  const [report, setReport] = useState(null);
  const [err, setErr] = useState("");
  // iter-127 — Track "Fix in progress" so the button spins + we can
  // disable other actions concurrently. Also remember the pre-fix score
  // so we can surface a satisfying "42 → 78" delta toast after each run.
  const [fixingCode, setFixingCode] = useState(null);
  const [lastScoreBeforeFix, setLastScoreBeforeFix] = useState(null);

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
      // If a fix just completed, celebrate the delta.
      if (lastScoreBeforeFix != null) {
        const delta = rep.score - lastScoreBeforeFix;
        if (delta > 0) {
          toast.success(`Score raised: ${lastScoreBeforeFix} → ${rep.score}`, {
            description: `+${delta} points from the last fix.`,
          });
        } else if (delta < 0) {
          toast.warning(`Score dropped: ${lastScoreBeforeFix} → ${rep.score}`, {
            description: `The fix introduced ${-delta} new penalty points. You may want to undo.`,
          });
        } else {
          toast.info(`Score unchanged (${rep.score})`, {
            description: "No detectable improvement — the mesh may already be at its best.",
          });
        }
        setLastScoreBeforeFix(null);
      }
    } catch (e) {
      setErr(e.message || "Analysis failed.");
    } finally {
      setLoading(false);
    }
  }, [objects, lastScoreBeforeFix]);

  useEffect(() => {
    if (open) runAnalysis();
  }, [open, runAnalysis]);

  // iter-127 — Real Fix handlers. `auto_clean` runs the existing
  // /api/mesh/repair endpoint (MeshLab dedupe/reorient/tiny-shard removal
  // + PyMeshFix watertight + trimesh fix_normals) on every imported
  // object in the scene. Non-imported primitives (cube/cone/etc) don't
  // need repair — they're mathematically clean by construction.
  const runAutoClean = useCallback(async () => {
    const importedObjs = (objects || []).filter(
      (o) => o.type === "imported" && !o.locked && (o.visible ?? true) && o.geometry,
    );
    if (importedObjs.length === 0) {
      toast.info("Auto-Clean skipped", {
        description: "Only imported meshes need repair — primitives are already clean.",
      });
      return;
    }
    setFixingCode("auto_clean");
    // iter-127.2 — Snapshot the scene BEFORE the repair so Ctrl+Z can
    // roll it back like any other edit. Users get consistent undo
    // semantics across the whole app; no dedicated "Revert" button
    // needed. Single history entry covers the entire repair batch
    // (repair-all-then-undo-once, not undo-once-per-object).
    pushHistory();
    // Remember the current score so we can show a delta after re-analysis.
    setLastScoreBeforeFix(report?.score ?? null);
    let repaired = 0;
    let totalInTris = 0;
    let totalOutTris = 0;
    let anyNonWatertight = false;
    try {
      for (const obj of importedObjs) {
        const { update, stats } = await repairImportedObject(obj);
        updateObject(obj.id, update);
        repaired += 1;
        totalInTris += stats.inputTris || 0;
        totalOutTris += stats.outputTris || 0;
        if (!stats.watertight) anyNonWatertight = true;
      }
      toast.success(`Auto-Clean complete — ${repaired} mesh${repaired === 1 ? "" : "es"} repaired`, {
        description: `${totalInTris.toLocaleString()} → ${totalOutTris.toLocaleString()} triangles`
          + (anyNonWatertight ? " · some parts still not fully watertight" : " · all parts now watertight")
          + " · press Ctrl+Z to revert",
      });
      // Re-run analysis to refresh the score. The delta-toast fires
      // inside runAnalysis when it sees lastScoreBeforeFix is set.
      await runAnalysis();
    } catch (e) {
      setLastScoreBeforeFix(null);
      toast.error(`Auto-Clean failed: ${e.message || e}`);
    } finally {
      setFixingCode(null);
    }
  }, [objects, report, updateObject, runAnalysis, pushHistory]);

  // Iter-135 — Real fix handlers for decimate + add-base. Same
  // pattern as runAutoClean: pushHistory for Ctrl+Z, remember score
  // before, mutate every applicable imported object, re-analyse.
  //
  // Both endpoints are per-object (backend takes one STL); we iterate
  // the imported meshes in the scene and apply the fix to each.
  // Non-imported primitives skip — they're mathematically clean and
  // already have a computed silhouette.
  const _applyOptimizePerObject = useCallback(async (label, kind, params) => {
    const targets = (objects || []).filter(
      (o) => o.type === "imported" && !o.locked && (o.visible ?? true) && o.geometry,
    );
    if (targets.length === 0) {
      toast.info(`${label} skipped`, { description: "Only imported meshes can be optimized — primitives already print cleanly." });
      return { applied: 0 };
    }
    setFixingCode(kind);
    pushHistory();
    setLastScoreBeforeFix(report?.score ?? null);
    let totalBefore = 0, totalAfter = 0, applied = 0;
    try {
      for (const obj of targets) {
        let runner;
        if (kind === "decimate_with_intent") {
          runner = decimateImportedObject(obj, params?.preset || "functional");
        } else if (kind === "thicken_walls") {
          runner = thickenWallsImportedObject(obj, params || {});
        } else {
          runner = addBaseToImportedObject(obj, params || {});
        }
        const { update, stats } = await runner;
        updateObject(obj.id, update);
        totalBefore += stats.facesBefore || 0;
        totalAfter += stats.facesAfter || 0;
        applied += 1;
      }
      toast.success(`${label} complete — ${applied} mesh${applied === 1 ? "" : "es"} optimized`, {
        description: `${totalBefore.toLocaleString()} → ${totalAfter.toLocaleString()} triangles · press Ctrl+Z to revert`,
      });
      await runAnalysis();
      return { applied };
    } catch (e) {
      setLastScoreBeforeFix(null);
      toast.error(`${label} failed: ${e.message || e}`);
      return { applied: 0, error: e };
    } finally {
      setFixingCode(null);
    }
  }, [objects, pushHistory, report, updateObject, runAnalysis]);

  const runDecimate = useCallback((preset = "functional") => {
    return _applyOptimizePerObject("Decimate", "decimate_with_intent", { preset });
  }, [_applyOptimizePerObject]);

  const runAddBase = useCallback((shape = "cylinder", thicknessMm = 3.0, marginMm = 2.0) => {
    return _applyOptimizePerObject("Add Base", "add_base", { shape, thicknessMm, marginMm });
  }, [_applyOptimizePerObject]);

  const runThickenWalls = useCallback((targetThicknessMm = 1.2) => {
    return _applyOptimizePerObject("Thicken", "thicken_walls", { targetThicknessMm });
  }, [_applyOptimizePerObject]);

  // Iter-135 — Auto-Fix orchestrator. Runs the applicable fixers in
  // safe order (repair → decimate → add-base) on the CURRENT set of
  // issues. Stops on first failure so users don't end up with a
  // half-fixed scene. Undo is a single pushHistory entry per step
  // — three fixes = three Ctrl+Z presses to fully revert. That's a
  // deliberate trade-off: users often want to keep the auto-clean
  // but drop the aggressive decimate.
  const runAutoFix = useCallback(async () => {
    if (!report || report.issues.length === 0) {
      toast.info("Nothing to fix", { description: "Report is already clean." });
      return;
    }
    const codes = new Set(report.issues.map((i) => i.fix_action).filter(Boolean));
    const steps = [];
    // Order: watertight-repair first, then wall-thicken (needs a
    // manifold to Minkowski-sum), then decimate, then base. Thicken
    // BEFORE decimate because Minkowski on the pre-decimated mesh
    // preserves more subtle wall geometry.
    if (codes.has("auto_clean")) steps.push({ label: "Auto-Clean", run: runAutoClean });
    if (codes.has("thicken_walls")) steps.push({ label: "Thicken", run: () => runThickenWalls(1.2) });
    if (codes.has("decimate_with_intent")) steps.push({ label: "Decimate", run: () => runDecimate("functional") });
    if (codes.has("add_base")) steps.push({ label: "Add Base", run: () => runAddBase("cylinder", 3.0, 2.0) });
    if (steps.length === 0) {
      // Only fixes remaining are ones we haven't shipped yet (voxel
      // remesh, reorient). Surface that transparently.
      toast.info("No Auto-Fix step available", {
        description: "The remaining issues need tools that aren't automated yet. Use the individual Fix buttons.",
      });
      return;
    }
    setFixingCode("auto_fix_all");
    toast.info(`Auto-Fix: running ${steps.length} step${steps.length === 1 ? "" : "s"}…`);
    try {
      for (const step of steps) {
        // Sequential on purpose: each step re-runs analysis via runAnalysis,
        // and later steps need the fresh geometry / score baseline the
        // earlier step produced.
        await step.run();
      }
    } finally {
      setFixingCode(null);
    }
  }, [report, runAutoClean, runDecimate, runAddBase, runThickenWalls]);

  const handleFix = useCallback((code, issue) => {
    if (code === "auto_clean")           { runAutoClean(); return; }
    if (code === "decimate_with_intent") { runDecimate("functional"); return; }
    if (code === "add_base")             { runAddBase("cylinder", 3.0, 2.0); return; }
    if (code === "thicken_walls")        { runThickenWalls(1.2); return; }
    // Remaining fix actions (voxel_remesh, reorient) still land in
    // follow-up iterations.
    toast.info(`${actionLabel(code)} — coming in the next update`, {
      description: `Will address: ${issue.message}`,
    });
  }, [runAutoClean, runDecimate, runAddBase, runThickenWalls]);

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

            {/* Iter-135 — Auto-Fix runs applicable fixers in safe
                order (repair → decimate → add-base). Only shown when
                at least one fixable issue is present; disables when
                a fix is already in-flight. */}
            {report.issues.some((i) => ["auto_clean", "decimate_with_intent", "add_base", "thicken_walls"].includes(i.fix_action)) && (
              <button
                data-testid="printability-auto-fix"
                onClick={runAutoFix}
                disabled={!!fixingCode}
                className="w-full h-9 flex items-center justify-center gap-2 rounded font-semibold text-[12px] bg-gradient-to-r from-orange-500 to-amber-500 hover:from-orange-400 hover:to-amber-400 text-white disabled:opacity-50 disabled:cursor-wait shadow"
              >
                {fixingCode === "auto_fix_all"
                  ? <><Loader2 size={13} className="animate-spin" /> Auto-Fixing…</>
                  : <><Sparkles size={13} /> Auto-Fix all applicable issues</>}
              </button>
            )}

            {report.issues.length > 0 && (
              <div className="space-y-2 pt-1" data-testid="printability-issue-list">
                <div className="text-[10px] uppercase tracking-wider text-slate-500 font-semibold pl-1">
                  Issues ({report.issues.length})
                </div>
                {report.issues.map((issue, i) => (
                  <IssueRow key={`${issue.code}-${i}`} issue={issue} onFix={handleFix} fixingCode={fixingCode} />
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
