/**
 * TriangleFromAngles — small calculator UI that lets a user describe a
 * triangle by SAS (side–angle–side), ASA (angle–side–angle), or SSS
 * (three sides) instead of the raw base/height/apex-shift trio.
 *
 * On "Apply", the calculator writes the derived `base`, `height`, and
 * `apexShift` into the object's dims via the parent-supplied
 * `updateDims` action — so the internal representation stays
 * unchanged, we just give users a nicer way to enter it.
 *
 * PDF §2a Release-A behaviour: any triangle can be minimally described
 * by ASA or SAS, and users shouldn't be restricted to right/isosceles.
 */
import React, { useMemo, useState } from "react";

const DEG = Math.PI / 180;

function deriveFromSAS(sideA, angleCdeg, sideB) {
  // Place vertex C at origin. Side A goes along +X from C, side B at
  // angle C above it. Third vertex is the apex; the opposite side
  // (c) becomes the base of our internal representation.
  const C = angleCdeg * DEG;
  const B = { x: sideA, y: 0 };
  const A = { x: sideB * Math.cos(C), y: sideB * Math.sin(C) };
  const O = { x: 0, y: 0 };
  return _packBase(O, B, A);
}

function deriveFromASA(angleAdeg, sideC, angleBdeg) {
  // Place vertex A at (0,0), vertex B at (c, 0). Third vertex is the
  // intersection of the two rays leaving A/B at their respective
  // angles.
  const A = angleAdeg * DEG;
  const B = angleBdeg * DEG;
  if (A + B >= Math.PI - 1e-4) return null;   // degenerate
  const tanA = Math.tan(A), tanB = Math.tan(B);
  const x = sideC * tanB / (tanA + tanB);
  const y = x * tanA;
  return _packBase({ x: 0, y: 0 }, { x: sideC, y: 0 }, { x, y });
}

function deriveFromSSS(a, b, c) {
  // Place vertex A at (0,0), vertex B at (c, 0). Third vertex satisfies
  // |AC|=b, |BC|=a. Solve: x = (b² - a² + c²) / (2c), y = √(b² - x²).
  if (a + b <= c || b + c <= a || c + a <= b) return null; // triangle inequality
  const x = (b * b - a * a + c * c) / (2 * c);
  const y2 = b * b - x * x;
  if (y2 < 0) return null;
  return _packBase({ x: 0, y: 0 }, { x: c, y: 0 }, { x, y: Math.sqrt(y2) });
}

function _packBase(A, B, C) {
  // Given three vertices with A-B along the +X axis, produce our
  // internal representation:
  //   base       = |AB|
  //   height     = C.y (perpendicular distance to AB, absolute)
  //   apexShift  = C.x - (A.x + B.x)/2   (apex offset from base midpoint)
  const base = Math.hypot(B.x - A.x, B.y - A.y);
  const height = Math.abs(C.y);
  const apexShift = C.x - (A.x + B.x) / 2;
  return { base: +base.toFixed(3), height: +height.toFixed(3), apexShift: +apexShift.toFixed(3) };
}

// Small labelled numeric input. Extracted out of the exported component
// so React doesn't tear down + rebuild it on every parent render (which
// would blur the field while the user is typing).
function NumInput({ label, value, onChange, step = 1, min = 0.1, suffix, testid }) {
  return (
    <label className="flex flex-col gap-0.5" data-testid={testid}>
      <span className="text-[9px] text-slate-500 uppercase tracking-wider">{label}</span>
      <input
        type="number"
        value={value}
        step={step}
        min={min}
        onChange={(e) => onChange(parseFloat(e.target.value) || 0)}
        className="h-6 px-1.5 bg-slate-900 border border-slate-700 rounded text-[11px] text-slate-200 focus:outline-none focus:border-orange-500"
      />
      {suffix && <span className="text-[9px] text-slate-500">{suffix}</span>}
    </label>
  );
}

