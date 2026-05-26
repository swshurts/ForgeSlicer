import React, { useEffect, useMemo, useState } from "react";
import { X, Printer, Plus, Trash2, CheckCircle2, AlertCircle, Loader2, Send, PlayCircle, HelpCircle, Copy, History, ChevronDown, ChevronUp } from "lucide-react";
import {
  PROTOCOLS,
  listConnections,
  saveConnection,
  deleteConnection,
  listHistory,
  clearHistory,
} from "../../lib/printerConnect";

/**
 * Send-to-printer dialog.
 *
 * Two modes:
 *   • LIST   — pick from saved printer connections, or "Add new…".
 *   • EDIT   — form to create / update a connection (name, protocol,
 *              host, optional API key, port). Includes a "Test
 *              connection" button that probes the printer before save.
 *
 * Once a connection is selected, two action buttons are shown:
 *   1. Upload GCODE (just queues the file)
 *   2. Upload & Print (queues + immediately starts the print)
 *
 * Upload runs via the per-protocol implementation in printerConnect.js
 * (Moonraker only in this iteration). Other protocols appear as
 * disabled "Coming soon" entries in the type picker with a tooltip
 * explaining why.
 */
export default function SendToPrinterDialog({ open, onClose, gcode, filename }) {
  const [connections, setConnections] = useState([]);
  const [mode, setMode] = useState("list");        // "list" | "edit"
  const [editing, setEditing] = useState(null);    // null = adding new
  const [selectedId, setSelectedId] = useState(null);
  // Per-upload state — kept here rather than in the form so it survives
  // toggling between Upload and Upload+Print without resetting.
  const [progress, setProgress] = useState(0);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState(null);      // { ok, msg } | { error, hint }
  const [showCorsHelp, setShowCorsHelp] = useState(false);
  // History panel — local state so the section refreshes after each
  // successful upload without forcing a re-mount of the dialog. The
  // section is collapsible to keep the empty-state minimal.
  const [history, setHistory] = useState([]);
  const [historyOpen, setHistoryOpen] = useState(false);

  // Reload connections + reset transient state on each open.
  useEffect(() => {
    if (!open) return;
    setConnections(listConnections());
    setHistory(listHistory());
    setProgress(0);
    setBusy(false);
    setResult(null);
    setMode("list");
    setEditing(null);
    setShowCorsHelp(false);
    // Auto-expand the history if there's anything in it — gives the
    // user a quick "look at your recent uploads" moment without an
    // extra click.
    setHistoryOpen(listHistory().length > 0);
  }, [open]);

  // Default-select the first connection so the user can hit "Upload"
  // immediately without an extra click.
  useEffect(() => {
    if (mode === "list" && connections.length > 0 && !selectedId) {
      setSelectedId(connections[0].id);
    }
  }, [mode, connections, selectedId]);

  const selected = useMemo(
    () => connections.find((c) => c.id === selectedId) || null,
    [connections, selectedId],
  );
  const selectedProto = useMemo(
    () => selected ? PROTOCOLS.find((p) => p.id === selected.protocol) : null,
    [selected],
  );

  if (!open) return null;

  const onAddNew = () => {
    setEditing({
      name: "",
      protocol: "moonraker",
      host: "",
      port: 80,
      apiKey: "",
    });
    setMode("edit");
    setResult(null);
  };
  const onEditExisting = (conn) => {
    setEditing({ ...conn });
    setMode("edit");
    setResult(null);
  };
  const onDelete = (id) => {
    deleteConnection(id);
    const next = listConnections();
    setConnections(next);
    if (selectedId === id) setSelectedId(next[0]?.id || null);
  };
  const onSave = (conn) => {
    const saved = saveConnection(conn);
    const next = listConnections();
    setConnections(next);
    setSelectedId(saved.id);
    setMode("list");
    setEditing(null);
  };

  const runUpload = async (alsoPrint) => {
    if (!selected || !selectedProto?.implemented) return;
    return await runUploadFor(selected, alsoPrint);
  };

  // Single-entry-point upload — used by both the main Upload buttons
  // AND the per-history-row "Re-upload" buttons. The history rows
  // pass an explicit `conn` so re-upload still works if the user has
  // since selected a different connection in the picker.
  const runUploadFor = async (conn, alsoPrint) => {
    const proto = PROTOCOLS.find((p) => p.id === conn.protocol);
    if (!proto?.implemented || !gcode || !filename) return;
    setBusy(true);
    setProgress(0);
    setResult(null);
    try {
      const r = await proto.upload({
        conn, gcode, filename, print: alsoPrint,
        onProgress: (p) => setProgress(p),
      });
      setResult({
        ok: true,
        msg: r.started
          ? `Print started on ${conn.name}.`
          : `Uploaded ${(r.size / 1024).toFixed(0)} KB to ${conn.name}.`,
      });
      setHistory(listHistory());
      setHistoryOpen(true);
    } catch (e) {
      setResult({
        error: e.message || String(e),
        hint: e.hint || null,
      });
    } finally {
      setBusy(false);
    }
  };

  const onClearHistory = () => {
    clearHistory();
    setHistory([]);
  };

  return (
    <div
      data-testid="send-to-printer-dialog"
      className="fixed inset-0 z-[210] bg-black/80 backdrop-blur-md flex items-center justify-center p-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-md bg-slate-900 border border-orange-500/30 rounded-xl shadow-2xl flex flex-col max-h-[90vh]"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="h-12 px-4 flex items-center gap-2 border-b border-slate-800 bg-orange-500/5 flex-shrink-0">
          <Printer size={16} className="text-orange-400" />
          <div className="flex-1 text-xs font-semibold uppercase tracking-wider text-orange-300">
            Send {filename || "GCODE"} to Printer
          </div>
          <button
            data-testid="send-to-printer-close"
            onClick={onClose}
            className="h-8 w-8 rounded text-slate-400 hover:text-white hover:bg-slate-800 flex items-center justify-center"
          >
            <X size={16} />
          </button>
        </div>

        <div className="p-4 flex flex-col gap-3 overflow-y-auto">
          {mode === "list" ? (
            <ListMode
              connections={connections}
              selectedId={selectedId}
              setSelectedId={setSelectedId}
              onAddNew={onAddNew}
              onEditExisting={onEditExisting}
              onDelete={onDelete}
            />
          ) : (
            <EditMode
              draft={editing}
              setDraft={setEditing}
              onCancel={() => setMode("list")}
              onSave={onSave}
              setResult={setResult}
              setShowCorsHelp={setShowCorsHelp}
            />
          )}

          {result && mode === "list" && (
            <ResultBanner result={result} onCorsHelp={() => setShowCorsHelp(true)} />
          )}

          {/* Upload + Upload-and-Print action row */}
          {mode === "list" && selected && selectedProto?.implemented && (
            <div className="flex flex-col gap-2 border-t border-slate-800 pt-3">
              {busy && (
                <div className="flex items-center gap-2 text-[11px] text-orange-300 font-mono">
                  <Loader2 size={12} className="animate-spin" />
                  Uploading… {Math.round(progress * 100)}%
                  <div className="flex-1 h-1 bg-slate-800 rounded overflow-hidden">
                    <div className="h-full bg-orange-500 transition-all" style={{ width: `${progress * 100}%` }} />
                  </div>
                </div>
              )}
              <div className="grid grid-cols-2 gap-2">
                <button
                  data-testid="send-to-printer-upload"
                  onClick={() => runUpload(false)}
                  disabled={busy || !gcode}
                  className="h-9 rounded bg-orange-500 hover:bg-orange-600 disabled:bg-slate-700 disabled:text-slate-500 text-white text-xs font-semibold flex items-center justify-center gap-1.5"
                >
                  <Send size={13} /> Upload
                </button>
                <button
                  data-testid="send-to-printer-upload-and-print"
                  onClick={() => runUpload(true)}
                  disabled={busy || !gcode}
                  className="h-9 rounded bg-green-500 hover:bg-green-600 disabled:bg-slate-700 disabled:text-slate-500 text-white text-xs font-semibold flex items-center justify-center gap-1.5"
                >
                  <PlayCircle size={13} /> Upload &amp; Print
                </button>
              </div>
            </div>
          )}

          {showCorsHelp && selectedProto?.corsHelp && (
            <CorsHelp proto={selectedProto} onClose={() => setShowCorsHelp(false)} />
          )}

          {/* Recent uploads — collapsible footer section. Empty until
              the user makes their first successful upload. */}
          {mode === "list" && history.length > 0 && (
            <HistorySection
              history={history}
              connections={connections}
              open={historyOpen}
              setOpen={setHistoryOpen}
              currentFilename={filename}
              gcodeAvailable={!!gcode}
              busy={busy}
              onReupload={(conn, withPrint) => runUploadFor(conn, withPrint)}
              onClear={onClearHistory}
            />
          )}
        </div>
      </div>
    </div>
  );
}

