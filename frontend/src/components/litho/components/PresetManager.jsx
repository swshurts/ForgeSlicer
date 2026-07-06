import React, { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { Bookmark, Save, Trash2, Cloud } from "lucide-react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../../ui/select";
import { Input } from "../../ui/input";
import { Button } from "../../ui/button";
import { DEFAULT_EDITS } from "./ImageEditPanel";
import {
  createCloudPreset,
  deleteCloudPreset,
  importCloudPresets,
  listCloudPresets,
} from "../lib/api";
import { useAuth } from "../lib/auth";

const STORAGE_KEY = "lithoforge.presets.v1";
const PRESET_VERSION = 1;

// Built-in presets ship every time. They never appear in localStorage and
// can't be deleted. Each one captures the full snapshot a user would
// realistically want for a given subject.
export const BUILTIN_PRESETS = [
  {
    id: "builtin-portrait",
    name: "Portrait · Warm skin",
    builtin: true,
    vibrancy: 0.3,
    config: {
      width_mm: 100,
      height_mm: 130,
      thickness_mm: 3.6,
      border_mm: 2,
      layer_height_mm: 0.12,
      max_swaps: 6,
      geometry: "flat",
      curve_radius_mm: 80,
      render_mode: "painting",
      relief: 0.35,
    },
    filaments: [
      { name: "White",   hex: "#f5f5f5", td: 5.0 },
      { name: "Cream",   hex: "#f2e7c3", td: 4.5 },
      { name: "Skin",    hex: "#e8b998", td: 3.8 },
      { name: "Orange",  hex: "#f57f20", td: 1.5 },
      { name: "Red",     hex: "#d01e32", td: 1.2 },
      { name: "Brown",   hex: "#78350f", td: 1.0 },
      { name: "Key",     hex: "#111111", td: 0.8 },
    ],
  },
  {
    id: "builtin-landscape",
    name: "Landscape · Vibrant",
    builtin: true,
    vibrancy: 0.85,
    config: {
      width_mm: 150,
      height_mm: 100,
      thickness_mm: 3.6,
      border_mm: 2,
      layer_height_mm: 0.12,
      max_swaps: 7,
      geometry: "flat",
      curve_radius_mm: 80,
      render_mode: "painting",
      relief: 0.5,
    },
    filaments: [
      { name: "White",   hex: "#f5f5f5", td: 5.0 },
      { name: "Yellow",  hex: "#eab308", td: 1.8 },
      { name: "Orange",  hex: "#f57f20", td: 1.5 },
      { name: "Red",     hex: "#d01e32", td: 1.2 },
      { name: "Green",   hex: "#2ea043", td: 1.5 },
      { name: "Teal",    hex: "#0f766e", td: 1.3 },
      { name: "Blue",    hex: "#1e45a8", td: 1.3 },
      { name: "Key",     hex: "#111111", td: 0.8 },
    ],
  },
  {
    id: "builtin-lithophane",
    name: "Lithophane · Backlit window",
    builtin: true,
    vibrancy: 0.5,
    config: {
      width_mm: 100,
      height_mm: 100,
      thickness_mm: 4.0,
      border_mm: 3,
      layer_height_mm: 0.08,
      max_swaps: 5,
      geometry: "flat",
      curve_radius_mm: 80,
      render_mode: "lithophane",
      relief: 0.5,
    },
    filaments: [
      { name: "White",   hex: "#f5f5f5", td: 5.0 },
      { name: "Yellow",  hex: "#eab308", td: 1.8 },
      { name: "Red",     hex: "#d01e32", td: 1.2 },
      { name: "Magenta", hex: "#ec4899", td: 1.5 },
      { name: "Blue",    hex: "#1e45a8", td: 1.3 },
      { name: "Key",     hex: "#111111", td: 0.8 },
    ],
  },
];

const loadUserPresets = () => {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!parsed || parsed.version !== PRESET_VERSION) return [];
    return Array.isArray(parsed.presets) ? parsed.presets : [];
  } catch {
    return [];
  }
};

const saveUserPresets = (presets) => {
  try {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ version: PRESET_VERSION, presets })
    );
  } catch (e) {
    toast.error("Could not save preset (storage full?)");
  }
};

