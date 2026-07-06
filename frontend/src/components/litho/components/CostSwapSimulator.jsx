/**
 * CostSwapSimulator — interactive "what if I used X filament instead?"
 *
 * Renders a list of per-filament cost rows from result.cost_estimate.
 * Each row has a swap button that queries /api/filament-library/search
 * by hex for the 6 closest alternative SKUs, displays them with their
 * material/brand/price, and shows the cost delta vs the original.
 *
 * Picking a swap stores an override in component state (per-slot map of
 * slot → {price_per_kg_usd, name, hex}); the totals row at the top
 * recalculates `swapped_total` purely client-side using each filament's
 * weight_g × overridden price_per_kg_usd / 1000.
 *
 * No backend mutation — the override is purely UI sandbox, designed to
 * help users decide what to buy. They take the chosen filament name &
 * hex back to the palette editor manually.
 */
import React, { useCallback, useEffect, useState } from "react";
import { ArrowRightLeft, Check, X, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { searchManufacturerByHex } from "../lib/api";

const fmtUsd = (v) => `$${v.toFixed(2)}`;

const DEFAULT_PRICE_FALLBACK = 25.0; // PLA baseline if API result missing price

const computeRowCost = (row, override) => {
  const price = override?.price_per_kg_usd ?? DEFAULT_PRICE_FALLBACK;
  return row.weight_g * (price / 1000.0);
};

export const CostSwapSimulator = ({ costEstimate }) => {
  const [overrides, setOverrides] = useState({});  // slot → alternative
  const [openSlot, setOpenSlot] = useState(null);
  const [alternatives, setAlternatives] = useState([]);
  const [loading, setLoading] = useState(false);

  // Reset overrides when the underlying job changes.
  useEffect(() => {
    setOverrides({});
    setOpenSlot(null);
  }, [costEstimate]);

  const fetchAlternatives = useCallback(async (row) => {
    setLoading(true);
    setAlternatives([]);
    try {
      const data = await searchManufacturerByHex(row.hex, {
        algo: "de76", limit: 8, material: "PLA",
      });
      setAlternatives(data.results || []);
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Could not load alternatives");
    } finally {
      setLoading(false);
    }
  }, []);

  const handleOpenSwap = useCallback((row) => {
    if (openSlot === row.slot) {
      setOpenSlot(null);
      return;
    }
    setOpenSlot(row.slot);
    fetchAlternatives(row);
  }, [openSlot, fetchAlternatives]);

  const handlePick = useCallback((row, alt) => {
    setOverrides((m) => ({
      ...m,
      [row.slot]: {
        price_per_kg_usd: alt.price_per_kg_usd ?? DEFAULT_PRICE_FALLBACK,
        name: alt.name,
        brand: alt.brand,
        hex: alt.hex,
        delta_e: alt.delta_e,
      },
    }));
    setOpenSlot(null);
    toast.success(`Swapped slot ${row.slot + 1}`, {
      description: `${alt.brand} ${alt.name} · ${fmtUsd(alt.price_per_kg_usd ?? DEFAULT_PRICE_FALLBACK)}/kg`,
    });
  }, []);

  const handleReset = useCallback((slot) => {
    setOverrides((m) => {
      const next = { ...m };
      delete next[slot];
      return next;
    });
  }, []);

  if (!costEstimate) return null;

  // Compute the recalculated total if any override is active.
  const hasOverrides = Object.keys(overrides).length > 0;
  let swappedTotal = 0;
  let originalTotal = 0;
  costEstimate.per_filament.forEach((row) => {
    originalTotal += row.cost_usd;
    swappedTotal += overrides[row.slot]
      ? computeRowCost(row, overrides[row.slot])
      : row.cost_usd;
  });
  const delta = swappedTotal - originalTotal;
  const deltaPct = originalTotal > 0 ? (delta / originalTotal) * 100 : 0;

  return (
    <div className="space-y-2" data-testid="cost-swap-simulator">
      {costEstimate.per_filament.map((row) => {
        const ov = overrides[row.slot];
        const effectivePrice = ov?.price_per_kg_usd ?? DEFAULT_PRICE_FALLBACK;
        const newCost = row.weight_g * (effectivePrice / 1000);
        const rowDelta = newCost - row.cost_usd;
        const isOpen = openSlot === row.slot;
        return (
          <div key={`${row.name}-${row.slot}`} className="space-y-1">
            <div
              className="flex items-center gap-2 font-mono text-[10px]"
              data-testid={`cost-row-${row.slot}`}
            >
              <div
                className="w-2.5 h-2.5 border border-zinc-700"
                style={{ background: ov?.hex || row.hex }}
              />
              <span className="text-zinc-400 flex-1 truncate" title={ov ? `${ov.brand} · ${ov.name}` : row.name}>
                {ov ? `${ov.brand} · ${ov.name}` : row.name}
              </span>
              <span className="text-zinc-500 tabular-nums w-12 text-right">
                {row.weight_g.toFixed(1)}g
              </span>
              <span
                className={`tabular-nums w-14 text-right ${
                  ov ? (rowDelta < 0 ? "text-emerald-300" : "text-rose-300") : "text-amber-300/80"
                }`}
                data-testid={`cost-row-cost-${row.slot}`}
              >
                {fmtUsd(ov ? newCost : row.cost_usd)}
              </span>
              <button
                type="button"
                onClick={() => handleOpenSwap(row)}
                title="See cheaper alternatives"
                data-testid={`cost-swap-btn-${row.slot}`}
                className={`w-5 h-5 flex items-center justify-center border ${
                  isOpen
                    ? "border-amber-400 text-amber-200"
                    : "border-zinc-700 text-zinc-500 hover:text-amber-200 hover:border-amber-400/60"
                } transition-colors`}
              >
                <ArrowRightLeft size={10} />
              </button>
              {ov && (
                <button
                  type="button"
                  onClick={() => handleReset(row.slot)}
                  title="Reset to original"
                  data-testid={`cost-swap-reset-${row.slot}`}
                  className="w-5 h-5 flex items-center justify-center border border-zinc-700 text-zinc-500 hover:text-rose-300 hover:border-rose-400/60 transition-colors"
                >
                  <X size={10} />
                </button>
              )}
            </div>

            {isOpen && (
              <div
                className="bg-zinc-950 border border-amber-400/30 p-2 space-y-1"
                data-testid={`cost-swap-popover-${row.slot}`}
              >
                {loading ? (
                  <div className="flex items-center gap-2 px-2 py-3 text-[10px] font-mono text-zinc-500">
                    <Loader2 size={12} className="animate-spin" /> Loading alternatives…
                  </div>
                ) : alternatives.length === 0 ? (
                  <div className="px-2 py-3 text-[10px] font-mono text-zinc-600 text-center">
                    No alternatives found
                  </div>
                ) : (
                  alternatives.slice(0, 6).map((alt, i) => {
                    const altPrice = alt.price_per_kg_usd ?? DEFAULT_PRICE_FALLBACK;
                    const altCost = row.weight_g * (altPrice / 1000);
                    const altDelta = altCost - row.cost_usd;
                    return (
                      <button
                        key={alt.id || i}
                        type="button"
                        onClick={() => handlePick(row, alt)}
                        data-testid={`cost-swap-alt-${row.slot}-${i}`}
                        className="w-full flex items-center gap-2 px-2 py-1.5 hover:bg-zinc-900 group text-left"
                      >
                        <div
                          className="w-3 h-3 border border-zinc-700 flex-shrink-0"
                          style={{ background: alt.hex }}
                        />
                        <div className="flex-1 min-w-0">
                          <div className="font-mono text-[10px] text-zinc-200 truncate">
                            {alt.brand} · {alt.name}
                          </div>
                          <div className="font-mono text-[9px] text-zinc-500">
                            {alt.material} · ΔE {alt.delta_e?.toFixed(1) ?? "—"} · {fmtUsd(altPrice)}/kg
                          </div>
                        </div>
                        <div className="text-right flex-shrink-0">
                          <div className="font-mono text-[10px] text-zinc-300 tabular-nums">
                            {fmtUsd(altCost)}
                          </div>
                          <div
                            className={`font-mono text-[9px] tabular-nums ${
                              altDelta < 0 ? "text-emerald-400" : altDelta > 0 ? "text-rose-400" : "text-zinc-500"
                            }`}
                          >
                            {altDelta === 0 ? "—" : `${altDelta < 0 ? "−" : "+"}${fmtUsd(Math.abs(altDelta))}`}
                          </div>
                        </div>
                        <Check
                          size={12}
                          className="text-emerald-400 opacity-0 group-hover:opacity-100 flex-shrink-0"
                        />
                      </button>
                    );
                  })
                )}
              </div>
            )}
          </div>
        );
      })}

      {hasOverrides && (
        <div
          className="mt-2 pt-2 border-t border-zinc-800 flex items-center justify-between font-mono text-[10px]"
          data-testid="cost-swap-summary"
        >
          <span className="text-zinc-400 uppercase tracking-[0.15em]">
            With swaps
          </span>
          <div className="flex items-center gap-3">
            <span className="text-zinc-200 tabular-nums" data-testid="cost-swap-total">
              {fmtUsd(swappedTotal)}
            </span>
            <span
              className={`tabular-nums px-2 py-0.5 border text-[9px] uppercase tracking-[0.15em] ${
                delta < 0
                  ? "border-emerald-500/40 text-emerald-300 bg-emerald-500/10"
                  : delta > 0
                  ? "border-rose-500/40 text-rose-300 bg-rose-500/10"
                  : "border-zinc-700 text-zinc-500"
              }`}
              data-testid="cost-swap-delta"
            >
              {delta === 0 ? "—" : `${delta < 0 ? "−" : "+"}${fmtUsd(Math.abs(delta))} · ${deltaPct.toFixed(0)}%`}
            </span>
          </div>
        </div>
      )}
    </div>
  );
};
