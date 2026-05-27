# OrcaSlicer engine — deployment notes

ForgeSlicer can shell out to a native OrcaSlicer binary for production-quality
slicing (multi-perimeter walls, real supports, tree supports, AMS, ironing,
etc.). The built-in JS slicer remains the default and works completely
offline — Orca is opt-in via the engine selector inside the Slicer popover.

## How the engine gets onto the server

`scripts/install_orca.py` downloads the latest **Linux x86_64 AppImage** from
the official OrcaSlicer GitHub release, self-extracts it (no FUSE required),
and lays the result down at `/app/backend/bin/orca-x86_64/`. The
`orca_engine.resolve_install()` resolver finds it there.

The installer is **idempotent** and **non-blocking on backend startup**:

* On every backend startup, the `install_orca_if_missing` hook in
  `server.py` checks the resolver. If a working binary is present → no-op.
  If not → fires the installer in a background thread.
* First-deploy install: ~30-60 seconds (119 MB download + ~5 s extract).
* Subsequent startups: <100 ms (the resolver finds the cached binary).
* On `aarch64` / `arm64` hosts the installer exits cleanly with code `1`
  and logs that OrcaSlicer does not publish an ARM AppImage. The
  frontend falls back to the built-in slicer with a clear status message.

## File layout

```
/app/backend/bin/
  ├── .orca_install_lock     # sentinel — present while installer is running
  ├── .cache/                # download staging area (auto-cleaned)
  └── orca-x86_64/           # extracted AppImage contents (ignored by git)
      ├── AppRun             # ← the launcher — sets LD_LIBRARY_PATH
      ├── OrcaSlicer
      ├── resources/
      └── usr/lib/...        # bundled libs
```

All paths above are gitignored — the binary is downloaded on each
deployment rather than committed, keeping the repo small.

## Manual operations

```bash
# Force a reinstall (e.g., to pick up a new OrcaSlicer release):
python3 /app/backend/scripts/install_orca.py --force

# Plan only — show what would be downloaded, no side effects:
python3 /app/backend/scripts/install_orca.py --dry-run

# Test the install pipeline on aarch64 (download/extract will fail at the
# arch boundary but the rest of the flow is exercised):
ORCA_FORCE_X86_INSTALL=1 python3 /app/backend/scripts/install_orca.py
```

## Status endpoint

`GET /api/slice/orca/status` reports the live state:

```json
{
  "installed": true,
  "arch": "x86_64",
  "source": "app-x86_64",
  "version": "OrcaSlicer 2.3.2",
  "build_in_progress": false,
  "binary_path": "/app/backend/bin/orca-x86_64/AppRun",
  "detail": null
}
```

`build_in_progress: true` means the installer is currently downloading or
extracting (the UI displays an "installing…" pill). The field is named
`build_in_progress` for backward compatibility with the older source-build
path.

## Disk usage

* Download cache: ~119 MB (auto-deleted after extract)
* Installed AppImage: ~280 MB extracted

Plan for ~400 MB peak during install, ~280 MB steady state per host.

## Why AppImage instead of source build

* **30-60 s deploy install** vs 1-2 hour C++ compile from source
* **No build deps** (Boost, wxWidgets, CGAL, cmake) on the runtime image
* **Single binary blob** that just works — the AppImage bundles its own libs
* Tradeoff: limited to whatever upstream ships; for custom slicer patches
  we'd need to revisit the source-build path. See PRD.md.

## Future: bundled custom profiles

The AppImage's `resources/profiles/` directory is a JSON tree that's safe
to overlay with custom printer/process/filament profiles after extract —
e.g., baked-in defaults specific to ForgeSlicer's preset library. Not yet
wired up; see PRD.md backlog.
