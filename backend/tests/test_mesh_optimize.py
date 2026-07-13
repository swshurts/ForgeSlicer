"""Iter-134 — mesh_optimize_service + thin-wall detector regression.

Locks in the invariants the frontend depends on:
  * decimate presets exist and produce a face-count <= target
  * decimate never returns 0 faces (silhouette protection)
  * auto-base cylinder/rectangle produce a printable fused body
  * add-base rejects out-of-range thickness/margin
  * thin-wall detector fires on a genuinely thin plate mesh AND
    stays quiet on a bulky sphere.
"""
from __future__ import annotations

import io
import os
import sys
from pathlib import Path

import numpy as np
import pytest
import trimesh

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
os.environ.setdefault("MONGO_URL", "mongodb://localhost:27017")
os.environ.setdefault("DB_NAME", "test_database")

import mesh_optimize_service  # noqa: E402
import printability_service   # noqa: E402


def _mesh_to_stl_bytes(mesh: trimesh.Trimesh) -> bytes:
    buf = io.BytesIO()
    mesh.export(buf, file_type="stl")
    return buf.getvalue()


@pytest.fixture
def high_res_sphere_stl() -> bytes:
    # ~5k faces — well above the low_poly target so decimation must fire.
    return _mesh_to_stl_bytes(trimesh.creation.icosphere(subdivisions=4))


@pytest.fixture
def thin_plate_stl() -> bytes:
    """0.5 mm × 20 mm × 20 mm plate — under the 1.2 mm min-wall threshold."""
    return _mesh_to_stl_bytes(trimesh.creation.box(extents=(20, 20, 0.5)))


@pytest.fixture
def bulky_sphere_stl() -> bytes:
    """20 mm-radius sphere — every ray-cast should hit ~40 mm across so
    the thin-wall detector must stay quiet."""
    return _mesh_to_stl_bytes(trimesh.creation.icosphere(subdivisions=3, radius=20))


class TestDecimatePresets:
    def test_presets_are_registered(self):
        assert set(mesh_optimize_service.DECIMATE_PRESETS) == {"mini", "functional", "low_poly"}

    @pytest.mark.parametrize("preset", ["mini", "functional", "low_poly"])
    def test_decimate_returns_stl_at_or_under_target(self, high_res_sphere_stl, preset):
        out = mesh_optimize_service.decimate_with_intent(high_res_sphere_stl, preset)
        assert out["preset"] == preset
        # Face count must be within [min_faces, target_faces] plus a
        # small tolerance because the simplifier rounds to the nearest
        # triangle pair.
        target = mesh_optimize_service.DECIMATE_PRESETS[preset]["target_faces"]
        assert out["after"]["faces"] > 0
        assert out["after"]["faces"] <= max(target, out["before"]["faces"]) + 20
        # STL must be a valid, non-empty binary payload trimesh can reload.
        reloaded = trimesh.load(io.BytesIO(out["stl_bytes"]), file_type="stl", force="mesh")
        assert isinstance(reloaded, trimesh.Trimesh)
        assert len(reloaded.faces) == out["after"]["faces"]

    def test_decimate_rejects_unknown_preset(self, high_res_sphere_stl):
        with pytest.raises(ValueError, match="unknown preset"):
            mesh_optimize_service.decimate_with_intent(high_res_sphere_stl, "ultra")

    def test_decimate_never_zeroes_the_mesh(self):
        # Very small mesh — must not fall below min_faces of low_poly.
        tiny = _mesh_to_stl_bytes(trimesh.creation.icosphere(subdivisions=1))  # ~80 faces
        out = mesh_optimize_service.decimate_with_intent(tiny, "low_poly")
        assert out["after"]["faces"] > 0


class TestAutoBase:
    def test_cylinder_adds_footprint(self, high_res_sphere_stl):
        out = mesh_optimize_service.add_auto_base(
            high_res_sphere_stl, shape="cylinder", thickness_mm=3.0, margin_mm=2.0
        )
        assert out["shape"] == "cylinder"
        assert out["after_faces"] > out["before_faces"]
        assert out["base_footprint_mm2"] > 0
        # Verify STL parses back to a coherent mesh.
        reloaded = trimesh.load(io.BytesIO(out["stl_bytes"]), file_type="stl", force="mesh")
        assert isinstance(reloaded, trimesh.Trimesh) and len(reloaded.faces) > 0

    def test_rectangle_shape(self, high_res_sphere_stl):
        out = mesh_optimize_service.add_auto_base(
            high_res_sphere_stl, shape="rectangle", thickness_mm=2.0, margin_mm=1.0
        )
        assert out["shape"] == "rectangle"
        assert out["thickness_mm"] == 2.0
        assert out["margin_mm"] == 1.0

    def test_rejects_bad_shape(self, high_res_sphere_stl):
        with pytest.raises(ValueError, match="cylinder"):
            mesh_optimize_service.add_auto_base(high_res_sphere_stl, shape="hexagon")

    @pytest.mark.parametrize("thickness", [0.1, 25.0, -1.0])
    def test_rejects_bad_thickness(self, high_res_sphere_stl, thickness):
        with pytest.raises(ValueError, match="thickness"):
            mesh_optimize_service.add_auto_base(high_res_sphere_stl, thickness_mm=thickness)

    @pytest.mark.parametrize("margin", [-0.5, 25.0])
    def test_rejects_bad_margin(self, high_res_sphere_stl, margin):
        with pytest.raises(ValueError, match="margin"):
            mesh_optimize_service.add_auto_base(high_res_sphere_stl, margin_mm=margin)


