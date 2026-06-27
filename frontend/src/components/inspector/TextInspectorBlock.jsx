// TextInspectorBlock — primitive-specific controls for the `text`
// primitive. Lives in the RightPanel; rendered when the user
// selects a text object.
//
// Why this is its own block (instead of inline in RightPanel):
//   The text primitive has the highest "edit-after-creation"
//   frequency of any primitive — users will create a placeholder
//   "Hello" then immediately type their actual string. A dedicated
//   block lets the text input span the full panel width, which is
//   important for long strings (names, addresses, plant labels)
//   that don't fit in a 60 px numeric field.
//
// Edits write straight to `obj.dims` via `updateDims`; the geometry
// rebuild is driven by the JSON.stringify(dims) cache key in
// Viewport's SceneObject. No extra wiring needed.

import React from "react";
import { Type } from "lucide-react";
import { TEXT_DEFAULTS, TEXT_FONTS } from "../../lib/textGeometry";

const ALIGNMENTS = [
    { value: "left", label: "Left" },
    { value: "center", label: "Centre" },
    { value: "right", label: "Right" },
];

export default function TextInspectorBlock({ obj, updateDims }) {
    const d = { ...TEXT_DEFAULTS, ...(obj?.dims || {}) };
    const onText = (e) => updateDims(obj.id, { text: e.target.value });
    const onFont = (e) => updateDims(obj.id, { font: e.target.value });
    const onAlign = (e) => updateDims(obj.id, { align: e.target.value });
    const onNum = (key) => (e) => {
        const v = parseFloat(e.target.value);
        updateDims(obj.id, { [key]: Number.isFinite(v) ? v : TEXT_DEFAULTS[key] });
    };
    const toggleBevel = () => updateDims(obj.id, { bevelEnabled: !d.bevelEnabled });

    return (
        <div className="space-y-3" data-testid="text-inspector-block">
            {/* Heading */}
            <div className="flex items-center gap-2 px-1 -mb-1">
                <Type size={13} className="text-orange-400" />
                <span className="text-[10px] uppercase tracking-wider text-slate-400 font-medium">
                    Text Glyphs
                </span>
            </div>

            {/* Text string — full-width so long labels fit */}
            <label className="flex flex-col gap-1">
                <span className="text-[10px] uppercase tracking-wider text-slate-400 font-medium">
                    Text
                </span>
                <input
                    data-testid="text-string-input"
                    type="text"
                    value={d.text ?? ""}
                    onChange={onText}
                    placeholder="Type here…"
                    maxLength={120}
                    className="h-8 w-full bg-slate-950 border border-slate-700 rounded text-sm text-white px-2 focus:border-orange-500 focus:ring-1 focus:ring-orange-500 outline-none"
                />
            </label>

            {/* Font + alignment row */}
            <div className="grid grid-cols-2 gap-2">
                <label className="flex flex-col gap-1">
                    <span className="text-[10px] uppercase tracking-wider text-slate-400 font-medium">
                        Font
                    </span>
                    <select
                        data-testid="text-font-select"
                        value={d.font}
                        onChange={onFont}
                        className="h-8 w-full bg-slate-950 border border-slate-700 rounded text-[12px] text-white px-2 focus:border-orange-500 outline-none"
                    >
                        {TEXT_FONTS.map((f) => (
                            <option key={f.value} value={f.value}>{f.label}</option>
                        ))}
                    </select>
                </label>
                <label className="flex flex-col gap-1">
                    <span className="text-[10px] uppercase tracking-wider text-slate-400 font-medium">
                        Align
                    </span>
                    <select
                        data-testid="text-align-select"
                        value={d.align}
                        onChange={onAlign}
                        className="h-8 w-full bg-slate-950 border border-slate-700 rounded text-[12px] text-white px-2 focus:border-orange-500 outline-none"
                    >
                        {ALIGNMENTS.map((a) => (
                            <option key={a.value} value={a.value}>{a.label}</option>
                        ))}
                    </select>
                </label>
            </div>

            {/* Size + depth */}
            <div className="grid grid-cols-2 gap-2">
                <label className="flex flex-col gap-1">
                    <span className="text-[10px] uppercase tracking-wider text-slate-400 font-medium">
                        Size <span className="normal-case text-[9px] text-slate-500">(mm)</span>
                    </span>
                    <input
                        data-testid="text-size-input"
                        type="number"
                        step={0.5}
                        min={0.5}
                        value={d.size}
                        onChange={onNum("size")}
                        className="h-8 w-full bg-slate-950 border border-slate-700 rounded text-sm text-white px-2 focus:border-orange-500 outline-none font-mono"
                    />
                </label>
                <label className="flex flex-col gap-1">
                    <span className="text-[10px] uppercase tracking-wider text-slate-400 font-medium">
                        Depth <span className="normal-case text-[9px] text-slate-500">(mm)</span>
                    </span>
                    <input
                        data-testid="text-depth-input"
                        type="number"
                        step={0.1}
                        min={0.1}
                        value={d.depth}
                        onChange={onNum("depth")}
                        className="h-8 w-full bg-slate-950 border border-slate-700 rounded text-sm text-white px-2 focus:border-orange-500 outline-none font-mono"
                    />
                </label>
            </div>

            {/* Bevel — toggle + (optional) detail row */}
            <div>
                <label className="flex items-center gap-2 cursor-pointer">
                    <input
                        data-testid="text-bevel-toggle"
                        type="checkbox"
                        checked={!!d.bevelEnabled}
                        onChange={toggleBevel}
                        className="accent-orange-500"
                    />
                    <span className="text-[11px] text-slate-300">Bevel edges</span>
                    <span className="ml-auto text-[9px] text-slate-500">subtle rounded glyph edges</span>
                </label>

                {d.bevelEnabled && (
                    <div className="mt-2 grid grid-cols-2 gap-2" data-testid="text-bevel-detail">
                        <label className="flex flex-col gap-1">
                            <span className="text-[10px] uppercase tracking-wider text-slate-400 font-medium">
                                Bevel Thickness
                            </span>
                            <input
                                data-testid="text-bevel-thickness-input"
                                type="number"
                                step={0.05}
                                min={0}
                                max={2}
                                value={d.bevelThickness}
                                onChange={onNum("bevelThickness")}
                                className="h-8 w-full bg-slate-950 border border-slate-700 rounded text-sm text-white px-2 outline-none font-mono"
                            />
                        </label>
                        <label className="flex flex-col gap-1">
                            <span className="text-[10px] uppercase tracking-wider text-slate-400 font-medium">
                                Bevel Size
                            </span>
                            <input
                                data-testid="text-bevel-size-input"
                                type="number"
                                step={0.05}
                                min={0}
                                max={2}
                                value={d.bevelSize}
                                onChange={onNum("bevelSize")}
                                className="h-8 w-full bg-slate-950 border border-slate-700 rounded text-sm text-white px-2 outline-none font-mono"
                            />
                        </label>
                    </div>
                )}
            </div>

            <p className="text-[10px] text-slate-500 leading-snug">
                Tip — switch the modifier to{" "}
                <span className="text-cyan-300 font-semibold">Negative</span>{" "}
                to engrave: drop the text onto a host face, then{" "}
                <span className="text-orange-300 font-semibold">Subtract</span>{" "}
                to carve the glyphs into the surface.
            </p>
        </div>
    );
}
