"""Print-readiness scoring & analysis for AI-generated 3D meshes.

Purpose (Phase 1B of the AI-mesh-to-printable-file strategy): produce a
single 0-100 "Print-Readiness" score plus an itemised issue list that
the frontend's Printability Report panel hangs off. Downstream repair
tools (Auto-Clean, Decimate, Voxel-Remesh, Auto-Base) all show up as
"fix" affordances tied to specific issues here.

Design goals:
- Stateless / pure function of the mesh bytes. No DB.
- Uses libraries already in the environment (trimesh + pymeshfix).
  No new deps to keep the deploy tight.
- Every check is a small function so we can extend without rewriting the
  scoring core.
- Score = 100 - sum(issue_weight). Clamps 0-100. Weights are calibrated
  from the "typical AI-generated Meshy output" baseline so a raw
  Hunyuan3D single-image output lands ~40-55 and a hand-modelled clean
  STL lands 90-100.
"""
from __future__ import annotations

import io
import logging
import math
from dataclasses import dataclass, field, asdict
from typing import Optional

import numpy as np
import trimesh

logger = logging.getLogger(__name__)


# --- Severity + fix-action taxonomy ---------------------------------------

SEV_CRITICAL = "critical"  # Blocks slicing / print will fail
SEV_MAJOR    = "major"     # Slice will succeed but print will look bad
SEV_MINOR    = "minor"     # Cosmetic / efficiency concern
SEV_INFO     = "info"      # Not a problem, just data

# `fix_action` is a machine-readable hint the frontend maps to a tool
# button. Keep the vocabulary small — extend deliberately.
FIX_AUTOCLEAN    = "auto_clean"           # Weld verts, remove loose, close holes
FIX_DECIMATE     = "decimate_with_intent" # Presets: mini / functional / low-poly
FIX_VOXEL_REMESH = "voxel_remesh"         # Rebuild topology as a solid
FIX_ADD_BASE     = "add_base"             # Add flat base
FIX_THICKEN      = "thicken_walls"        # Extrude thin regions
FIX_ORIENT       = "reorient"             # Rotate for a stable footprint
FIX_NONE         = "none"                 # Informational only


@dataclass
class PrintabilityIssue:
    code: str          # stable machine-readable ID, e.g. "non_watertight"
    severity: str
    message: str       # human-readable one-liner
    detail: str = ""   # longer context, may include numbers
    count: int = 0     # how many defects contribute to this issue (>=0)
    weight: int = 0    # points deducted from the score (0-40)
    fix_action: str = FIX_NONE


@dataclass
class PrintabilityMetrics:
    """Raw numbers the frontend renders in the "Mesh Stats" strip."""
    triangle_count: int = 0
    vertex_count: int = 0
    is_watertight: bool = False
    is_winding_consistent: bool = False
    volume_mm3: float = 0.0
    surface_area_mm2: float = 0.0
    bbox_size_mm: list = field(default_factory=lambda: [0.0, 0.0, 0.0])
    bbox_min_z_mm: float = 0.0
    connected_components: int = 0
    degenerate_face_count: int = 0
    duplicate_face_count: int = 0
    has_flat_base: bool = False


@dataclass
class PrintabilityReport:
    score: int                                  # 0-100
    verdict: str                                # "ready" | "needs_work" | "not_printable"
    issues: list[PrintabilityIssue] = field(default_factory=list)
    metrics: PrintabilityMetrics = field(default_factory=PrintabilityMetrics)


# --- Individual analysers -------------------------------------------------
# Each returns a (possibly empty) list of PrintabilityIssue.