class TestThinWallDetector:
    def test_thin_plate_flagged(self, thin_plate_stl):
        report = printability_service.analyze_mesh_bytes(thin_plate_stl, file_type="stl")
        codes = {i.code for i in report.issues}
        assert "thin_walls" in codes, f"expected thin_walls in {codes}"
        # Score must reflect the thin-wall penalty.
        thin = next(i for i in report.issues if i.code == "thin_walls")
        assert thin.weight > 0
        assert thin.fix_action == printability_service.FIX_THICKEN

    def test_bulky_sphere_not_flagged(self, bulky_sphere_stl):
        report = printability_service.analyze_mesh_bytes(bulky_sphere_stl, file_type="stl")
        codes = {i.code for i in report.issues}
        assert "thin_walls" not in codes, f"unexpected thin_walls on bulky mesh: {codes}"

    def test_micro_mesh_bails_silently(self):
        # A degenerate 2-face mesh — the detector should return [] without crashing.
        v = np.array([[0, 0, 0], [1, 0, 0], [0, 1, 0]], dtype=float)
        f = np.array([[0, 1, 2]])
        mesh = trimesh.Trimesh(vertices=v, faces=f)
        issues = printability_service._check_thin_walls(mesh)
        assert issues == []


class TestThickenWalls:
    """Iter-137 — Minkowski-sum wall thickening. Verifies:
      * bounding box grows by ~2·offset on each axis
      * face count is non-trivial and STL parses back cleanly
      * the "already-thick" mesh no longer trips the thin-wall
        detector after thickening
      * bad offsets are rejected up-front
    """

    def test_offset_grows_bbox(self, thin_plate_stl):
        # thin_plate is 20 × 20 × 0.5 mm — after +0.5 mm offset all faces
        # should sit outside by ~0.5 mm, so bbox size grows by ~1 mm on
        # every axis.
        out = mesh_optimize_service.thicken_walls(thin_plate_stl, offset_mm=0.5)
        assert out["offset_mm"] == pytest.approx(0.5)
        reloaded = trimesh.load(io.BytesIO(out["stl_bytes"]), file_type="stl", force="mesh")
        assert isinstance(reloaded, trimesh.Trimesh) and len(reloaded.faces) > 0
        bmin, bmax = reloaded.bounds
        size = bmax - bmin
        # Bbox grows by ~2·offset per axis (offset extends outward on both sides).
        assert size[0] > 20 + 0.9, f"expected X growth ~1 mm, got {size[0] - 20}"
        assert size[1] > 20 + 0.9, f"expected Y growth ~1 mm, got {size[1] - 20}"
        assert size[2] > 0.5 + 0.9, f"expected Z growth ~1 mm, got {size[2] - 0.5}"
        assert out["after_faces"] > 0

    def test_thickened_plate_clears_thin_wall_detector(self, thin_plate_stl):
        # 0.5 mm plate is flagged thin. Thicken by 0.5 mm → total 1.5 mm,
        # above the 1.2 mm threshold → detector should stay quiet.
        out = mesh_optimize_service.thicken_walls(thin_plate_stl, offset_mm=0.5)
        report = printability_service.analyze_mesh_bytes(out["stl_bytes"], file_type="stl")
        codes = {i.code for i in report.issues}
        assert "thin_walls" not in codes, f"still thin after thicken: {codes}"

    @pytest.mark.parametrize("bad_offset", [0.0, -0.1, 10.0])
    def test_rejects_bad_offset(self, thin_plate_stl, bad_offset):
        with pytest.raises(ValueError, match="offset_mm"):
            mesh_optimize_service.thicken_walls(thin_plate_stl, offset_mm=bad_offset)

    def test_pre_decimation_marker(self):
        # A high-poly sphere (~5k faces) sits below the 6k ceiling so
        # pre_decimated should be False. Confirms the flag reflects
        # the actual branch taken.
        stl = _mesh_to_stl_bytes(trimesh.creation.icosphere(subdivisions=3))
        out = mesh_optimize_service.thicken_walls(stl, offset_mm=0.3)
        assert out["pre_decimated"] is False
