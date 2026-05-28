// Hardware library dialog — pick an ISO metric fastener size and length,
// then drop it onto the build plate as a pre-grouped Fastener Pair
// (Bolt + Nut + bore + counterbore). Far faster than configuring the
// individual Inspector fields for every size.
//
// Layout:
//   - 2-column grid of grade pills (M3 / M4 / M5 / M6 / M8 / M10 / M12)
//   - Length chip row (filtered to sensible lengths for the grade)
//   - "Work thickness" override (optional — defaults to length - 5mm
//     so 5mm of shaft pokes past the nut for thread engagement)
//   - "Drop on plate" CTA — pushes through `addFastenerPair`
//
// Why a separate dialog instead of a Composites grid card? Because
// the grade × length matrix has ~60 cells — too many for inline
// buttons. A dialog scales cleanly when we add metric-fine pitches
// or imperial sizes later (already on the roadmap).
import React, { useState } from "react";
import { Bolt, X } from "lucide-react";
import { useScene } from "../../lib/store";
import {
  HARDWARE_TABLE,
  HARDWARE_LENGTHS_BY_GRADE,
  hardwareToFastenerOpts,
} from "../../lib/hardwareLibrary";

export default function HardwareLibraryDialog({ open, onClose }) {
  const addFastenerPair = useScene((s) => s.addFastenerPair);
  const [gradeId, setGradeId] = useState("M5");
  const [length, setLength] = useState(20);
  const [workOverride, setWorkOverride] = useState("");
  const spec = HARDWARE_TABLE.find((s) => s.id === gradeId) || HARDWARE_TABLE[2];
  const lengths = HARDWARE_LENGTHS_BY_GRADE[gradeId] || [];

  // When the grade changes, snap the chosen length to the nearest
  // legal length for the new grade so the picker never lands in an
  // invalid state (e.g. M3 grade × 80mm).
  const handleGradeChange = (id) => {
    setGradeId(id);
    const ls = HARDWARE_LENGTHS_BY_GRADE[id] || [];
    if (!ls.includes(length)) {
      // Pick the closest length in the new grade's list.
      let best = ls[0];
      let bestDiff = Math.abs(ls[0] - length);
      for (const L of ls) {
        const d = Math.abs(L - length);
        if (d < bestDiff) { best = L; bestDiff = d; }
      }
      setLength(best);
    }
  };

  const handleDrop = () => {
    const wt = workOverride === "" ? null : parseFloat(workOverride);
    const opts = hardwareToFastenerOpts(spec, length, Number.isFinite(wt) ? wt : null);
    addFastenerPair(opts);
    onClose();
  };

  if (!open) return null;
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm"
      data-testid="hardware-library-dialog"
      onClick={onClose}
    >
      <div
        className="w-[460px] max-w-[92vw] rounded-lg border border-slate-700 bg-slate-900 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-slate-800 px-4 py-3">
          <div className="flex items-center gap-2">
            <Bolt size={16} className="text-orange-400" />
            <h2 className="text-sm font-semibold text-slate-100">Hardware Library</h2>
            <span className="text-[10px] text-slate-500 uppercase tracking-wider">ISO metric</span>
          </div>
          <button
            data-testid="hardware-library-close-btn"
            onClick={onClose}
            className="text-slate-500 hover:text-slate-200"
          >
            <X size={16} />
          </button>
        </div>

        <div className="p-4 space-y-4">
          {/* Grade picker */}
          <div>
            <label className="text-[10px] uppercase tracking-wider text-slate-400 block mb-1.5">Grade</label>
            <div className="grid grid-cols-4 gap-1.5">
              {HARDWARE_TABLE.map((s) => (
                <button
                  key={s.id}
                  data-testid={`hardware-grade-${s.id}`}
                  onClick={() => handleGradeChange(s.id)}
                  className={`h-9 rounded border text-xs font-medium transition-all ${
                    gradeId === s.id
                      ? "border-orange-500 bg-orange-500/20 text-orange-300"
                      : "border-slate-700 bg-slate-950 text-slate-300 hover:border-slate-500"
                  }`}
                >
                  {s.id}
                </button>
              ))}
            </div>
            <div className="text-[10px] text-slate-500 mt-1.5 font-mono leading-tight">
              majorR {spec.majorR}mm · pitch {spec.pitch}mm · head ⌀{(spec.headR * 2).toFixed(1)}mm
            </div>
          </div>

          {/* Length picker */}
          <div>
            <label className="text-[10px] uppercase tracking-wider text-slate-400 block mb-1.5">Length</label>
            <div className="flex flex-wrap gap-1.5">
              {lengths.map((L) => (
                <button
                  key={L}
                  data-testid={`hardware-length-${L}`}
                  onClick={() => setLength(L)}
                  className={`h-7 px-2.5 rounded border text-[11px] font-medium transition-all ${
                    length === L
                      ? "border-orange-500 bg-orange-500/20 text-orange-300"
                      : "border-slate-700 bg-slate-950 text-slate-300 hover:border-slate-500"
                  }`}
                >
                  {L}
                </button>
              ))}
            </div>
          </div>

          {/* Work thickness override */}
          <div>
            <label className="text-[10px] uppercase tracking-wider text-slate-400 block mb-1.5">
              Work thickness <span className="text-slate-500 normal-case">(optional override, mm)</span>
            </label>
            <input
              data-testid="hardware-work-thickness"
              type="number"
              placeholder={`auto: ${Math.max(2, length - 5)}mm`}
              value={workOverride}
              onChange={(e) => setWorkOverride(e.target.value)}
              className="w-full h-7 bg-slate-950 border border-slate-700 rounded px-2 text-xs text-slate-200 placeholder-slate-600"
            />
            <div className="text-[10px] text-slate-500 mt-1">
              How thick is the part this fastener clamps? Defaults to length−5mm so the shaft pokes past the nut.
            </div>
          </div>

          {/* Preview summary */}
          <div className="rounded border border-slate-800 bg-slate-950 p-2 text-[11px] font-mono text-slate-400" data-testid="hardware-preview">
            Drop <span className="text-orange-300">{spec.id}×{length}</span> Fastener Pair · bolt ⌀{(spec.majorR * 2).toFixed(1)}mm × {length}mm · pitch {spec.pitch}mm · pre-grouped (Bolt + Bore + Counterbore + Nut)
          </div>

          {/* CTA */}
          <button
            data-testid="hardware-drop-btn"
            onClick={handleDrop}
            className="w-full h-9 rounded bg-orange-500 hover:bg-orange-400 text-slate-950 text-sm font-semibold transition-colors"
          >
            Drop on plate
          </button>
        </div>
      </div>
    </div>
  );
}
