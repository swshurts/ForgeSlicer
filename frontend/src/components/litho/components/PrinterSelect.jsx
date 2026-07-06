import React, { useEffect, useMemo, useState } from "react";
import { Check, ChevronsUpDown } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "../../ui/popover";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "../../ui/command";
import { listPrinters } from "../lib/api";

const FAMILY_LABEL = {
  orca: "OrcaSlicer / Bambu Studio family",
  prusa: "PrusaSlicer (Prusa)",
  super: "SuperSlicer (Voron, Klipper DIY)",
  cura: "Cura (Ultimaker, classic Ender)",
  marlin: "Marlin direct G-code",
};

/** Printer profile picker — searchable combobox grouped by slicer family.
 *
 *  Props:
 *    value:    currently selected printer_id
 *    onChange: (printer_id) => void
 *    disabled: boolean
 *    testId:   data-testid prefix (default "printer-select")
 */
export const PrinterSelect = ({
  value,
  onChange,
  disabled,
  testId = "printer-select",
}) => {
  const [printers, setPrinters] = useState([]);
  const [loaded, setLoaded] = useState(false);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    let cancelled = false;
    listPrinters()
      .then((data) => {
        if (!cancelled) {
          setPrinters(data);
          setLoaded(true);
        }
      })
      .catch(() => {
        if (!cancelled) setLoaded(true);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const grouped = useMemo(() => {
    const out = {};
    for (const p of printers) {
      (out[p.slicer_family] = out[p.slicer_family] || []).push(p);
    }
    return out;
  }, [printers]);

  const current = printers.find((p) => p.id === (value || "generic_orca"));

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          disabled={disabled || !loaded}
          data-testid={testId}
          aria-expanded={open}
          className="w-full h-9 px-3 flex items-center justify-between gap-2 rounded-none bg-zinc-950 border border-zinc-800 font-mono text-xs text-zinc-100 hover:border-zinc-600 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
        >
          <span className="truncate text-left">
            {current
              ? `${current.name}${current.multi_tool ? " · AMS/MMU" : ""}`
              : "Choose printer…"}
          </span>
          <ChevronsUpDown className="w-3.5 h-3.5 flex-shrink-0 text-zinc-500" />
        </button>
      </PopoverTrigger>
      <PopoverContent
        className="w-[340px] p-0 rounded-none bg-zinc-950 border-zinc-800"
        align="start"
      >
        <Command className="rounded-none bg-zinc-950">
          <CommandInput
            placeholder="Search printers… (e.g. K2, MK4, Kobra)"
            data-testid={`${testId}-search`}
            className="font-mono text-xs"
          />
          <CommandList className="max-h-[50vh]">
            <CommandEmpty className="font-mono text-[10px] text-zinc-500 py-4 text-center">
              No printer found — pick a Generic profile.
            </CommandEmpty>
            {Object.entries(grouped).map(([fam, list]) => (
              <CommandGroup
                key={fam}
                heading={FAMILY_LABEL[fam] || fam}
                className="[&_[cmdk-group-heading]]:font-mono [&_[cmdk-group-heading]]:text-[9px] [&_[cmdk-group-heading]]:uppercase [&_[cmdk-group-heading]]:tracking-[0.18em] [&_[cmdk-group-heading]]:text-zinc-500"
              >
                {list.map((p) => (
                  <CommandItem
                    key={p.id}
                    value={`${p.manufacturer} ${p.name} ${p.id}`}
                    onSelect={() => {
                      onChange(p.id);
                      setOpen(false);
                    }}
                    data-testid={`${testId}-option-${p.id}`}
                    className="font-mono text-xs rounded-none cursor-pointer aria-selected:bg-zinc-800"
                  >
                    <Check
                      className={`w-3 h-3 mr-1.5 flex-shrink-0 ${
                        p.id === (value || "generic_orca")
                          ? "opacity-100 text-emerald-400"
                          : "opacity-0"
                      }`}
                    />
                    <span className="flex-1 truncate">
                      {p.name}
                      {p.multi_tool ? (
                        <span className="text-amber-300"> · AMS/MMU</span>
                      ) : null}
                    </span>
                    <span className="ml-2 text-[9px] text-zinc-600 tabular-nums flex-shrink-0">
                      {p.bed_x_mm}×{p.bed_y_mm}
                    </span>
                  </CommandItem>
                ))}
              </CommandGroup>
            ))}
          </CommandList>
        </Command>
      </PopoverContent>
      {current && (
        <input type="hidden" value={current.id} data-testid={`${testId}-current`} />
      )}
    </Popover>
  );
};