def _check_watertight(mesh: trimesh.Trimesh) -> list[PrintabilityIssue]:
    if mesh.is_watertight:
        return []
    # Try to count the actual holes; trimesh doesn't expose a "hole
    # count" directly but the boundary edge groups (open edges) approximate it.
    # `edges_unique_length` - `edges_face` mismatch = boundary edges.
    try:
        boundary_count = len(mesh.outline().entities) if mesh.outline() is not None else 0
    except Exception:  # noqa: BLE001
        boundary_count = 1
    return [PrintabilityIssue(
        code="non_watertight",
        severity=SEV_CRITICAL,
        message="Mesh is not watertight — the slicer may skip regions or fail",
        detail=f"~{max(1, boundary_count)} open boundary loop(s) detected.",
        count=max(1, boundary_count),
        weight=30,
        fix_action=FIX_AUTOCLEAN,
    )]


def _check_winding(mesh: trimesh.Trimesh) -> list[PrintabilityIssue]:
    if mesh.is_winding_consistent:
        return []
    return [PrintabilityIssue(
        code="inconsistent_winding",
        severity=SEV_MAJOR,
        message="Face winding is inconsistent — normals point in mixed directions",
        detail="Slicers can misclassify inside vs outside, causing missing walls or filled cavities.",
        weight=12,
        fix_action=FIX_AUTOCLEAN,
    )]


def _check_fragments(mesh: trimesh.Trimesh) -> list[PrintabilityIssue]:
    """Loose disconnected fragments. AI meshes very often ship 3-8 tiny
    "island" triangles floating near the main body — invisible in a
    preview render but a nightmare for slicers."""
    try:
        parts = mesh.split(only_watertight=False)
    except Exception:  # noqa: BLE001
        return []
    if len(parts) <= 1:
        return []
    # Rank by volume; anything under 1% of the biggest part is "loose junk".
    parts_sorted = sorted(parts, key=lambda p: -abs(float(p.volume)) if p.volume else -abs(float(p.area)))
    main_size = abs(float(parts_sorted[0].volume)) or abs(float(parts_sorted[0].area)) or 1.0
    junk = 0
    for p in parts_sorted[1:]:
        sz = abs(float(p.volume)) or abs(float(p.area))
        if sz < main_size * 0.01:
            junk += 1
    if junk == 0:
        return [PrintabilityIssue(
            code="multi_part",
            severity=SEV_MINOR,
            message=f"{len(parts)} disconnected parts detected",
            detail="Multiple substantial parts — verify this is intentional; otherwise weld them.",
            count=len(parts),
            weight=5,
            fix_action=FIX_AUTOCLEAN,
        )]
    return [PrintabilityIssue(
        code="loose_fragments",
        severity=SEV_MAJOR,
        message=f"{junk} loose fragment(s) floating near the main body",
        detail="Tiny disconnected pieces (<1% of main volume) are typical AI-generation debris. "
               "Auto-Clean will remove them.",
        count=junk,
        weight=15,
        fix_action=FIX_AUTOCLEAN,
    )]


def _check_triangle_count(mesh: trimesh.Trimesh) -> list[PrintabilityIssue]:
    """AI meshes are commonly 200K+ triangles when 20-40K would slice
    identically. Over-tesselation causes slow slicing and huge G-code."""
    tri = int(len(mesh.faces))
    if tri < 200_000:
        return []
    severity = SEV_MAJOR if tri > 500_000 else SEV_MINOR
    weight = 12 if tri > 500_000 else 6
    return [PrintabilityIssue(
        code="over_tesselation",
        severity=severity,
        message=f"{tri:,} triangles — likely over-tesselated for print",
        detail="AI generators output density optimised for texture, not print. "
               "Decimate to ~20-40k for typical figurine prints without losing detail.",
        count=tri,
        weight=weight,
        fix_action=FIX_DECIMATE,
    )]