export const PresetManager = ({
  config,
  setConfig,
  filaments,
  setFilaments,
  edits,
  setEdits,
  vibrancy,
  setVibrancy,
  disabled,
}) => {
  const { user } = useAuth();
  const isLoggedIn = !!user;

  const [localPresets, setLocalPresets] = useState(loadUserPresets);
  const [cloudPresets, setCloudPresets] = useState([]);
  const [showSave, setShowSave] = useState(false);
  const [name, setName] = useState("");
  const [selectedId, setSelectedId] = useState("");
  // Skip the very first effect call so we don't write an empty array to
  // localStorage on mount — Safari Private Browsing throws on setItem.
  const persistedOnce = React.useRef(false);
  const importedRef = React.useRef(false);

  useEffect(() => {
    if (!persistedOnce.current) {
      persistedOnce.current = true;
      return;
    }
    saveUserPresets(localPresets);
  }, [localPresets]);

  // When the user logs in, fetch their cloud presets AND offer to migrate
  // any anonymous-mode localStorage presets they've already saved.
  useEffect(() => {
    if (!isLoggedIn) {
      setCloudPresets([]);
      importedRef.current = false;
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const cloud = await listCloudPresets();
        if (cancelled) return;
        const mapped = cloud.map((p) => ({
          id: p.preset_id,
          name: p.name,
          builtin: false,
          cloud: true,
          vibrancy: p.vibrancy,
          config: p.config,
          filaments: p.filaments,
        }));
        setCloudPresets(mapped);
        // One-shot import: push any localStorage presets up to the cloud
        // the first time this user logs in on this device.
        if (!importedRef.current && localPresets.length > 0) {
          importedRef.current = true;
          const payload = localPresets.map((p) => ({
            name: p.name,
            config: p.config,
            filaments: p.filaments,
            vibrancy: p.vibrancy,
          }));
          try {
            const imported = await importCloudPresets(payload);
            if (imported.length > 0) {
              setCloudPresets((cur) => [
                ...cur,
                ...imported.map((p) => ({
                  id: p.preset_id,
                  name: p.name,
                  builtin: false,
                  cloud: true,
                  vibrancy: p.vibrancy,
                  config: p.config,
                  filaments: p.filaments,
                })),
              ]);
              toast.success(
                `Imported ${imported.length} local preset${
                  imported.length === 1 ? "" : "s"
                } to your account`
              );
            }
          } catch {
            /* silent — user can re-save manually if needed */
          }
        }
      } catch {
        /* ignore — cloud load failures shouldn't break the local UX */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [isLoggedIn, localPresets]);

  const userPresets = isLoggedIn ? cloudPresets : localPresets;

  const allPresets = useMemo(
    () => [...BUILTIN_PRESETS, ...userPresets],
    [userPresets]
  );

  const apply = (preset) => {
    if (!preset) return;
    setConfig({ ...preset.config });
    setFilaments(preset.filaments.map((f) => ({ ...f })));
    setVibrancy(typeof preset.vibrancy === "number" ? preset.vibrancy : 0.5);
    if (setEdits) setEdits({ ...DEFAULT_EDITS });
    toast.success(`Loaded preset · ${preset.name}`);
  };

  const onSelect = (id) => {
    setSelectedId(id);
    const preset = allPresets.find((p) => p.id === id);
    apply(preset);
  };

  const handleSave = async () => {
    const trimmed = name.trim();
    if (!trimmed) {
      toast.error("Name your preset first");
      return;
    }
    if (allPresets.some((p) => p.name === trimmed)) {
      toast.error("A preset with that name already exists");
      return;
    }
    const payload = {
      name: trimmed,
      vibrancy,
      config: { ...config },
      filaments: filaments.map((f) => ({ ...f })),
    };
    if (isLoggedIn) {
      try {
        const created = await createCloudPreset(payload);
        const preset = {
          id: created.preset_id,
          name: created.name,
          builtin: false,
          cloud: true,
          vibrancy: created.vibrancy,
          config: created.config,
          filaments: created.filaments,
        };
        setCloudPresets((cur) => [preset, ...cur]);
        setSelectedId(preset.id);
        toast.success(`Saved preset · ${trimmed} (synced)`);
      } catch (e) {
        toast.error(e?.response?.data?.detail || "Could not save preset");
        return;
      }
    } else {
      const preset = {
        id: `user-${Date.now()}`,
        name: trimmed,
        builtin: false,
        cloud: false,
        ...payload,
      };
      setLocalPresets((cur) => [...cur, preset]);
      setSelectedId(preset.id);
      toast.success(`Saved preset · ${trimmed}`);
    }
    setName("");
    setShowSave(false);
  };

  const handleDelete = async () => {
    const preset = userPresets.find((p) => p.id === selectedId);
    if (!preset) {
      toast.error("Pick one of your own presets to delete");
      return;
    }
    if (preset.cloud) {
      try {
        await deleteCloudPreset(preset.id);
        setCloudPresets((cur) => cur.filter((p) => p.id !== preset.id));
      } catch {
        toast.error("Could not delete preset");
        return;
      }
    } else {
      setLocalPresets((cur) => cur.filter((p) => p.id !== preset.id));
    }
    setSelectedId("");
    toast.success(`Deleted preset · ${preset.name}`);
  };

  const canDelete =
    !!selectedId && userPresets.some((p) => p.id === selectedId);

  return (
    <div className="space-y-3" data-testid="preset-manager">
      <div className="flex items-center justify-between">
        <Label className="text-[10px] font-bold uppercase tracking-[0.18em] text-zinc-500 flex items-center gap-1.5">
          <Bookmark className="w-3 h-3" />
          Presets
          {isLoggedIn && (
            <span
              className="inline-flex items-center gap-0.5 text-[8px] tracking-[0.12em] text-emerald-400/80 normal-case"
              title="Synced to your account"
            >
              <Cloud className="w-2.5 h-2.5" strokeWidth={2} />
              synced
            </span>
          )}
        </Label>
        <button
          data-testid="preset-save-toggle"
          onClick={() => setShowSave((s) => !s)}
          disabled={disabled}
          className="text-[10px] font-mono uppercase tracking-[0.14em] text-zinc-500 hover:text-zinc-100 transition-colors disabled:opacity-40 flex items-center gap-1"
        >
          <Save className="w-3 h-3" />
          {showSave ? "cancel" : "save current"}
        </button>
      </div>

      <Select
        value={selectedId}
        onValueChange={onSelect}
        disabled={disabled}
      >
        <SelectTrigger
          data-testid="preset-select"
          className="h-9 rounded-none border border-zinc-800 bg-zinc-950 text-xs font-mono"
        >
          <SelectValue placeholder="Load a preset…" />
        </SelectTrigger>
        <SelectContent
          className="rounded-none border-zinc-800 bg-zinc-950 font-mono text-xs"
        >
          {BUILTIN_PRESETS.length > 0 && (
            <div className="px-2 py-1 text-[9px] uppercase tracking-[0.18em] text-zinc-600">
              Built-in
            </div>
          )}
          {BUILTIN_PRESETS.map((p) => (
            <SelectItem
              key={p.id}
              value={p.id}
              data-testid={`preset-option-${p.id}`}
              className="text-xs"
            >
              {p.name}
            </SelectItem>
          ))}
          {userPresets.length > 0 && (
            <div className="px-2 py-1 text-[9px] uppercase tracking-[0.18em] text-zinc-600 border-t border-zinc-800 mt-1">
              Yours
            </div>
          )}
          {userPresets.map((p) => (
            <SelectItem
              key={p.id}
              value={p.id}
              data-testid={`preset-option-${p.id}`}
              className="text-xs"
            >
              {p.name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      {showSave && (
        <div className="space-y-2 border border-zinc-800 p-3" data-testid="preset-save-form">
          <Input
            data-testid="preset-name-input"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Preset name (e.g. Sunset · 7 swaps)"
            className="h-8 rounded-none bg-zinc-950 border-zinc-800 text-xs font-mono"
            onKeyDown={(e) => {
              if (e.key === "Enter") handleSave();
            }}
          />
          <div className="flex gap-2">
            <Button
              data-testid="preset-save-confirm"
              onClick={handleSave}
              disabled={disabled || !name.trim()}
              className="flex-1 h-8 rounded-none bg-zinc-100 text-zinc-950 hover:bg-zinc-300 text-[10px] uppercase tracking-[0.18em] font-bold"
            >
              Snapshot
            </Button>
          </div>
          <div className="text-[9px] font-mono text-zinc-600 leading-snug">
            Captures geometry, palette, render mode &amp; vibrancy. Image
            edits stay tied to the current photo.
          </div>
        </div>
      )}

      {canDelete && (
        <button
          data-testid="preset-delete"
          onClick={handleDelete}
          disabled={disabled}
          className="w-full flex items-center justify-center gap-1.5 text-[10px] font-mono uppercase tracking-[0.18em] text-zinc-500 hover:text-red-400 transition-colors border border-zinc-800 hover:border-red-900/50 h-7"
        >
          <Trash2 className="w-3 h-3" />
          Delete this preset
        </button>
      )}
    </div>
  );
};

// Lightweight Label since we don't want to import the shadcn one twice
const Label = ({ children, className }) => (
  <span className={className}>{children}</span>
);
