import React, { useEffect, useState } from "react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../../ui/select";
import { listPrinters } from "../lib/api";

const NOZZLE_HINT = {
  0.2: "max detail · slow",
  0.25: "fine detail",
  0.4: "standard",
  0.6: "fast · less detail",
  0.8: "draft · coarse",
};

/** Nozzle diameter dropdown — options come from the selected printer's
 *  profile (`nozzle_sizes_mm`). When the printer changes and the current
 *  nozzle isn't available on the new machine, we auto-snap to its
 *  default nozzle.
 *
 *  Props:
 *    printerId: selected printer profile id
 *    value:     current nozzle diameter (number, mm)
 *    onChange:  (nozzle_mm: number) => void
 *    disabled:  boolean
 *    testId:    data-testid prefix (default "nozzle-select")
 */
export const NozzleSelect = ({
  printerId,
  value,
  onChange,
  disabled,
  testId = "nozzle-select",
}) => {
  const [profile, setProfile] = useState(null);

  useEffect(() => {
    let cancelled = false;
    listPrinters()
      .then((printers) => {
        if (cancelled) return;
        const p =
          printers.find((x) => x.id === (printerId || "generic_orca")) ||
          printers.find((x) => x.id === "generic_orca");
        setProfile(p || null);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [printerId]);

  const sizes = profile?.nozzle_sizes_mm || [0.4];

  // Snap to the printer's default nozzle when the current value isn't
  // offered for this machine.
  useEffect(() => {
    if (!profile) return;
    if (!sizes.some((s) => Math.abs(s - value) < 1e-9)) {
      onChange(profile.default_nozzle_mm || 0.4);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profile]);

  return (
    <Select
      value={String(value ?? 0.4)}
      onValueChange={(v) => onChange(parseFloat(v))}
      disabled={disabled || !profile}
    >
      <SelectTrigger
        data-testid={testId}
        className="rounded-none bg-zinc-950 border-zinc-800 font-mono text-xs h-9"
      >
        <SelectValue placeholder="Nozzle…" />
      </SelectTrigger>
      <SelectContent className="rounded-none bg-zinc-950 border-zinc-800">
        {sizes.map((s) => (
          <SelectItem
            key={s}
            value={String(s)}
            data-testid={`${testId}-option-${String(s).replace(".", "-")}`}
            className="font-mono text-xs rounded-none"
          >
            {s.toFixed(2)} mm{NOZZLE_HINT[s] ? ` (${NOZZLE_HINT[s]})` : ""}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
};
