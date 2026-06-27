// BeginnerStarters — onboarding gallery for first-time CAD visitors.
//
// Why this exists (and lives ABOVE the existing LandingTemplates):
//   The blank-canvas problem. A beginner who sees an empty workspace
//   on first launch bounces — they don't know what's possible, so
//   they don't know where to start. The existing LandingTemplates
//   block lists intermediate parts (Pi 4 wall mount, vise jaws,
//   right-angle bracket) which are useful for makers but
//   intimidating for first-timers. This block answers a different
//   question: "what's the easiest possible first thing I could
//   actually print?"
//
// Each card carries the metadata first-timers ask for IMMEDIATELY:
//   - difficulty (Beginner / Easy / Intermediate)
//   - estimated print time (real-world ballpark, not raw G-code time)
//   - required skills (the 5 CAD verbs they'll learn doing it:
//     resize, subtract, text, align, export)
//
// Click flow: writes a starter hint into sessionStorage under
// `forgeslicer.starterTemplate` and navigates to
// `/workspace?starter=<id>`. The workspace's starter-template handler
// (planned for the next iteration — see ROADMAP) reads this on mount
// and either auto-builds the part or opens a guided dialog. For now
// the visitor lands on the workspace with the hint queued; if the
// hint isn't yet consumed they just get the empty workspace (graceful
// degradation, no worse than the current state).

import React from "react";
import { useNavigate } from "react-router-dom";
import {
    KeyRound,
    Smartphone,
    Tag,
    Sprout,
    Cable,
    Inbox,
    Disc,
    Triangle,
    Cookie,
    CircleDot,
    Anchor,
    Square as SquareIcon,
    Sparkles,
    Clock,
    Wrench,
} from "lucide-react";

// Difficulty pill colour map — the visual gradient from
// emerald (zero-friction) → amber (still safe) → sky (genuine skill
// stretch) gives a 200ms read of how committed the visitor needs to
// be before tapping in.
const DIFFICULTY_STYLES = {
    Beginner: "bg-emerald-500/15 text-emerald-300 border-emerald-500/30",
    Easy: "bg-amber-500/15 text-amber-300 border-amber-500/30",
    Intermediate: "bg-sky-500/15 text-sky-300 border-sky-500/30",
};

