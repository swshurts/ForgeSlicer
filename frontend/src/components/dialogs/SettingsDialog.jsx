// Settings dialog — central control panel for global preferences
// that don't belong in any single workspace popover.
//
// Tabs:
//   1. Appearance — theme (Auto / Dark / Dim / Light), per-route pin
//      toggle, plus a build-plate accent color picker.
//   2. Engine     — admin: reinstall OrcaSlicer (POST /api/slice/orca/reinstall),
//      live status pill, "force re-download" advanced option.
//
// Opened via the toolbar's Settings cog (or `forgeslicer:open-dialog`
// event with `{ name: "settings" }`). Read-only access for non-admins
// would be a backend-side concern; this is open to all users today.
import React, { useEffect, useState } from "react";
import { X, Palette, Sliders, Loader2, CheckCircle2, AlertTriangle, RefreshCw, Settings as SettingsIcon, Save, Cloud as CloudIcon, HardDrive } from "lucide-react";
import { Moon, Cloud, Sun, MonitorCog, Pin, PinOff } from "lucide-react";
import { useTheme } from "../../lib/theme";
import { orcaApi, apiErrorMessage } from "../../lib/api";
import { getSaveBehavior, setSaveBehavior, subscribeSaveBehavior } from "../../lib/savePref";

const THEMES = [
  { id: "system", label: "Auto",  icon: MonitorCog, hint: "Follow OS appearance" },
  { id: "dark",   label: "Dark",  icon: Moon,       hint: "Midnight slate" },
  { id: "dim",    label: "Dim",   icon: Cloud,      hint: "Softer dark" },
  { id: "light",  label: "Light", icon: Sun,        hint: "Light mode" },
];

const TABS = [
  { id: "appearance", label: "Appearance", icon: Palette },
  { id: "saving",     label: "Saving",     icon: Save },
  { id: "engine",     label: "Engine",     icon: Sliders },
];

