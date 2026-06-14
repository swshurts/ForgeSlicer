// iter-100.9 — Plan Preview dialog.
//
// Opened when the voice path returns either an "action:plan" or an
// "action:template" response. For templates we resolve the step list
// via /api/voice/expand-template once the dialog mounts.
//
// UX commitments (per user choice "always-preview, user clicks Run"):
//   • Always shown; user must hit Run before anything mutates the scene.
//   • Cancel closes without touching the scene.
//   • Live progress bar while executing (one step → one row turns green).
//   • Errors halt the run and the user sees which step failed; the
//     scene's history already has the partial as a single undo entry.
//
// The dialog is opened by the global custom event
//   forgeslicer:open-plan-preview
// with detail { plan?: {steps,...}, template?: {template_id, params, summary?} }.
// Either field is accepted; if both are passed, plan wins.

import React, { useEffect, useRef, useState } from "react";
import { X, Play, Loader2, CheckCircle2, AlertTriangle, Layers, Sparkles } from "lucide-react";
import { executePlan, expandTemplate } from "../lib/voicePlanExecutor";

function actionIcon(action) {
  if (action === "add") return <Layers size={11} />;
  if (action === "boolean") return <Sparkles size={11} />;
  return <Layers size={11} />;
}

export default function PlanPreviewDialog() {
  const [open, setOpen] = useState(false);
  const [steps, setSteps] = useState([]);
  const [summary, setSummary] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  // Per-step run state: { i: "ok"|"running"|"fail"|undefined }
  const [runState, setRunState] = useState({});
  const [running, setRunning] = useState(false);
  // Source flavour for the dialog header.
  const [origin, setOrigin] = useState("plan");
  const cancelRef = useRef(false);

  useEffect(() => {
    const onOpen = async (e) => {
      const detail = e?.detail || {};
      setOpen(true);
      setRunState({});
      setError("");
      setRunning(false);
      cancelRef.current = false;
      if (detail.plan && Array.isArray(detail.plan.steps)) {
        setOrigin("plan");
        setSteps(detail.plan.steps);
        setSummary(detail.plan.summary || `Plan — ${detail.plan.steps.length} step${detail.plan.steps.length === 1 ? "" : "s"}`);
        setLoading(false);
        return;
      }
      if (detail.template?.template_id) {
        setOrigin("template");
        setLoading(true);
        setSteps([]);
        setSummary(detail.template.summary || detail.template.template_id);
        try {
          const data = await expandTemplate(detail.template.template_id, detail.template.params || {});
          setSteps(data.steps || []);
          setSummary(data.summary || `${detail.template.template_id} — ${data.steps?.length || 0} steps`);
        } catch (err) {
          setError(`Template failed: ${err?.response?.data?.detail || err.message || err}`);
        } finally {
          setLoading(false);
        }
        return;
      }
      // No content — close gracefully.
      setOpen(false);
    };
    window.addEventListener("forgeslicer:open-plan-preview", onOpen);
    return () => window.removeEventListener("forgeslicer:open-plan-preview", onOpen);
  }, []);

  // Esc closes (only when not running — interrupting mid-run leaves
  // partial state the user might not want).
  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e) => { if (e.key === "Escape" && !running) close(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, running]);

  const close = () => {
    setOpen(false);
    setSteps([]);
    setError("");
    setSummary("");
    setRunState({});
  };

  const run = async () => {
    setRunning(true);
    setError("");
    setRunState({});
    const res = await executePlan(steps, {
      onProgress: ({ index, total, result }) => {
        setRunState((s) => ({ ...s, [index]: result.ok ? "ok" : "fail" }));
      },
    });
    setRunning(false);
    if (!res.ok) {
      const lastFail = res.results.findLast?.((r) => !r.ok) || res.results[res.results.length - 1];
      setError(`Stopped at step ${(lastFail?.index ?? 0) + 1}: ${lastFail?.reason || "unknown error"}`);
    } else {
      // Auto-close after a tiny pause so users see the all-green state.
      setTimeout(() => close(), 700);
    }
  };

  if (!open) return null;

  return (
    <div
      data-testid="plan-preview-dialog"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4"
      onClick={() => { if (!running) close(); }}
    >
      <div
        className="bg-slate-900 border border-slate-700 rounded-lg shadow-2xl w-full max-w-xl flex flex-col max-h-[85vh]"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-5 py-3 border-b border-slate-800">
          <div className="min-w-0">
            <h2 className="text-base font-bold text-white truncate" data-testid="plan-preview-summary">
              {summary || "Plan preview"}
            </h2>
            <p className="text-xs text-slate-400">
              {origin === "template" ? "Template" : "Multi-step plan"} — review before running
            </p>
          </div>
          <button
            data-testid="plan-preview-close"
            onClick={close}
            disabled={running}
            className="h-8 w-8 rounded hover:bg-slate-800 text-slate-400 hover:text-white flex items-center justify-center disabled:opacity-30 disabled:cursor-not-allowed"
            title="Cancel (Esc)"
          >
            <X size={16} />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-3 py-2 min-h-[160px] bg-slate-950/40" data-testid="plan-preview-steps">
          {loading && (
            <div className="flex items-center gap-2 text-slate-400 text-sm py-6 justify-center" data-testid="plan-preview-loading">
              <Loader2 size={14} className="animate-spin" /> Building plan…
            </div>
          )}
          {!loading && steps.length === 0 && !error && (
            <div className="text-slate-500 text-xs px-3 py-4">Empty plan.</div>
          )}
          {steps.map((st, i) => {
            const state = runState[i];
            const ringColor =
              state === "ok" ? "border-green-500/60 bg-green-500/5"
              : state === "fail" ? "border-red-500/60 bg-red-500/5"
              : "border-slate-700 bg-slate-900";
            return (
              <div
                key={i}
                data-testid={`plan-preview-step-${i}`}
                className={`flex items-start gap-2 px-2 py-1.5 mb-1 rounded border ${ringColor}`}
              >
                <div className="w-5 text-[10px] font-mono text-slate-500 pt-0.5 text-right">{i + 1}.</div>
                <div className="text-slate-400 mt-0.5">{actionIcon(st.action)}</div>
                <div className="flex-1 min-w-0">
                  <div className="text-xs text-slate-200 truncate">
                    <span className="font-mono text-orange-300/80 mr-1">{st.action}</span>
                    {st.note || (st.type ? `${st.type} ${st.modifier === "negative" ? "(neg)" : ""}` : "")}
                  </div>
                </div>
                <div className="w-4 pt-0.5">
                  {state === "ok" && <CheckCircle2 size={12} className="text-green-400" />}
                  {state === "fail" && <AlertTriangle size={12} className="text-red-400" />}
                  {state === undefined && running && <Loader2 size={12} className="animate-spin text-slate-500" />}
                </div>
              </div>
            );
          })}
        </div>

        {error && (
          <div className="px-5 py-2 bg-red-950/40 border-t border-red-700/40 text-red-300 text-xs flex items-center gap-2" data-testid="plan-preview-error">
            <AlertTriangle size={13} /> {error}
          </div>
        )}

        <div className="flex items-center justify-between gap-3 px-5 py-3 border-t border-slate-800 bg-slate-900/80">
          <div className="text-[11px] text-slate-500">
            {steps.length > 0 && !running && !error && `${steps.length} step${steps.length === 1 ? "" : "s"}`}
            {running && "Running…"}
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              data-testid="plan-preview-cancel"
              onClick={close}
              disabled={running}
              className="h-9 px-3 bg-slate-800 hover:bg-slate-700 text-slate-100 text-xs font-semibold rounded border border-slate-700 disabled:opacity-30 disabled:cursor-not-allowed"
            >
              Cancel
            </button>
            <button
              type="button"
              data-testid="plan-preview-run"
              onClick={run}
              disabled={running || loading || steps.length === 0 || !!error}
              className="h-9 px-3 bg-orange-500 hover:bg-orange-600 text-white text-xs font-semibold rounded inline-flex items-center gap-1.5 disabled:opacity-40 disabled:cursor-not-allowed"
            >
              <Play size={13} /> Run plan
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
