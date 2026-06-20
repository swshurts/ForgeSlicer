// Landing-page Templates Gallery — curated one-click starting points
// that drop users into the workspace with a finished part already
// rendered. The list is hand-picked from the most common "I just want
// X" requests we hear, and every card resolves to a voice-template
// already covered by `/api/voice/expand-template` (no new backend code
// required — the backend already knows how to build these).
//
// Click flow:
//   1. User clicks a card → we stash {template_id, params} in
//      sessionStorage under `forgeslicer.launchTemplate`.
//   2. We navigate to `/workspace?template=<id>`.
//   3. Workspace mounts, sees the `?template` param, pops the
//      sessionStorage payload, calls expandTemplate(), then runs the
//      returned step list through executePlan().
//
// Why sessionStorage and not URL search params for the params dict?
//   Some templates have nested params (faces:["+y","-x"], custom mm
//   values, etc.) and stuffing those in the URL is fragile / ugly.
//   sessionStorage gives us a clean handoff that survives the route
//   change but doesn't pollute browser history.

import React from "react";
import { useNavigate } from "react-router-dom";
import { Cpu, Hammer, Wrench, BookOpen, Plug, Box, Disc, Anchor } from "lucide-react";

const TEMPLATES = [
  {
    id: "pi4-wall",
    title: "Pi 4 Wall Mount",
    blurb: "Vertical faceplate with cut-outs for HDMI, USB, and power on the +Y face. Snaps to a 3M-pad backing.",
    icon: Cpu,
    accent: "from-orange-500/20 to-amber-500/10",
    iconColor: "text-orange-400",
    templateId: "board_faceplate",
    params: { board: "raspberry_pi_4b", orientation: "wall" },
  },
  {
    id: "tool-holder",
    title: "Tool Holder",
    blurb: "Wall-mount strip with three pockets sized for screwdrivers, pliers, and a tape measure. Mount-hole spacing included.",
    icon: Hammer,
    accent: "from-cyan-500/20 to-blue-500/10",
    iconColor: "text-cyan-300",
    templateId: "tool_holder",
    params: { width_mm: 180, depth_mm: 25, pocket_count: 3 },
  },
  {
    id: "vise-jaws",
    title: "Soft Vise Jaws",
    blurb: "Pair of clamping jaws with a V-groove on the inner face. Drop in a custom width and the groove auto-centres.",
    icon: Wrench,
    accent: "from-emerald-500/20 to-green-500/10",
    iconColor: "text-emerald-300",
    templateId: "vise_jaws",
    params: { width_mm: 80, height_mm: 35, thickness_mm: 10 },
  },
  {
    id: "drawer-pull",
    title: "Drawer Pull",
    blurb: "Ergonomic D-shaped handle with mount holes spaced for 3.5mm bolts. Pick your length; the curve scales smoothly.",
    icon: BookOpen,
    accent: "from-purple-500/20 to-pink-500/10",
    iconColor: "text-purple-300",
    templateId: "drawer_pull",
    params: { length_mm: 96 },
  },
  {
    id: "cable-comb",
    title: "Cable Comb",
    blurb: "Cleans up a thicket of wires — 12 slots in a low-profile comb. Adjust slot count and pitch to your loom.",
    icon: Plug,
    accent: "from-indigo-500/20 to-violet-500/10",
    iconColor: "text-indigo-300",
    templateId: "cable_comb",
    params: { slot_count: 12, slot_pitch_mm: 6 },
  },
  {
    id: "project-enclosure",
    title: "Project Enclosure",
    blurb: "Open-top box with chamfered edges, vent slots, and mount-screw bosses. Sized for typical hobby boards.",
    icon: Box,
    accent: "from-amber-500/20 to-orange-500/10",
    iconColor: "text-amber-300",
    templateId: "project_enclosure",
    params: { interior_x_mm: 90, interior_y_mm: 60, interior_z_mm: 35 },
  },
  {
    id: "spool-spacer",
    title: "Spool Hub Spacer",
    blurb: "Two interlocking flanges that adapt a generic spool to a printer's hub. Common bore sizes pre-configured.",
    icon: Disc,
    accent: "from-rose-500/20 to-pink-500/10",
    iconColor: "text-rose-300",
    templateId: "spool_spacer",
    params: { bore_mm: 53, hub_mm: 8, flange_mm: 22 },
  },
  {
    id: "right-angle-bracket",
    title: "Right-Angle Bracket",
    blurb: "Load-rated L-shelf with a gusset. Specify shelf depth and load (kg) — the gusset thickness scales accordingly.",
    icon: Anchor,
    accent: "from-teal-500/20 to-cyan-500/10",
    iconColor: "text-teal-300",
    templateId: "right_angle_bracket",
    params: { shelf_depth_mm: 100, load_kg: 5 },
  },
];

