import React from "react";

export const LayerTimeline = ({ timeline, totalLayers }) => {
  if (!timeline) {
    return (
      <div
        className="h-10 border-t border-zinc-800 flex items-center justify-center text-[10px] font-mono uppercase tracking-[0.25em] text-zinc-600"
        data-testid="layer-timeline-empty"
      >
        LAYER TIMELINE — WAITING FOR OPTIMIZATION
      </div>
    );
  }

  return (
    <div
      className="border-t border-zinc-800 px-5 py-3 flex items-center gap-4"
      data-testid="layer-timeline"
    >
      <div className="text-[10px] font-bold uppercase tracking-[0.2em] text-zinc-500 whitespace-nowrap">
        Layer Stack
      </div>
      <div className="flex-1 flex h-5 border border-zinc-800">
        {timeline.map((t, i) => {
          const pct = (t.layers / totalLayers) * 100;
          return (
            <div
              key={`${t.name}-${i}`}
              className="relative group"
              style={{ width: `${pct}%`, background: t.color }}
              title={`${t.name} · ${t.layers} layers · ${t.start_z_mm.toFixed(
                2
              )}–${t.end_z_mm.toFixed(2)}mm`}
            >
              <div className="absolute inset-0 hover:bg-white/10 transition-colors duration-150" />
              {pct > 6 && (
                <span className="absolute inset-0 flex items-center justify-center font-mono text-[9px] font-bold mix-blend-difference text-white">
                  {t.name.toUpperCase()}
                </span>
              )}
            </div>
          );
        })}
      </div>
      <div className="font-mono text-[10px] text-zinc-500 whitespace-nowrap tabular-nums">
        0 → {totalLayers} · {timeline.reduce(
          (s, t) => s + t.layers,
          0
        )}{" "}
        layers
      </div>
    </div>
  );
};
