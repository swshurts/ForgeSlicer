"""Iter-136 — Bas-relief generator regression tests."""
import io
import os
import sys
from pathlib import Path

import numpy as np
import pytest
import trimesh
from PIL import Image

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
os.environ.setdefault("MONGO_URL", "mongodb://localhost:27017")
os.environ.setdefault("DB_NAME", "test_database")

import bas_relief_service as brs


def _make_test_image(size=256, pattern="gradient"):
    """A 256x256 test image. `gradient` is a diagonal ramp so we can
    verify the heightmap orients correctly; `dot` is a centred bright
    circle so we can verify the subject-in-relief case."""
    arr = np.zeros((size, size), dtype=np.uint8)
    if pattern == "gradient":
        for i in range(size):
            arr[i, :] = int(255 * i / (size - 1))
    else:  # dot
        cx = cy = size // 2
        r = size // 4
        yy, xx = np.mgrid[0:size, 0:size]
        arr[(xx - cx) ** 2 + (yy - cy) ** 2 <= r ** 2] = 255
    buf = io.BytesIO()
    Image.fromarray(arr, mode="L").save(buf, format="PNG")
    return buf.getvalue()


class TestGenerate:
    def test_default_disk_shape(self):
        result = brs.generate_bas_relief(_make_test_image(), grid_size=128)
        assert result["diameter_mm"] == 220.0
        assert result["total_height_mm"] == pytest.approx(15.0)  # 3 base + 12 relief
        # Parse the STL back and verify it's a coherent mesh.
        m = trimesh.load(io.BytesIO(result["stl_bytes"]), file_type="stl", force="mesh")
        assert isinstance(m, trimesh.Trimesh)
        assert len(m.faces) > 100
        # Silhouette check: X and Y extents must equal diameter (± ~4 mm
        # at 128-grid resolution — the outer ring of quads gets clipped
        # because ALL four corners must be inside the circle to survive).
        bmin, bmax = m.bounds
        assert abs((bmax[0] - bmin[0]) - 220.0) < 5.0
        assert abs((bmax[1] - bmin[1]) - 220.0) < 5.0
        # Total height must reflect base + max relief.
        assert abs((bmax[2] - bmin[2]) - 15.0) < 0.5

    def test_dark_is_high_flips_orientation(self):
        img_bytes = _make_test_image(pattern="dot")
        light = brs.generate_bas_relief(img_bytes, dark_is_high=False, grid_size=128)
        dark = brs.generate_bas_relief(img_bytes, dark_is_high=True, grid_size=128)
        # Both must produce valid meshes with the same silhouette.
        m1 = trimesh.load(io.BytesIO(light["stl_bytes"]), file_type="stl", force="mesh")
        m2 = trimesh.load(io.BytesIO(dark["stl_bytes"]), file_type="stl", force="mesh")
        assert isinstance(m1, trimesh.Trimesh) and isinstance(m2, trimesh.Trimesh)

    def test_custom_dimensions(self):
        result = brs.generate_bas_relief(
            _make_test_image(),
            diameter_mm=100.0,
            max_relief_mm=5.0,
            base_thickness_mm=2.0,
            grid_size=128,
        )
        assert result["diameter_mm"] == 100.0
        assert result["total_height_mm"] == pytest.approx(7.0)
        m = trimesh.load(io.BytesIO(result["stl_bytes"]), file_type="stl", force="mesh")
        bmin, bmax = m.bounds
        assert abs((bmax[0] - bmin[0]) - 100.0) < 2.5

    @pytest.mark.parametrize("diameter", [50, 400, -1])
    def test_rejects_bad_diameter(self, diameter):
        with pytest.raises(ValueError, match="diameter_mm"):
            brs.generate_bas_relief(_make_test_image(), diameter_mm=diameter)

    @pytest.mark.parametrize("relief", [0.1, 45.0])
    def test_rejects_bad_relief(self, relief):
        with pytest.raises(ValueError, match="max_relief_mm"):
            brs.generate_bas_relief(_make_test_image(), max_relief_mm=relief)

    def test_rejects_empty_image(self):
        with pytest.raises(ValueError, match="empty"):
            brs.generate_bas_relief(b"", diameter_mm=200)

    def test_grid_size_clamps_to_bounds(self):
        # Feature: values outside [128, 800] should silently clamp (not error).
        r = brs.generate_bas_relief(_make_test_image(), grid_size=50)
        assert r["grid_size"] == 128
        r2 = brs.generate_bas_relief(_make_test_image(), grid_size=2000)
        assert r2["grid_size"] == 800
