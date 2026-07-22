// Iter-151.27 — Real 3-way segmented control replaces the iter-128
// no-op stub. Restores user access to switch between LithoForge's
// three production modes:
//   • lithophane — Beer-Lambert backlit stack (multi-filament)
//   • painting   — Solid-color surface (multi-filament, no backlight)
//   • bas_relief — Circular sculpted disc (Japanese Cork Art style,
//                  single-filament, optional wooden frame ring)
//
// Bas-Relief was inadvertently dropped when the ModeToggle became a
// stub during the LithoForge/AI merge — this restores parity.
import React from "react";

const OPTIONS = [
  { id: "lithophane", label: "Lithophane", hint: "Backlit multi-filament stack" },
  { id: "painting",   label: "Painting",   hint: "Solid-color multi-filament surface" },
  { id: "bas_relief", label: "Bas-Relief", hint: "Japanese Cork Art style — sculpted disc" },
];

export function ModeToggle({ mode, setMode, disabled = false }) {
  return (
    <div
      role="radiogroup"
      aria-label="Render mode"
      data-testid="litho-mode-toggle"
      className="grid grid-cols-3 gap-1 p-1 bg-zinc-950 border border-zinc-800"
    >
      {OPTIONS.map((opt) => {
        const active = mode === opt.id;
        return (
          <button
            key={opt.id}
            type="button"
            role="radio"
            aria-checked={active}
            data-testid={`litho-mode-${opt.id}`}
            onClick={() => setMode(opt.id)}
            disabled={disabled}
            title={opt.hint}
            className={`h-8 px-2 text-[10.5px] font-bold uppercase tracking-wider transition-colors disabled:opacity-40 disabled:cursor-not-allowed ${
              active
                ? "bg-orange-500/20 text-orange-200 border border-orange-500/60"
                : "bg-transparent text-zinc-500 border border-transparent hover:text-zinc-200 hover:bg-zinc-900"
            }`}
          >
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}

export default ModeToggle;