def _check_degenerate(mesh: trimesh.Trimesh) -> list[PrintabilityIssue]:
    """Zero-area triangles and duplicate faces — silent slice killers."""
    issues = []
    try:
        # trimesh flags degenerate faces via `.nondegenerate_faces()` inverse.
        nondegen = mesh.nondegenerate_faces()
        degen = int(len(mesh.faces) - int(nondegen.sum()))
    except Exception:  # noqa: BLE001
        degen = 0
    if degen > 0:
        issues.append(PrintabilityIssue(
            code="degenerate_faces",
            severity=SEV_MAJOR if degen > 50 else SEV_MINOR,
            message=f"{degen} zero-area (degenerate) face(s)",
            detail="Faces with no area confuse the slicer's inside/outside test.",
            count=degen,
            weight=8 if degen > 50 else 3,
            fix_action=FIX_AUTOCLEAN,
        ))
    # Duplicate faces
    try:
        dup = int(len(mesh.faces) - int(len(np.unique(np.sort(mesh.faces, axis=1), axis=0))))
    except Exception:  # noqa: BLE001
        dup = 0
    if dup > 0:
        issues.append(PrintabilityIssue(
            code="duplicate_faces",
            severity=SEV_MINOR,
            message=f"{dup} duplicate face(s)",
            detail="Overlapping identical triangles waste slicing time.",
            count=dup,
            weight=2,
            fix_action=FIX_AUTOCLEAN,
        ))
    return issues


def _check_flat_base(mesh: trimesh.Trimesh) -> list[PrintabilityIssue]:
    """Does the mesh have a stable footprint on Z=0? Detected as: is there
    at least a `bbox.width * bbox.depth * 0.02` (2%) planar contact area
    at the lowest Z. Cheap heuristic — good enough for a Score."""
    try:
        bmin, bmax = mesh.bounds
        size = bmax - bmin
        base_z = float(bmin[2])
        # Vertices within 0.5mm of the lowest Z
        contact_verts = mesh.vertices[mesh.vertices[:, 2] < base_z + 0.5]
        if len(contact_verts) < 3:
            has_flat_base = False
        else:
            xy = contact_verts[:, :2]
            span_x = float(xy[:, 0].max() - xy[:, 0].min())
            span_y = float(xy[:, 1].max() - xy[:, 1].min())
            footprint_area = span_x * span_y
            bbox_footprint = float(size[0] * size[1])
            has_flat_base = footprint_area > 0 and footprint_area / max(bbox_footprint, 1e-6) > 0.15
    except Exception:  # noqa: BLE001
        has_flat_base = False
    if has_flat_base:
        return []
    return [PrintabilityIssue(
        code="no_flat_base",
        severity=SEV_MAJOR,
        message="No stable flat base for bed contact",
        detail="Slicer will need a raft or supports to anchor the print. "
               "Add an auto-base to make this printable directly.",
        weight=10,
        fix_action=FIX_ADD_BASE,
    )]


def _check_bbox_size(mesh: trimesh.Trimesh) -> list[PrintabilityIssue]:
    """Warn on tiny or huge meshes — commonly an import unit mismatch
    (e.g. GLB in metres imported as mm → 0.05mm tall)."""
    try:
        size = mesh.bounds[1] - mesh.bounds[0]
        max_dim = float(size.max())
    except Exception:  # noqa: BLE001
        return []
    if max_dim < 2:
        return [PrintabilityIssue(
            code="mesh_too_small",
            severity=SEV_CRITICAL,
            message=f"Mesh is only {max_dim:.2f}mm across — check import units",
            detail="GLB / OBJ files often come in metres. Scale ×1000 if this was meant to be a real object.",
            weight=25,
            fix_action=FIX_NONE,
        )]
    if max_dim > 400:
        return [PrintabilityIssue(
            code="mesh_too_large",
            severity=SEV_MINOR,
            message=f"Mesh is {max_dim:.0f}mm — larger than most consumer bed sizes",
            detail="Consider scaling down or splitting into sections.",
            weight=3,
            fix_action=FIX_NONE,
        )]
    return []


# --- Public entry point ---------------------------------------------------