export default function LandingTemplates() {
  const navigate = useNavigate();

  const launch = (tpl) => {
    try {
      sessionStorage.setItem(
        "forgeslicer.launchTemplate",
        JSON.stringify({
          template_id: tpl.templateId,
          params: tpl.params,
          name: tpl.title,
        }),
      );
    } catch (_) {
      // sessionStorage can fail in private-mode Safari etc; the
      // workspace will just open empty in that case.
    }
    navigate(`/workspace?template=${tpl.id}`);
  };

  return (
    <section
      data-testid="landing-templates"
      className="mt-28 mb-10"
      aria-labelledby="templates-heading"
    >
      <div className="flex items-end justify-between mb-5 flex-wrap gap-3">
        <div>
          <div className="inline-flex items-center gap-1.5 px-2 py-1 bg-cyan-500/10 border border-cyan-500/30 rounded-full text-[10px] uppercase tracking-widest text-cyan-300 font-semibold">
            New · One-click templates
          </div>
          <h2
            id="templates-heading"
            className="mt-3 text-2xl sm:text-3xl font-bold tracking-tight"
          >
            Start with a finished part
          </h2>
          <p className="mt-2 text-slate-400 text-sm max-w-2xl">
            Curated starting points that drop you into the workspace with a
            real component already built. Tweak dimensions, run booleans,
            export STL — all the modelling steps stay editable.
          </p>
        </div>
        <span className="text-[11px] text-slate-500 font-mono tracking-tight self-end">
          {TEMPLATES.length} presets · more coming
        </span>
      </div>

      <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {TEMPLATES.map((tpl) => (
          <button
            key={tpl.id}
            type="button"
            data-testid={`landing-template-${tpl.id}`}
            onClick={() => launch(tpl)}
            className={`group relative flex flex-col text-left rounded-xl border border-slate-800 hover:border-orange-500/60 bg-slate-950/80 p-5 transition-all hover:-translate-y-0.5 focus:outline-none focus:ring-2 focus:ring-orange-500/40 overflow-hidden`}
          >
            <div
              className={`absolute inset-0 -z-0 bg-gradient-to-br ${tpl.accent} opacity-70 pointer-events-none`}
              aria-hidden="true"
            />
            <div className="relative z-10">
              <div
                className={`w-11 h-11 rounded-lg bg-slate-950/85 border border-slate-800 flex items-center justify-center mb-4 ${tpl.iconColor} group-hover:scale-105 transition-transform`}
              >
                <tpl.icon size={22} strokeWidth={1.6} />
              </div>
              <div className="text-[13px] font-semibold text-white tracking-tight">
                {tpl.title}
              </div>
              <p className="mt-1.5 text-[11px] text-slate-300/90 leading-relaxed">
                {tpl.blurb}
              </p>
              <div className="mt-4 inline-flex items-center gap-1 text-[10px] uppercase tracking-widest font-semibold text-orange-400 opacity-0 group-hover:opacity-100 transition-opacity">
                Open in workspace →
              </div>
            </div>
          </button>
        ))}
      </div>
    </section>
  );
}
