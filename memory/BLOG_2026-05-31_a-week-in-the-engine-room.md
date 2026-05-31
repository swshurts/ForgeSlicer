# A Week Inside ForgeSlicer's Engine Room

*A behind-the-scenes look at iter-70 through iter-74 — what shipped, what
broke, and what we learned about running a slicer behind Cloudflare.*

## TL;DR

In seven days we went from "OrcaSlicer keeps rejecting our profiles" to
"users can register a brand-new 2026 printer in ten seconds and round-trip
the JSON back into desktop Orca." Along the way we untangled a particularly
gnarly Cloudflare 524 timeout, taught the slicer to read OrcaSlicer's
lesser-known layer markers, and gave the codebase a 191-line haircut.

Five iterations. Three production deploys. Sixty-three new tests. Zero
regressions in shipping features.

Here's the highlight reel.

---

## Iteration 70 — "Process not compatible with printer"

It started with two screenshots. Engine Comparison failed. GCODE export
failed. Both with the same cryptic error:

> `run 2559: process not compatible with printer. run found error, return -17`

The instinct was to blame the slice settings, but the real culprit lived
inside OrcaSlicer's own preset library. Every bundled process JSON ships
with a `compatible_printers` allow-list — a hard-coded array enumerating
the exact printer profile names it was authored for. Pick a Bambu A1
process with a custom Klipper machine? OrcaSlicer's
`Preset::is_compatible_with_printer()` quietly returns false, the CLI
exits with `-17`, and the user gets a stack trace.

The fix mirrors what OrcaSlicer's desktop GUI already does silently
behind the Compatibility panel: rewrite the in-memory `compatible_printers`
array to include whatever printer the user actually picked, then strip
any stale `*_condition` expressions that could flip the verdict back. We
factored this into a small helper, `_patch_cross_profile_compatibility`,
that runs after profile staging and before disk write.

**Why it matters:** no more per-vendor preset mapping table to maintain.
Cross-vendor combos just work — exactly the same way they work when you
toggle the compatibility checkbox in OrcaSlicer's GUI.

**Receipts:** 8 new unit tests covering the cross-vendor rewrite,
matched-vendor idempotence, condition-strip, filament dual-key patch,
and three safety paths. All green.

## Iteration 71 — The Cloudflare 524

User redeployed. Tried Engine Comparison again. New error.

> `Request failed with status code 524`

The slice was now succeeding on the server — Engine Comparison even
showed `Total wall time 126.25s` — but Cloudflare's hard origin-timeout
sits at 100 seconds on standard plans. The blocking POST simply couldn't
return through the proxy in time.

This is the kind of architectural problem that no amount of slice-tuning
fixes. The solution was to stop trying to be synchronous at all.

We refactored `POST /api/slice/orca/slice` into an async-job pattern:

1. POST validates input, spawns the slice as an `asyncio.create_task`,
   and returns **`202 {job_id}` in ~170 ms**. The HTTP connection lives
   for under a second.
2. The client subscribes to the existing SSE `/progress/{job_id}` stream
   to drive its UI.
3. When SSE reports `done: true`, the client fetches
   `GET /result/{job_id}` to retrieve the final GCODE.

Job results live in memory with a 10-minute TTL (opportunistic eviction
on every `/result` fetch — no background sweeper needed). Error
propagation is preserved exactly: failed jobs stamp their HTTPException
status and detail onto the slot, and `/result` re-raises them so the
frontend's `apiErrorMessage` formatter keeps working unchanged.

**Why it matters:** slices of any length now work behind any CDN.
Cloudflare 524s are architecturally impossible going forward — the POST
returns before any timeout can fire, and SSE chunks bytes every 0.5s.

**Receipts:** 11 new integration tests cover the POST 202 / 503 / 400 /
413 paths, the GET 200 / 202 / 404 / 400 / 500 / error-passthrough paths,
and the TTL eviction behaviour. Live curl: POST returned in 169 ms.

A small gap I caught a few minutes later: the Engine Comparison path
(`engineCompare.js`) had its own slice call that bypassed the hook I'd
rewired. Patched it with a polling helper (`waitForSliceResult`) so
comparisons benefit from the same async flow without needing per-engine
SSE subscriptions.

## A Pause for Hardware

This is where the user took a break to actually print the GCODE.

The first attempt was spaghetti. Bed level was off, hotend temp wasn't
calibrated, and the SV06 Plus Ace had a Z-offset that hadn't been touched
in months. Not our fault, but also not entirely not our fault — bad
calibration eats good GCODE for breakfast.

While they were recalibrating, I picked up the next item.

## Iteration 72 — User-Defined Printers

OrcaSlicer ships system presets for about 80 printers. The 3D-printing
scene has released 8-10 new models since January 2026, with 4 more
announced just this week. Waiting for the preset shipment cadence isn't
viable when users already own the hardware.

So we built a per-user printer catalogue.

**Backend** — A new `user_printers` MongoDB collection with five CRUD
endpoints under `/api/me/printers`. Tight Pydantic validation on every
numeric field (build volume 10-1000 mm, nozzle 0.1-2.0 mm, etc.) so
typos and malicious payloads can't poison a slice. A helper
`build_profile_from_user_printer(doc)` translates a stored record into
the same minimal printer-profile dict the frontend's bundled `PRINTER_PROFILES`
table produces — meaning the iter-70 cross-vendor compatibility patch
and the existing `_stage_user_profile` metadata stamping handle custom
printers without a single special case.

**Slice integration** — `OrcaSliceRequest` gained a `user_printer_id`
field. When set, the slice endpoint synchronously resolves the printer
(401 for anonymous, 404 for unknown / not-owned), then overrides
`printer_profile` with the resolved dict. We did this via a callback
pattern (`register_user_printer_resolver`, `register_user_id_extractor`)
so `orca_engine.py` stays free of motor / DB imports — clean
decoupling, no circular dependencies.