def analyze_mesh_bytes(mesh_bytes: bytes, file_type: str = "stl") -> PrintabilityReport:
    """Analyze a mesh's print-readiness.

    Parameters
    ----------
    mesh_bytes : the raw file content (STL/OBJ/PLY/GLB — anything trimesh reads)
    file_type  : hint for trimesh's loader; e.g. "stl", "obj", "3mf", "glb"

    Returns
    -------
    PrintabilityReport (dataclass; use `asdict()` to JSON-serialize)
    """
    if not mesh_bytes:
        raise ValueError("analyze_mesh_bytes: empty payload")
    try:
        loaded = trimesh.load(io.BytesIO(mesh_bytes), file_type=file_type, force="mesh")
    except Exception as e:  # noqa: BLE001
        raise ValueError(f"Could not parse mesh ({file_type}): {e}") from e

    if isinstance(loaded, trimesh.Scene):
        # 3MF/GLB scenes — merge geometries into a single mesh for scoring.
        # Individual per-object scoring is a future refinement.
        if not loaded.geometry:
            raise ValueError("Mesh scene contains no geometry")
        mesh = trimesh.util.concatenate(list(loaded.geometry.values()))
    else:
        mesh = loaded

    if not isinstance(mesh, trimesh.Trimesh) or len(mesh.faces) == 0:
        raise ValueError("Loaded object has no faces")

    return analyze_trimesh(mesh)


def analyze_trimesh(mesh: trimesh.Trimesh) -> PrintabilityReport:
    """Same as analyze_mesh_bytes but takes an already-loaded trimesh.
    Useful for the in-app "check current selection" flow where we
    already have the mesh in memory (avoids serialisation round-trip)."""

    issues: list[PrintabilityIssue] = []
    # Order matters only for the DISPLAY order — score is order-independent.
    issues += _check_bbox_size(mesh)
    issues += _check_watertight(mesh)
    issues += _check_winding(mesh)
    issues += _check_fragments(mesh)
    issues += _check_degenerate(mesh)
    issues += _check_triangle_count(mesh)
    issues += _check_flat_base(mesh)

    # Metrics
    try:
        bmin, bmax = mesh.bounds
        bbox_size = (bmax - bmin).tolist()
        bbox_min_z = float(bmin[2])
    except Exception:  # noqa: BLE001
        bbox_size, bbox_min_z = [0.0, 0.0, 0.0], 0.0
    try:
        components = int(len(mesh.split(only_watertight=False)))
    except Exception:  # noqa: BLE001
        components = 1

    metrics = PrintabilityMetrics(
        triangle_count=int(len(mesh.faces)),
        vertex_count=int(len(mesh.vertices)),
        is_watertight=bool(mesh.is_watertight),
        is_winding_consistent=bool(mesh.is_winding_consistent),
        volume_mm3=float(abs(mesh.volume)) if mesh.is_volume else 0.0,
        surface_area_mm2=float(mesh.area),
        bbox_size_mm=bbox_size,
        bbox_min_z_mm=bbox_min_z,
        connected_components=components,
        degenerate_face_count=next(
            (i.count for i in issues if i.code == "degenerate_faces"), 0
        ),
        duplicate_face_count=next(
            (i.count for i in issues if i.code == "duplicate_faces"), 0
        ),
        has_flat_base=not any(i.code == "no_flat_base" for i in issues),
    )

    # Score = 100 - Σ weights, clamped.
    penalty = sum(i.weight for i in issues)
    score = max(0, min(100, 100 - penalty))
    if score >= 80:
        verdict = "ready"
    elif score >= 45:
        verdict = "needs_work"
    else:
        verdict = "not_printable"

    return PrintabilityReport(
        score=score,
        verdict=verdict,
        issues=issues,
        metrics=metrics,
    )


def report_to_dict(report: PrintabilityReport) -> dict:
    """dataclass -> plain dict for FastAPI serialization."""
    return asdict(report)