const STARTERS = [
    {
        id: "keychain",
        templateId: "starter_keychain",
        title: "Keychain",
        icon: KeyRound,
        accent: "from-orange-500/25 to-amber-500/10",
        iconColor: "text-orange-300",
        difficulty: "Beginner",
        printTime: "~15 min",
        skills: ["resize", "text", "export"],
        blurb: "A round tag with custom text and a ring hole. Most-printed first project on planet Earth.",
    },
    {
        id: "phone-stand",
        templateId: "starter_phone_stand",
        title: "Phone Stand",
        icon: Smartphone,
        accent: "from-cyan-500/25 to-blue-500/10",
        iconColor: "text-cyan-300",
        difficulty: "Beginner",
        printTime: "~45 min",
        skills: ["resize", "align", "export"],
        blurb: "Angled cradle sized to your phone. Pick the width; the angle stays comfy.",
    },
    {
        id: "name-tag",
        templateId: "starter_name_tag",
        title: "Name Tag",
        icon: Tag,
        accent: "from-emerald-500/25 to-green-500/10",
        iconColor: "text-emerald-300",
        difficulty: "Beginner",
        printTime: "~20 min",
        skills: ["resize", "text", "subtract", "export"],
        blurb: "Embossed name plate with a pin clip. Type a name, hit print.",
    },
    {
        id: "plant-marker",
        templateId: "starter_plant_marker",
        title: "Plant Marker",
        icon: Sprout,
        accent: "from-lime-500/25 to-emerald-500/10",
        iconColor: "text-lime-300",
        difficulty: "Beginner",
        printTime: "~10 min",
        skills: ["text", "resize", "export"],
        blurb: "Tag with a spike to push into soil. Stack-printable — a whole herb garden in one go.",
    },
    {
        id: "cable-clip",
        templateId: "starter_cable_clip",
        title: "Cable Clip",
        icon: Cable,
        accent: "from-indigo-500/25 to-violet-500/10",
        iconColor: "text-indigo-300",
        difficulty: "Easy",
        printTime: "~20 min",
        skills: ["resize", "subtract", "align", "export"],
        blurb: "Snap-on clip for desk cables. Adjust the inner diameter to match your wire bundle.",
    },
    {
        id: "organizer-tray",
        templateId: "starter_organizer_tray",
        title: "Mini Organizer Tray",
        icon: Inbox,
        accent: "from-amber-500/25 to-yellow-500/10",
        iconColor: "text-amber-300",
        difficulty: "Easy",
        printTime: "~1 hr",
        skills: ["resize", "subtract", "align", "export"],
        blurb: "Multi-pocket desk tray. Choose grid count and pocket depth — perfect for screws, pens, or hardware.",
    },
    {
        id: "replacement-knob",
        templateId: "starter_replacement_knob",
        title: "Replacement Knob",
        icon: Disc,
        accent: "from-rose-500/25 to-pink-500/10",
        iconColor: "text-rose-300",
        difficulty: "Easy",
        printTime: "~25 min",
        skills: ["resize", "subtract", "export"],
        blurb: "Knurled cap for a missing oven / drawer / cabinet knob. Dial in the bore size to match the shaft.",
    },
    {
        id: "simple-bracket",
        templateId: "starter_simple_bracket",
        title: "Simple Bracket",
        icon: Triangle,
        accent: "from-teal-500/25 to-cyan-500/10",
        iconColor: "text-teal-300",
        difficulty: "Easy",
        printTime: "~40 min",
        skills: ["resize", "subtract", "align", "export"],
        blurb: "Right-angle L bracket with screw holes. Sized to your shelf or shelf-load.",
    },
    {
        id: "cookie-cutter",
        templateId: "starter_cookie_cutter",
        title: "Cookie Cutter",
        icon: Cookie,
        accent: "from-orange-500/25 to-red-500/10",
        iconColor: "text-orange-300",
        difficulty: "Easy",
        printTime: "~30 min",
        skills: ["resize", "subtract", "export"],
        blurb: "Outline cutter from your favourite shape. Star, heart, dinosaur — your call.",
    },
    {
        id: "toy-wheel",
        templateId: "starter_toy_wheel",
        title: "Toy Wheel",
        icon: CircleDot,
        accent: "from-violet-500/25 to-purple-500/10",
        iconColor: "text-violet-300",
        difficulty: "Beginner",
        printTime: "~20 min",
        skills: ["resize", "subtract", "export"],
        blurb: "Replacement wheel for a hot-wheels-class toy car. Axle bore and hub thickness adjustable.",
    },
    {
        id: "desk-hook",
        templateId: "starter_desk_hook",
        title: "Desk Hook",
        icon: Anchor,
        accent: "from-purple-500/25 to-fuchsia-500/10",
        iconColor: "text-purple-300",
        difficulty: "Easy",
        printTime: "~25 min",
        skills: ["resize", "align", "subtract", "export"],
        blurb: "Clamp-on hook for headphones, bags, or keys. No drilling — slides onto a desk edge.",
    },
    {
        id: "wall-spacer",
        templateId: "starter_wall_spacer",
        title: "Wall Spacer",
        icon: SquareIcon,
        accent: "from-slate-500/25 to-zinc-500/10",
        iconColor: "text-slate-300",
        difficulty: "Beginner",
        printTime: "~15 min",
        skills: ["resize", "subtract", "export"],
        blurb: "Stand-off washer for hanging frames or shelves a known distance off a wall.",
    },
];