// ---- LIST mode ----
function ListMode({ connections, selectedId, setSelectedId, onAddNew, onEditExisting, onDelete }) {
  if (connections.length === 0) {
    return (
      <div className="flex flex-col items-center gap-3 py-6 text-center">
        <Printer size={28} className="text-slate-600" />
        <div className="text-sm text-slate-300">No printers connected yet.</div>
        <div className="text-[11px] text-slate-500 max-w-xs leading-snug">
          Add your printer's network address once and ForgeSlicer can upload sliced GCODE to it directly — no SD card shuffling.
        </div>
        <button
          data-testid="send-to-printer-add-first"
          onClick={onAddNew}
          className="h-9 px-4 rounded bg-orange-500 hover:bg-orange-600 text-white text-xs font-semibold flex items-center gap-1.5"
        >
          <Plus size={13} /> Add a printer
        </button>
      </div>
    );
  }
  return (
    <>
      <div className="space-y-1.5" data-testid="send-to-printer-list">
        {connections.map((c) => {
          const proto = PROTOCOLS.find((p) => p.id === c.protocol);
          const active = c.id === selectedId;
          return (
            <button
              key={c.id}
              data-testid={`send-to-printer-row-${c.id}`}
              onClick={() => setSelectedId(c.id)}
              className={`w-full text-left p-2.5 rounded border flex items-center gap-2 transition-colors ${
                active
                  ? "bg-orange-500/10 border-orange-500/60"
                  : "bg-slate-950 border-slate-800 hover:border-slate-600"
              }`}
            >
              <Printer size={14} className={active ? "text-orange-400" : "text-slate-500"} />
              <div className="flex-1 min-w-0">
                <div className="text-xs font-semibold text-slate-100 truncate">{c.name || c.host}</div>
                <div className="text-[10px] text-slate-500 font-mono truncate">
                  {proto?.label || c.protocol} · {c.host}
                </div>
              </div>
              <div
                role="button"
                tabIndex={0}
                data-testid={`send-to-printer-edit-${c.id}`}
                onClick={(e) => { e.stopPropagation(); onEditExisting(c); }}
                onKeyDown={(e) => { if (e.key === "Enter") { e.stopPropagation(); onEditExisting(c); } }}
                className="h-7 w-7 rounded text-slate-400 hover:text-orange-400 hover:bg-slate-800 flex items-center justify-center cursor-pointer"
                title="Edit"
              >
                <HelpCircle size={12} />
              </div>
              <div
                role="button"
                tabIndex={0}
                data-testid={`send-to-printer-delete-${c.id}`}
                onClick={(e) => { e.stopPropagation(); onDelete(c.id); }}
                onKeyDown={(e) => { if (e.key === "Enter") { e.stopPropagation(); onDelete(c.id); } }}
                className="h-7 w-7 rounded text-slate-400 hover:text-red-400 hover:bg-slate-800 flex items-center justify-center cursor-pointer"
                title="Forget this printer"
              >
                <Trash2 size={12} />
              </div>
            </button>
          );
        })}
      </div>
      <button
        data-testid="send-to-printer-add"
        onClick={onAddNew}
        className="h-9 rounded border border-dashed border-slate-700 hover:border-orange-500/60 hover:text-orange-300 text-slate-400 text-xs font-semibold flex items-center justify-center gap-1.5"
      >
        <Plus size={13} /> Add another printer
      </button>
    </>
  );
}