export default function SettingsDialog({ open, onClose }) {
  const [tab, setTab] = useState("appearance");

  useEffect(() => {
    if (!open) return;
    const onKey = (e) => { if (e.key === "Escape") onClose?.(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      data-testid="settings-dialog"
      className="fixed inset-0 z-[110] flex items-center justify-center bg-black/60 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="relative bg-slate-900 border border-slate-700 rounded-lg shadow-2xl w-[min(720px,94vw)] max-h-[80vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-4 py-3 border-b border-slate-800">
          <div className="flex items-center gap-2 text-white">
            <SettingsIcon size={16} className="text-slate-400" />
            <span className="text-sm font-semibold">Settings</span>
          </div>
          <button
            data-testid="settings-close"
            onClick={onClose}
            className="h-8 w-8 flex items-center justify-center rounded hover:bg-slate-800 text-slate-400 hover:text-white"
          ><X size={16} /></button>
        </div>

        <div className="flex flex-1 min-h-0">
          {/* Sidebar */}
          <nav className="w-40 shrink-0 border-r border-slate-800 p-2 flex flex-col gap-1">
            {TABS.map((t) => {
              const Icon = t.icon;
              const active = tab === t.id;
              return (
                <button
                  key={t.id}
                  data-testid={`settings-tab-${t.id}`}
                  onClick={() => setTab(t.id)}
                  className={`flex items-center gap-2 px-2.5 py-1.5 rounded text-[12px] font-semibold transition-colors ${
                    active ? "bg-orange-500/20 text-orange-200 border-l-2 border-orange-500" : "text-slate-400 hover:bg-slate-800 hover:text-slate-200 border-l-2 border-transparent"
                  }`}
                >
                  <Icon size={12} /> {t.label}
                </button>
              );
            })}
          </nav>

          {/* Panel */}
          <div className="flex-1 min-w-0 overflow-auto p-5">
            {tab === "appearance" && <AppearancePanel />}
            {tab === "saving" && <SavingPanel />}
            {tab === "engine" && <EnginePanel />}
          </div>
        </div>
      </div>
    </div>
  );
}

function AppearancePanel() {
  const theme = useTheme((s) => s.theme);
  const resolved = useTheme((s) => s.resolvedTheme);
  const perRouteEnabled = useTheme((s) => s.perRouteEnabled);
  const routeThemes = useTheme((s) => s.routeThemes);
  const currentRoute = useTheme((s) => s.currentRoute);
  const setTheme = useTheme((s) => s.setTheme);
  const togglePerRoute = useTheme((s) => s.togglePerRoute);
  const activeChoice = (perRouteEnabled && routeThemes[currentRoute]) || theme;

  return (
    <div className="space-y-6 text-slate-200">
      <section>
        <h3 className="text-[11px] uppercase tracking-wider text-slate-400 font-semibold mb-2">Color theme</h3>
        <div className="grid grid-cols-4 gap-2" data-testid="settings-theme-grid">
          {THEMES.map(({ id, label, icon: Icon, hint }) => {
            const active = activeChoice === id;
            const title = id === "system" ? `${hint} — currently ${resolved}` : hint;
            return (
              <button
                key={id}
                data-testid={`settings-theme-${id}`}
                onClick={() => setTheme(id)}
                title={title}
                className={`flex flex-col items-center justify-center gap-1 h-16 rounded border text-[11px] font-semibold transition-colors ${
                  active
                    ? "bg-orange-500/20 border-orange-500 text-orange-100"
                    : "bg-slate-950 border-slate-700 text-slate-300 hover:border-slate-500 hover:text-white"
                }`}
              >
                <Icon size={16} /> {label}
              </button>
            );
          })}
        </div>
        <p className="mt-2 text-[10px] text-slate-500 leading-snug">
          The Auto theme follows your OS’s <code className="text-slate-400">prefers-color-scheme</code> setting. It currently resolves to <span className="text-slate-300 font-mono">{resolved}</span>.
        </p>
      </section>

      <section>
        <h3 className="text-[11px] uppercase tracking-wider text-slate-400 font-semibold mb-2">Per-page memory</h3>
        <button
          data-testid="settings-perroute-toggle"
          onClick={() => togglePerRoute()}
          className={`flex items-center gap-2 px-3 h-9 rounded text-xs font-semibold transition-colors ${
            perRouteEnabled ? "bg-purple-500/20 border border-purple-500 text-purple-100" : "bg-slate-950 border border-slate-700 text-slate-300 hover:text-white"
          }`}
        >
          {perRouteEnabled ? <Pin size={12} /> : <PinOff size={12} />}
          {perRouteEnabled ? "Per-page pinning ON" : "Per-page pinning OFF"}
        </button>
        <p className="mt-2 text-[10px] text-slate-500 leading-snug max-w-md">
          When ON, your theme choice is remembered per top-level route (e.g. dark in Workspace, light in Gallery). Pinned routes:&nbsp;
          {Object.keys(routeThemes).length === 0
            ? <span className="text-slate-400">none yet</span>
            : Object.entries(routeThemes).map(([r, t]) => (
                <span key={r} className="font-mono text-slate-400 mr-2">{r}→{t}</span>
              ))
          }
        </p>
      </section>
    </div>
  );
}

function EnginePanel() {
  const [status, setStatus] = useState(null);
  const [busy, setBusy] = useState(false);
  const [reinstalling, setReinstalling] = useState(false);
  const [error, setError] = useState("");
  const [force, setForce] = useState(false);

  const refresh = async () => {
    setBusy(true); setError("");
    try {
      const s = await orcaApi.status();
      setStatus(s);
    } catch (e) {
      setError(apiErrorMessage(e) || String(e));
    } finally {
      setBusy(false);
    }
  };

  useEffect(() => { refresh(); }, []);

  // Poll every 5s while a reinstall is in flight so the status pill
  // moves from "installing" → "ready" without the user clicking around.
  useEffect(() => {
    if (!reinstalling) return undefined;
    const id = setInterval(refresh, 5000);
    return () => clearInterval(id);
  }, [reinstalling]);

  // Stop polling once we observe a non-installing state with a binary.
  useEffect(() => {
    if (!status) return;
    if (!status.installing && status.installed) setReinstalling(false);
  }, [status]);

  const onReinstall = async () => {
    setBusy(true); setError("");
    try {
      await orcaApi.reinstall({ force });
      setReinstalling(true);
      // Refresh status immediately so the pill flips to "installing".
      setTimeout(refresh, 500);
    } catch (e) {
      setError(apiErrorMessage(e) || String(e));
    } finally {
      setBusy(false);
    }
  };

  const ready = status && status.installed && !status.installing;
  const installing = status && (status.installing || reinstalling);

  return (
    <div className="space-y-6 text-slate-200">
      <section>
        <h3 className="text-[11px] uppercase tracking-wider text-slate-400 font-semibold mb-2">OrcaSlicer engine</h3>
        <div className="bg-slate-950 border border-slate-800 rounded p-3 text-[11px] space-y-1">
          <div className="flex items-center gap-2" data-testid="settings-engine-status">
            {installing ? (
              <><Loader2 size={14} className="animate-spin text-amber-400" /> <span className="text-amber-200 font-semibold">Installing…</span></>
            ) : ready ? (
              <><CheckCircle2 size={14} className="text-emerald-400" /> <span className="text-emerald-200 font-semibold">Ready</span></>
            ) : (
              <><AlertTriangle size={14} className="text-slate-500" /> <span className="text-slate-400 font-semibold">Not installed</span></>
            )}
            {status?.version && (
              <span className="ml-2 text-slate-500 font-mono">{status.version}</span>
            )}
            {status?.binary && (
              <span className="ml-auto text-slate-600 font-mono text-[10px] truncate" title={status.binary}>{status.binary}</span>
            )}
          </div>
          {status?.detail && (
            <p className="text-slate-400 leading-snug">{status.detail}</p>
          )}
        </div>

        <div className="mt-4 flex items-center gap-3 flex-wrap">
          <button
            data-testid="settings-reinstall-btn"
            onClick={onReinstall}
            disabled={busy || installing}
            className="h-9 px-3 rounded bg-orange-500 hover:bg-orange-600 disabled:bg-slate-700 disabled:text-slate-500 text-xs font-semibold text-white flex items-center gap-1.5"
          >
            <RefreshCw size={12} className={installing ? "animate-spin" : ""} />
            {installing ? "Installing…" : "Reinstall OrcaSlicer"}
          </button>
          <label className="flex items-center gap-1.5 text-[11px] text-slate-400 cursor-pointer">
            <input
              data-testid="settings-reinstall-force"
              type="checkbox"
              checked={force}
              onChange={(e) => setForce(e.target.checked)}
              className="accent-orange-500"
            />
            Force re-download (~119 MB)
          </label>
          <button
            data-testid="settings-status-refresh"
            onClick={refresh}
            disabled={busy}
            className="h-9 px-2 rounded bg-slate-800 hover:bg-slate-700 text-[11px] text-slate-300 disabled:opacity-50"
            title="Refresh status now"
          >
            <RefreshCw size={11} className={busy ? "animate-spin" : ""} />
          </button>
        </div>
        {error && (
          <p data-testid="settings-engine-error" className="mt-3 text-[11px] text-red-300 bg-red-500/10 border border-red-500/30 rounded p-2 leading-snug">
            {error}
          </p>
        )}
        <p className="mt-3 text-[10px] text-slate-500 leading-snug max-w-lg">
          Reinstalling downloads the latest OrcaSlicer Linux AppImage (x86_64 only) and refreshes the bundled presets. The install runs in the background — your sessions keep working. The built-in JS slicer remains available either way.
        </p>
      </section>
    </div>
  );
}

// "Saving" panel — controls what Ctrl/Cmd+S does in the workspace.
//
// Three radio options:
//   • Local file (default) — keeps the historical behavior. Nothing
//     ever leaves the browser unless the user explicitly opts in.
//   • Cloud project — writes the scene into the currently-linked
//     hierarchical project via PUT /api/projects/{id}. Falls back to
//     local if no project is linked OR if the user is anonymous, so
//     the shortcut is never a silent no-op.
//   • Both — local download + cloud write. Best for users who want a
//     belt-and-suspenders workflow but don't want to remember two
//     shortcuts.
//
// The preference lives in localStorage and is read fresh at every
// Ctrl+S press (no hot-reload needed).
function SavingPanel() {
  const [behavior, setBehavior] = useState(() => getSaveBehavior());
  useEffect(() => subscribeSaveBehavior(setBehavior), []);

  const options = [
    {
      id: "local",
      label: "Local file (default)",
      hint: "Downloads a .forge.json to your computer. Nothing is sent to our servers. Your privacy-respecting choice.",
      icon: HardDrive,
    },
    {
      id: "cloud",
      label: "Cloud project",
      hint: "Writes the scene into the currently-open hierarchical project. Falls back to a local file if you haven't opened a project yet (or aren't signed in).",
      icon: CloudIcon,
    },
    {
      id: "both",
      label: "Both — local + cloud",
      hint: "Downloads the file AND saves to your linked project. Useful if you keep a personal archive but also want cross-device access.",
      icon: Save,
    },
  ];

  return (
    <div className="space-y-6 text-slate-200">
      <section>
        <h3 className="text-[11px] uppercase tracking-wider text-slate-400 font-semibold mb-2">
          Ctrl/Cmd+S behavior
        </h3>
        <p className="text-[11px] text-slate-400 mb-3 leading-snug max-w-lg">
          Choose what happens when you press <kbd className="px-1 py-0.5 bg-slate-800 border border-slate-700 rounded text-[10px] font-mono">Ctrl</kbd>+<kbd className="px-1 py-0.5 bg-slate-800 border border-slate-700 rounded text-[10px] font-mono">S</kbd> in the workspace. We default to <strong className="text-slate-200">local file</strong> — your projects stay on your machine until you choose otherwise.
        </p>
        <div className="space-y-1.5" data-testid="settings-save-behavior-group" role="radiogroup">
          {options.map((opt) => {
            const Icon = opt.icon;
            const active = behavior === opt.id;
            return (
              <label
                key={opt.id}
                data-testid={`settings-save-behavior-${opt.id}`}
                className={`flex items-start gap-3 p-3 rounded border cursor-pointer transition-colors ${
                  active
                    ? "bg-orange-500/10 border-orange-500/60"
                    : "bg-slate-950 border-slate-800 hover:border-slate-600"
                }`}
              >
                <input
                  type="radio"
                  name="save-behavior"
                  value={opt.id}
                  checked={active}
                  onChange={() => setSaveBehavior(opt.id)}
                  className="mt-0.5 accent-orange-500"
                  data-testid={`settings-save-behavior-radio-${opt.id}`}
                />
                <div className="flex-1">
                  <div className="flex items-center gap-1.5 text-[12px] font-semibold text-slate-100">
                    <Icon size={12} className={active ? "text-orange-300" : "text-slate-500"} />
                    {opt.label}
                  </div>
                  <p className="text-[10.5px] text-slate-400 leading-snug mt-0.5">{opt.hint}</p>
                </div>
              </label>
            );
          })}
        </div>
        <p className="mt-3 text-[10px] text-slate-500 leading-snug max-w-lg">
          You can always reach the OTHER option manually — the toolbar Save button still writes a local file regardless of this preference, and the Project Explorer's "Save here" still writes to the cloud regardless. This setting only controls the keyboard shortcut.
        </p>
      </section>
    </div>
  );
}