export function TriangleFromAngles({ objId, updateDims }) {
  const [mode, setMode] = useState("SAS");
  const [inputs, setInputs] = useState({
    sideA: 30, angleC: 60, sideB: 30,        // SAS defaults → equilateral-ish
    angleA: 60, sideC: 30, angleB: 60,       // ASA defaults → equilateral
    ssA: 30, ssB: 30, ssC: 30,                // SSS defaults → equilateral
  });

  const preview = useMemo(() => {
    if (mode === "SAS") return deriveFromSAS(inputs.sideA, inputs.angleC, inputs.sideB);
    if (mode === "ASA") return deriveFromASA(inputs.angleA, inputs.sideC, inputs.angleB);
    return deriveFromSSS(inputs.ssA, inputs.ssB, inputs.ssC);
  }, [mode, inputs]);

  const apply = () => {
    if (!preview) return;
    // Clear legacy `r` so the geometry builder switches to the
    // base/height/apexShift path.
    updateDims(objId, { ...preview, r: undefined });
  };

  return (
    <div className="border border-slate-700 rounded bg-slate-950/60 p-2 space-y-2" data-testid="triangle-from-angles">
      <div className="flex items-center justify-between">
        <span className="text-[10px] uppercase tracking-wider text-slate-400 font-semibold">
          Compute from angles / sides
        </span>
        <div className="flex gap-0.5" data-testid="triangle-mode-toggle">
          {["SAS", "ASA", "SSS"].map((m) => (
            <button
              key={m}
              data-testid={`triangle-mode-${m}`}
              onClick={() => setMode(m)}
              className={`px-1.5 h-5 rounded text-[10px] font-mono border ${
                mode === m
                  ? "border-orange-500/70 text-orange-300 bg-orange-500/10"
                  : "border-slate-700 text-slate-400 hover:border-slate-500 hover:text-slate-200"
              }`}
            >
              {m}
            </button>
          ))}
        </div>
      </div>

      {mode === "SAS" && (
        <div className="grid grid-cols-3 gap-2" data-testid="triangle-sas-inputs">
          <NumInput testid="tri-sas-a"    label="Side a"      value={inputs.sideA}  onChange={(v) => setInputs({ ...inputs, sideA: v })} step={0.5} />
          <NumInput testid="tri-sas-c"    label="Angle C"     value={inputs.angleC} onChange={(v) => setInputs({ ...inputs, angleC: v })} step={1} suffix="°" />
          <NumInput testid="tri-sas-b"    label="Side b"      value={inputs.sideB}  onChange={(v) => setInputs({ ...inputs, sideB: v })} step={0.5} />
        </div>
      )}
      {mode === "ASA" && (
        <div className="grid grid-cols-3 gap-2" data-testid="triangle-asa-inputs">
          <NumInput testid="tri-asa-a"    label="Angle A"     value={inputs.angleA} onChange={(v) => setInputs({ ...inputs, angleA: v })} step={1} suffix="°" />
          <NumInput testid="tri-asa-c"    label="Side c"      value={inputs.sideC}  onChange={(v) => setInputs({ ...inputs, sideC: v })} step={0.5} />
          <NumInput testid="tri-asa-b"    label="Angle B"     value={inputs.angleB} onChange={(v) => setInputs({ ...inputs, angleB: v })} step={1} suffix="°" />
        </div>
      )}
      {mode === "SSS" && (
        <div className="grid grid-cols-3 gap-2" data-testid="triangle-sss-inputs">
          <NumInput testid="tri-sss-a"    label="Side a"      value={inputs.ssA}    onChange={(v) => setInputs({ ...inputs, ssA: v })} step={0.5} />
          <NumInput testid="tri-sss-b"    label="Side b"      value={inputs.ssB}    onChange={(v) => setInputs({ ...inputs, ssB: v })} step={0.5} />
          <NumInput testid="tri-sss-c"    label="Side c"      value={inputs.ssC}    onChange={(v) => setInputs({ ...inputs, ssC: v })} step={0.5} />
        </div>
      )}

      <div className="flex items-center justify-between">
        <div className="text-[10px] text-slate-500 font-mono" data-testid="triangle-preview">
          {preview
            ? `→ base ${preview.base} · height ${preview.height} · apex ${preview.apexShift >= 0 ? "+" : ""}${preview.apexShift}`
            : <span className="text-red-400">Invalid — angles or side lengths don&apos;t form a triangle.</span>}
        </div>
        <button
          data-testid="triangle-apply-btn"
          disabled={!preview}
          onClick={apply}
          className="h-6 px-2 text-[10px] font-semibold rounded bg-orange-500 hover:bg-orange-400 text-slate-950 disabled:opacity-40 disabled:cursor-not-allowed"
        >
          Apply
        </button>
      </div>
    </div>
  );
}