// ---- EDIT mode (add/edit a connection) ----
function EditMode({ draft, setDraft, onCancel, onSave, setResult, setShowCorsHelp }) {
  const [testing, setTesting] = useState(false);
  const [testStatus, setTestStatus] = useState(null); // { ok, ... } | { error, hint }
  const proto = PROTOCOLS.find((p) => p.id === draft.protocol) || PROTOCOLS[0];
  const valid = draft.name?.trim() && draft.host?.trim() && proto.implemented;

  const runTest = async () => {
    if (!proto.test) return;
    setTesting(true);
    setTestStatus(null);
    try {
      const r = await proto.test(draft);
      setTestStatus({ ok: true, ...r });
    } catch (e) {
      setTestStatus({ error: e.message || String(e), hint: e.hint || null });
    } finally {
      setTesting(false);
    }
  };

  return (
    <div className="space-y-2.5" data-testid="send-to-printer-edit">
      <label className="flex flex-col gap-1">
        <span className="text-[10px] uppercase tracking-wider text-slate-400">Name</span>
        <input
          data-testid="send-to-printer-field-name"
          type="text"
          value={draft.name || ""}
          onChange={(e) => setDraft({ ...draft, name: e.target.value })}
          placeholder="e.g., Voron in the basement"
          className="h-9 bg-slate-950 border border-slate-700 rounded px-2 text-xs text-white focus:border-orange-500 outline-none"
        />
      </label>
      <label className="flex flex-col gap-1">
        <span className="text-[10px] uppercase tracking-wider text-slate-400">Protocol</span>
        <select
          data-testid="send-to-printer-field-protocol"
          value={draft.protocol}
          onChange={(e) => setDraft({ ...draft, protocol: e.target.value })}
          className="h-9 bg-slate-950 border border-slate-700 rounded px-2 text-xs text-white focus:border-orange-500 outline-none"
        >
          {PROTOCOLS.map((p) => (
            <option key={p.id} value={p.id} disabled={!p.implemented}>
              {p.label}{!p.implemented ? " — coming soon" : ""}
            </option>
          ))}
        </select>
        <span className="text-[10px] text-slate-500 leading-snug">{proto.description}</span>
        {!proto.implemented && (
          <span className="text-[10px] text-amber-300/80 leading-snug">{proto.note}</span>
        )}
      </label>
      <div className="grid grid-cols-[1fr,80px] gap-2">
        <label className="flex flex-col gap-1">
          <span className="text-[10px] uppercase tracking-wider text-slate-400">Host / IP</span>
          <input
            data-testid="send-to-printer-field-host"
            type="text"
            value={draft.host || ""}
            onChange={(e) => setDraft({ ...draft, host: e.target.value })}
            placeholder="192.168.1.50 or printer.local"
            className="h-9 bg-slate-950 border border-slate-700 rounded px-2 text-xs text-white focus:border-orange-500 outline-none"
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-[10px] uppercase tracking-wider text-slate-400">Port</span>
          <input
            data-testid="send-to-printer-field-port"
            type="number"
            value={draft.port || ""}
            onChange={(e) => setDraft({ ...draft, port: parseInt(e.target.value, 10) || 80 })}
            placeholder="80"
            className="h-9 bg-slate-950 border border-slate-700 rounded px-2 text-xs text-white focus:border-orange-500 outline-none"
          />
        </label>
      </div>
      <label className="flex flex-col gap-1">
        <span className="text-[10px] uppercase tracking-wider text-slate-400">
          API Key <span className="text-slate-600 normal-case">(optional, usually blank on LAN)</span>
        </span>
        <input
          data-testid="send-to-printer-field-apikey"
          type="text"
          value={draft.apiKey || ""}
          onChange={(e) => setDraft({ ...draft, apiKey: e.target.value })}
          placeholder=""
          className="h-9 bg-slate-950 border border-slate-700 rounded px-2 text-xs text-white focus:border-orange-500 outline-none font-mono"
        />
      </label>

      {testStatus && (
        <div
          data-testid="send-to-printer-test-result"
          className={`rounded p-2 text-[11px] flex items-start gap-2 ${
            testStatus.ok
              ? "bg-emerald-500/10 border border-emerald-500/40 text-emerald-200"
              : "bg-red-500/10 border border-red-500/40 text-red-200"
          }`}
        >
          {testStatus.ok ? <CheckCircle2 size={13} className="flex-shrink-0 mt-0.5" /> : <AlertCircle size={13} className="flex-shrink-0 mt-0.5" />}
          <div className="flex-1 leading-tight">
            {testStatus.ok
              ? <>Connected to <span className="font-mono">{testStatus.name}</span>. State: <span className="font-mono">{testStatus.state}</span>.</>
              : <>
                  <div className="font-semibold">{testStatus.error}</div>
                  {testStatus.hint && (
                    <div className="text-red-300/80 mt-0.5">
                      {testStatus.hint}{" "}
                      {proto.corsHelp && (
                        <button
                          className="text-orange-300 underline"
                          onClick={() => setShowCorsHelp(true)}
                          type="button"
                          data-testid="send-to-printer-cors-help-link"
                        >
                          Show CORS setup
                        </button>
                      )}
                    </div>
                  )}
                </>
            }
          </div>
        </div>
      )}

      <div className="grid grid-cols-3 gap-2 pt-1">
        <button
          data-testid="send-to-printer-cancel"
          onClick={onCancel}
          className="h-9 rounded bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-semibold"
        >
          Cancel
        </button>
        <button
          data-testid="send-to-printer-test"
          onClick={runTest}
          disabled={testing || !valid}
          className="h-9 rounded bg-slate-800 hover:bg-slate-700 disabled:bg-slate-900 disabled:text-slate-600 text-slate-200 text-xs font-semibold flex items-center justify-center gap-1.5"
        >
          {testing ? <Loader2 size={11} className="animate-spin" /> : null}
          Test
        </button>
        <button
          data-testid="send-to-printer-save"
          onClick={() => { onSave(draft); setResult(null); }}
          disabled={!valid}
          className="h-9 rounded bg-orange-500 hover:bg-orange-600 disabled:bg-slate-700 disabled:text-slate-500 text-white text-xs font-semibold"
        >
          Save
        </button>
      </div>
    </div>
  );
}

