# ForgeSlicer — Product Requirements Document

## Original Problem Statement
> Create a fork of OrcaSlicer that will incorporate a TinkerCad or FreeCad like interface for creating your 3D models, thus reducing the need for working in multiple platforms. The resultant application should allow the user to add positive and negative components to your model and precisely position them. The output from the application should be GCODE, STL and/or 3MF files.

## User Choices
- **Approach**: Web-based 3D CAD + Slicer app (browser-only, React + Three.js).
- **Modeling features**: Primitives (cube, sphere, cylinder, cone, torus); Boolean ops (union, subtract, intersect); STL/OBJ import; measurement/snapping/grid.
- **Slicer**: Preview-quality GCODE generator (perimeter contour slicer in JS, no JS slicer lib was viable to embed in browser).
- **Persistence**: Local save (`.forge.json` project files) + Public Gallery for sharing STL designs.
- **UI**: OrcaSlicer-inspired dark dense workspace.
- **OrcaSlicer hand-off**: 3MF export with documented import flow.

## Architecture
- **Frontend**: React 19 + react-three-fiber + drei + three.js 0.170 + three-bvh-csg + zustand + JSZip + react-router-dom + Tailwind.
- **Backend**: FastAPI + Motor (async MongoDB), single `/api/gallery` resource collection.
- **Routes**: `/` Landing (public), `/gallery` Public Library (public), `/workspace` CAD editor (auth-gated), `/profile` User profile (auth-gated).

## Core Pages / Components
| Component | Responsibility |
|-----------|---------------|
| `Landing.jsx` | Hero, feature grid, CTAs |
| `Workspace.jsx` | Shell composing TopToolbar / Left / Viewport / Right / Status |
| `Viewport.jsx` | R3F Canvas, build plate, grid, gizmo, transform-controls |
| `LeftPanel.jsx` | Positive & negative primitive palettes + outliner tree |
| `RightPanel.jsx` | Inspector (transforms/dimensions) + slicer settings + Slice button |
| `TopToolbar.jsx` | File ops, import, export STL/3MF, boolean ops, transform modes, snap/grid, share, send-to-orca |
| `StatusBar.jsx` | Units/build volume/mode/snap/selection summary |
| `Gallery.jsx` | Public gallery browser with download & delete |
| `Dialogs.jsx` | Share-to-gallery + Send-to-OrcaSlicer dialogs |
| `lib/store.js` | Zustand scene store + slicer settings |
| `lib/transforms.js` | Pure rigid-body transform helpers (translate / rotate / scale) |
| `lib/historyStack.js` | Pure undo/redo snapshot machinery |
| `lib/csg.js` | three-bvh-csg evaluator (positive union → negative subtract pipeline) |
| `lib/manifoldEngine.js` | manifold-3d WASM evaluator (default — guaranteed manifold output) |
| `lib/geometry.js` | Primitive → BufferGeometry builders |
| `lib/exporters.js` | STL (bin/ASCII) + 3MF (jszip) + STL/OBJ import + JSON project I/O |
| `lib/slicer.js` | Synchronous plane-intersection slicer → Marlin-flavoured GCODE |
| `lib/api.js` | Axios client for `/api/gallery`, `/api/components`, `/api/projects` |
| `routes/projects.py` | Backend hierarchical project tree CRUD (per-user, auth-required) |
| `dialogs/ProjectExplorerDialog.jsx` | Frontend tree UI with HTML5 drag-and-drop re-parent (iter 64) + click-based "Move into…" picker |
| `ProjectBreadcrumb.jsx` | Topbar breadcrumb of `currentProjectId`'s ancestry; ancestor segments load that project's scene on click (iter 65); cloud-save button + Ctrl+S behavior hint (iter 66) |
| `lib/savePref.js` | Persisted preference: what does Ctrl/Cmd+S do? `local` (default) / `cloud` / `both` (iter 66) |
| `lib/tipsLibrary.js` | Tip-of-the-day library (10 seed tips, seen-state in localStorage, carousel via "Next tip") (iter 68) |
| `lib/oversizeCheck.js` | Detect when scene objects exceed the active printer's build volume; computes auto cut-grid (iter 69) |
| `lib/subdivide.js` | Cut an oversized object along axis-aligned planes + add dowel/dovetail connectors at interfaces (iter 69) |
| `dialogs/SubdivideDialog.jsx` | Auto/Manual subdivide workflow UI (iter 69) |
| `lib/useOrcaSlice.js` | Hook: OrcaSlicer profile state, install status polling, SSE progress, runSlice/buildPayload (iter 64) |
| `lib/gcodeParser.js` | Shared G-code parser + layer pairing + diff helpers (used by GcodePreviewDialog AND Compare Engines overlay) |
| `dialogs/ToolpathOverlayTab.jsx` | New tab in EngineComparisonDialog: layer-by-layer canvas with built-in vs Orca diff highlight (iter 64) |

## Companion Documents
- **CHANGELOG.md** — append-only iteration history (everything that has been implemented, with dates and rationale).
- **ROADMAP.md** — prioritised P0/P1/P2 backlog and pending issues.
- **test_credentials.md** — seed users for the testing agent / E2E suites.