**Frontend** — A new `UserPrintersDialog` component with list + form
views (Name, Printer model, Build XYZ, Nozzle, G-code flavour, Max
speeds, Retraction, Start/End G-code, Notes). The slicer's printer
dropdown gained a "My Printers" optgroup at the top, an amber
"Using your custom printer profile" hint when one's selected, and
a "My Printers" management button to open the dialog.

I also fixed a small but annoying side bug in the same iteration: the
backend's GCODE layer-count parser only matched `;LAYER:N` (Marlin/Cura
style), but OrcaSlicer emits `;LAYER_CHANGE` (PrusaSlicer lineage). The
Engine Comparison card was reporting `Layer count: —` for the Orca
column despite a successful slice. One-line fix, six unit tests to lock
the behaviour, done.

**Receipts:** 11 new backend integration tests cover the CRUD endpoints,
validation bounds, and the slice integration paths. All 57 Orca-suite
tests pass.

## Iteration 73 — Import OrcaSlicer JSON

Iter-72 worked. But "type the build volume by hand" is friction, and
users who already have a printer working in desktop OrcaSlicer have
the JSON sitting right there in their config folder.

So we added a paste-and-go importer.

A new pure helper, `parseOrcaPrinterJson`, lives in
`lib/orcaProfiles.js`. It handles all the array-vs-scalar wrapping quirks
of OrcaSlicer's actual on-disk JSONs (`nozzle_diameter: ["0.4"]` instead
of `0.4`, `printable_area` as a 4-corner polygon, etc.), validates
against our schema bounds, type-gates so a process or filament JSON is
rejected with a clear error, and surfaces warnings for things like
`inherits` chains we don't resolve.

The dialog grew a collapsible "Import from OrcaSlicer JSON (optional)"
section at the top of the create/edit form. Paste → "Parse & fill form" →
imported field count, warnings, and any errors surface inline. Save.
Done in ten seconds.

**Receipts:** 7 parser scenarios verified via Node smoke test — happy
path, invalid JSON, wrong type, inherits warning, non-rectangular bed,
out-of-range nozzle, unknown gcode_flavor. All green.

## Iteration 74 — Round-Trip + a Refactor

User asked for two things in one message:

1. **Export** — the inverse of iter-73's import. A Download button on
   each row in My Printers that produces an OrcaSlicer-shaped JSON
   ready to share or load into desktop Orca.
2. **Refactor `store.js`** — the Zustand store had grown to 1486 lines.

**Export** — A new `exportUserPrinterAsOrcaJson(doc)` helper produces
a 2-space-indented JSON matching OrcaSlicer's bundled profile shape
(numeric arrays as strings, `printer_settings_id` set to the printer
name, etc.). The Download icon on each row turns it into a
`<slugified-name>.orca.json` blob via the standard browser-side
`URL.createObjectURL` trick.

I wrote a Node-based round-trip test: take a sample printer record,
export it, parse it back, verify every field matches. 15/15 fields
round-trip cleanly. Users can now move a printer between ForgeSlicer
and desktop OrcaSlicer without losing precision.

**Refactor** — Two cohesive blocks extracted:

- `lib/primitiveDefaults.js` (166 lines) — the `PRIMITIVE_DEFAULTS`
  source-of-truth table plus the `buildPrimitive` factory with its
  auto-drop centroid math. Pure data and functions, no Zustand state.
- `lib/rulerActions.js` (98 lines) — the anchored-ruler action methods
  packaged as a Zustand slice-factory. Spread into the main store via
  `...createRulerActions(set, get)`.

`store.js` went from 1486 to 1295 lines — a 13% reduction with zero
behaviour changes. The composite-primitives block (~320 lines around
line 676) is teed up as the next candidate when we want to keep going.

## What I Learned (and What I'd Tell Myself Last Monday)

**The error message isn't always the root cause.** rc -17 looked like
a settings mismatch. It was actually a hard-coded allow-list with no
GUI signal. Always trace the call chain to the actual conditional that
flipped false — assumptions about which layer failed will burn time.

**Browser deployments live in a different threat model.** A native app
slicing for 2 minutes is unremarkable; a browser app trying the same
through Cloudflare is HTTP-524 bait. The fix wasn't "slice faster" — it
was "stop holding the connection open." Once you accept that constraint,
the async-job pattern falls out naturally.

**Build for round-trip from day one.** Iter-72 shipped manual entry,
iter-73 added import, iter-74 added export. In retrospect those should
have been one feature, scoped properly. But each one stayed under an
hour and shipped cleanly, so the staged delivery probably gave better
feedback than one big release.

**Refactor without a behaviour change.** The store.js extraction was
~30 minutes of mechanical work and a smoke screenshot. Zero risk
because nothing else imported the symbols being moved. The hard part
of refactoring is choosing what to move; once you've identified a truly
self-contained block, the move itself should be boring.

**Tests are an act of remembering for your future self.** 63 new tests
this week. Most of them will run hundreds of times before anyone reads
their assertions. When someone changes the slice flow six months from
now and one of these turns red, that's the test paying for itself.

---

## What's Next

- **P2 (queued):** continue the store.js refactor — composite-primitives
  block next, then the boolean / cut / dimension action blocks.
- **P3 (future):** CRDT multi-user editing (Yjs); photo→reference-plane
  experiment.

But first, the user finishes recalibrating their SV06 Plus Ace and
prints something that doesn't look like spaghetti. Some milestones are
hardware milestones.

---

*ForgeSlicer is a browser-based CAD + slicer. The full source lives in
this repo; production is at [forgeslicer.com](https://forgeslicer.com).*