function ResultBanner({ result, onCorsHelp }) {
  if (result.ok) {
    return (
      <div
        data-testid="send-to-printer-success"
        className="bg-emerald-500/10 border border-emerald-500/40 rounded p-2 text-[11px] text-emerald-200 flex items-start gap-2"
      >
        <CheckCircle2 size={13} className="flex-shrink-0 mt-0.5 text-emerald-400" />
        <span className="flex-1 leading-tight">{result.msg}</span>
      </div>
    );
  }
  return (
    <div
      data-testid="send-to-printer-error"
      className="bg-red-500/10 border border-red-500/40 rounded p-2 text-[11px] text-red-200 flex items-start gap-2"
    >
      <AlertCircle size={13} className="flex-shrink-0 mt-0.5 text-red-400" />
      <div className="flex-1 leading-tight">
        <div className="font-semibold">{result.error}</div>
        {result.hint && (
          <div className="text-red-300/80 mt-0.5">
            {result.hint}{" "}
            <button
              className="text-orange-300 underline"
              onClick={onCorsHelp}
              type="button"
              data-testid="send-to-printer-error-cors-link"
            >
              Show CORS setup
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

function CorsHelp({ proto, onClose }) {
  const [copied, setCopied] = useState(false);
  const help = proto.corsHelp;
  const copy = () => {
    navigator.clipboard.writeText(help.snippet);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };
  return (
    <div
      data-testid="send-to-printer-cors-help"
      className="bg-slate-950 border border-purple-500/40 rounded p-3 space-y-2 text-[11px] text-slate-200 leading-snug"
    >
      <div className="flex items-center justify-between">
        <div className="font-semibold text-purple-300 uppercase tracking-wider text-[10px]">
          Enable uploads from ForgeSlicer
        </div>
        <button
          onClick={onClose}
          className="text-slate-500 hover:text-white"
          aria-label="Close CORS help"
        >
          <X size={12} />
        </button>
      </div>
      <div>{help.summary}</div>
      <div className="text-slate-400">Add this to <span className="font-mono text-orange-300">{help.configFile}</span>:</div>
      <pre className="bg-black/40 border border-slate-800 rounded p-2 font-mono text-[10px] text-orange-200 overflow-x-auto">{help.snippet}</pre>
      <button
        onClick={copy}
        className="h-7 px-2.5 rounded bg-slate-800 hover:bg-slate-700 text-[10px] font-semibold text-slate-200 flex items-center gap-1.5"
        data-testid="send-to-printer-cors-copy"
      >
        <Copy size={11} /> {copied ? "Copied!" : "Copy snippet"}
      </button>
      <div className="text-slate-400">{help.after}</div>
    </div>
  );
}

// ---- Recent uploads / Print history ----
// Reads from localStorage via printerConnect.listHistory(). Each row
// shows: filename, printer, size, when. Two actions: Send (re-upload
// only) and Print (re-upload + start). Both are disabled when:
//   • the original printer connection has been deleted, OR
//   • the GCODE for that filename is no longer in memory (we don't
//     persist GCODE bodies — they can be 50 MB+).
// Disabled buttons still appear so the user can see WHAT they could do
// if they re-sliced the matching project.
function HistorySection({ history, connections, open, setOpen, currentFilename, gcodeAvailable, busy, onReupload, onClear }) {
  const rows = history.map((h) => ({
    ...h,
    conn: connections.find((c) => c.id === h.connId) || null,
  }));
  return (
    <div className="border-t border-slate-800 pt-2" data-testid="send-to-printer-history">
      <button
        onClick={() => setOpen(!open)}
        className="w-full flex items-center gap-2 text-[10px] uppercase tracking-wider text-slate-400 hover:text-orange-300 py-1"
      >
        <History size={11} />
        Recent uploads
        <span className="text-slate-600">({history.length})</span>
        <span className="flex-1" />
        {open ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
      </button>
      {open && (
        <div className="space-y-1 mt-1" data-testid="send-to-printer-history-list">
          {rows.slice(0, 10).map((h) => {
            const canReupload = !!h.conn && gcodeAvailable && currentFilename === h.filename;
            const reason = !h.conn
              ? "Original printer no longer saved."
              : !canReupload
                ? "Re-slice this project first to make the GCODE available."
                : null;
            return (
              <div
                key={h.id}
                data-testid={`send-to-printer-history-row-${h.id}`}
                className="bg-slate-950 border border-slate-800 rounded p-2 flex items-center gap-2"
              >
                <div className="flex-1 min-w-0">
                  <div className="text-[11px] font-mono text-slate-200 truncate">
                    {h.filename}
                    {h.started && (
                      <span className="ml-1.5 text-[9px] text-emerald-300/80 uppercase tracking-wider">printed</span>
                    )}
                  </div>
                  <div className="text-[9px] text-slate-500 flex items-center gap-1.5">
                    <span>{h.printerName}</span>
                    <span>·</span>
                    <span>{(h.size / 1024).toFixed(0)} KB</span>
                    <span>·</span>
                    <span title={new Date(h.ts).toLocaleString()}>{relativeTime(h.ts)}</span>
                  </div>
                </div>
                <button
                  data-testid={`send-to-printer-history-reupload-${h.id}`}
                  onClick={() => onReupload(h.conn, false)}
                  disabled={!canReupload || busy}
                  title={reason || "Re-upload (no print start)"}
                  className="h-7 px-2 rounded bg-slate-800 hover:bg-orange-500 hover:text-white disabled:bg-slate-900 disabled:text-slate-700 disabled:cursor-not-allowed text-slate-300 text-[10px] font-semibold flex items-center gap-1"
                >
                  <Send size={10} /> Send
                </button>
                <button
                  data-testid={`send-to-printer-history-reprint-${h.id}`}
                  onClick={() => onReupload(h.conn, true)}
                  disabled={!canReupload || busy}
                  title={reason || "Re-upload and start printing"}
                  className="h-7 px-2 rounded bg-slate-800 hover:bg-green-500 hover:text-white disabled:bg-slate-900 disabled:text-slate-700 disabled:cursor-not-allowed text-slate-300 text-[10px] font-semibold flex items-center gap-1"
                >
                  <PlayCircle size={10} /> Print
                </button>
              </div>
            );
          })}
          {history.length > 10 && (
            <div className="text-[9px] text-slate-600 text-center pt-1">
              {history.length - 10} older entries hidden (we keep the last 50).
            </div>
          )}
          <button
            data-testid="send-to-printer-history-clear"
            onClick={onClear}
            className="w-full h-6 mt-1 rounded border border-slate-800 hover:border-red-500/40 hover:text-red-400 text-slate-500 text-[10px] flex items-center justify-center gap-1.5"
          >
            <Trash2 size={10} /> Clear history
          </button>
        </div>
      )}
    </div>
  );
}

// Human-friendly "5 min ago" / "2 hr ago" / "Mar 12" formatter.
// Avoids pulling in dayjs/date-fns for this single use.
function relativeTime(iso) {
  try {
    const then = new Date(iso).getTime();
    if (!then) return iso;
    const diffSec = Math.round((Date.now() - then) / 1000);
    if (diffSec < 30) return "just now";
    if (diffSec < 90) return "1 min ago";
    if (diffSec < 3600) return `${Math.round(diffSec / 60)} min ago`;
    if (diffSec < 5400) return "1 hr ago";
    if (diffSec < 86400) return `${Math.round(diffSec / 3600)} hr ago`;
    if (diffSec < 86400 * 2) return "yesterday";
    if (diffSec < 86400 * 7) return `${Math.round(diffSec / 86400)} days ago`;
    return new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric" });
  } catch {
    return iso;
  }
}