function StarterCard({ tpl, onLaunch }) {
    const Icon = tpl.icon;
    const diffClass = DIFFICULTY_STYLES[tpl.difficulty] || DIFFICULTY_STYLES.Beginner;
    return (
        <div
            data-testid={`starter-card-${tpl.id}`}
            className="group relative flex flex-col rounded-xl border border-slate-800 hover:border-orange-500/60 bg-slate-950/80 overflow-hidden transition-all hover:-translate-y-0.5 focus-within:ring-2 focus-within:ring-orange-500/40"
        >
            {/* Thumbnail panel — uses the lucide icon as the visual until
                we can render real STL previews. Gradient background per
                template gives each card a unique colour identity at the
                grid level. */}
            <div
                className={`relative aspect-[5/3] bg-gradient-to-br ${tpl.accent} flex items-center justify-center`}
                aria-hidden="true"
            >
                <div className="absolute inset-0 opacity-30" style={{
                    backgroundImage:
                        "linear-gradient(rgba(255,255,255,0.08) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.08) 1px, transparent 1px)",
                    backgroundSize: "24px 24px",
                }} />
                <div className={`w-16 h-16 rounded-xl bg-slate-950/70 border border-slate-800 flex items-center justify-center ${tpl.iconColor} group-hover:scale-105 transition-transform shadow-lg shadow-black/40`}>
                    <Icon size={32} strokeWidth={1.5} />
                </div>
                <span
                    className={`absolute top-2 right-2 text-[9px] uppercase tracking-widest font-semibold px-1.5 py-0.5 rounded border ${diffClass}`}
                    data-testid={`starter-difficulty-${tpl.id}`}
                >
                    {tpl.difficulty}
                </span>
            </div>

            <div className="p-4 flex-1 flex flex-col">
                <div className="flex items-center justify-between gap-2">
                    <div className="text-[14px] font-bold text-white tracking-tight">{tpl.title}</div>
                    <span
                        className="inline-flex items-center gap-1 text-[10px] text-slate-400 font-mono"
                        data-testid={`starter-time-${tpl.id}`}
                    >
                        <Clock size={10} /> {tpl.printTime}
                    </span>
                </div>
                <p className="mt-1.5 text-[11px] text-slate-400 leading-relaxed">{tpl.blurb}</p>

                <div className="mt-3 flex flex-wrap items-center gap-1" data-testid={`starter-skills-${tpl.id}`}>
                    <Wrench size={10} className="text-slate-600" />
                    {tpl.skills.map((s) => (
                        <span
                            key={s}
                            className="text-[9px] uppercase tracking-wider px-1.5 py-0.5 rounded bg-slate-800/70 border border-slate-700/60 text-slate-300 font-semibold"
                        >
                            {s}
                        </span>
                    ))}
                </div>

                <button
                    type="button"
                    data-testid={`starter-customize-${tpl.id}`}
                    onClick={() => onLaunch(tpl)}
                    className="mt-4 h-9 w-full bg-orange-500 hover:bg-orange-600 text-white text-[12px] font-semibold rounded flex items-center justify-center gap-1.5 transition-colors"
                >
                    <Sparkles size={13} /> Customize this
                </button>
            </div>
        </div>
    );
}

export default function BeginnerStarters() {
    const navigate = useNavigate();

    const launch = (tpl) => {
        // Reuse the same plumbing the heavy LandingTemplates uses:
        // stash {template_id, params, name} under
        // `forgeslicer.launchTemplate`, then navigate to
        // /workspace?template=<id>. The workspace's existing template
        // handler pops the payload, calls expandTemplate(), and runs
        // the resulting step list through executePlan — same path the
        // voice pipeline uses, so the starter mesh lands in the scene
        // ready to edit. Each starter passes an empty params object
        // because the backend builders ship with first-print-friendly
        // defaults; the user dials in dimensions from the workspace.
        try {
            sessionStorage.setItem(
                "forgeslicer.launchTemplate",
                JSON.stringify({
                    template_id: tpl.templateId,
                    params: {},
                    name: tpl.title,
                }),
            );
        } catch (_) {
            // private-mode Safari etc — just navigate anyway.
        }
        navigate(`/workspace?template=${tpl.id}`);
    };

    return (
        <section
            data-testid="landing-beginner-starters"
            className="mt-24"
            aria-labelledby="starters-heading"
        >
            <div className="text-center mb-10">
                <div className="inline-flex items-center gap-1.5 px-2 py-1 bg-emerald-500/10 border border-emerald-500/30 rounded-full text-[10px] uppercase tracking-widest text-emerald-300 font-semibold">
                    <Sparkles size={11} /> Beginner Starter Projects
                </div>
                <h2
                    id="starters-heading"
                    className="mt-4 text-3xl sm:text-4xl font-bold tracking-tight"
                >
                    Skip the{" "}
                    <span className="text-orange-400">blank canvas.</span>
                </h2>
                <p className="mt-3 text-slate-400 text-sm max-w-2xl mx-auto leading-relaxed">
                    Twelve hand-picked first prints — every one was someone&apos;s
                    first time on a 3D printer at some point. Pick a card,
                    customize the dimensions to your needs, and learn the 5
                    core CAD skills (resize, subtract, text, align, export) on
                    a part you&apos;ll actually use.
                </p>
            </div>

            <div
                className="grid sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4"
                data-testid="landing-starters-grid"
            >
                {STARTERS.map((tpl) => (
                    <StarterCard key={tpl.id} tpl={tpl} onLaunch={launch} />
                ))}
            </div>

            <div className="mt-6 text-center text-[11px] text-slate-500">
                Every starter project teaches a real CAD skill you&apos;ll re-use
                on your own designs. Hover the skill tags on each card to see
                exactly what you&apos;ll learn.
            </div>
        </section>
    );
}
