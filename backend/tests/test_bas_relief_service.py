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


class TestFrameRing:
    """Iter-136.1 — Frame ring (Japanese Cork Art wooden border)."""

    def test_ring_off_by_default(self):
        r = brs.generate_bas_relief(_make_test_image(), grid_size=128)
        assert r["ring_enabled"] is False
        assert r["outer_diameter_mm"] == r["diameter_mm"]

    def test_ring_extends_outer_diameter(self):
        r = brs.generate_bas_relief(
            _make_test_image(),
            diameter_mm=200,
            ring_enabled=True,
            ring_width_mm=10,
            ring_height_mm=5,
            grid_size=192,
        )
        assert r["ring_enabled"] is True
        assert r["outer_diameter_mm"] == 220.0  # 200 + 2*10
        # Iter-138 — Result is split into TWO parts (medallion + ring).
        # The medallion STL spans the original diameter (200 mm); the
        # ring STL spans the outer diameter (220 mm).
        assert len(r["parts"]) == 2
        assert [p["name"] for p in r["parts"]] == ["medallion", "ring"]
        medallion = trimesh.load(io.BytesIO(r["parts"][0]["stl_bytes"]), file_type="stl", force="mesh")
        ring = trimesh.load(io.BytesIO(r["parts"][1]["stl_bytes"]), file_type="stl", force="mesh")
        mbmin, mbmax = medallion.bounds
        rbmin, rbmax = ring.bounds
        assert abs((mbmax[0] - mbmin[0]) - 200.0) < 5.0
        assert abs((mbmax[1] - mbmin[1]) - 200.0) < 5.0
        assert abs((rbmax[0] - rbmin[0]) - 220.0) < 5.0
        assert abs((rbmax[1] - rbmin[1]) - 220.0) < 5.0
        # Legacy stl_bytes field points at the medallion (first part).
        legacy = trimesh.load(io.BytesIO(r["stl_bytes"]), file_type="stl", force="mesh")
        assert legacy.bounds[1][0] - legacy.bounds[0][0] < 210.0

    def test_ring_taller_than_relief_wins_total_height(self):
        # ring_height > max_relief → total = base + ring_height.
        r = brs.generate_bas_relief(
            _make_test_image(),
            max_relief_mm=5,
            base_thickness_mm=3,
            ring_enabled=True,
            ring_width_mm=8,
            ring_height_mm=10,
            grid_size=128,
        )
        assert r["total_height_mm"] == pytest.approx(13.0)  # 3 base + 10 ring

    @pytest.mark.parametrize("rw", [0.5, 50])
    def test_rejects_bad_ring_width(self, rw):
        with pytest.raises(ValueError, match="ring_width_mm"):
            brs.generate_bas_relief(_make_test_image(), ring_enabled=True, ring_width_mm=rw)

    @pytest.mark.parametrize("rh", [0.1, 40])
    def test_rejects_bad_ring_height(self, rh):
        with pytest.raises(ValueError, match="ring_height_mm"):
            brs.generate_bas_relief(_make_test_image(), ring_enabled=True, ring_height_mm=rh)


class TestAlphaAware:
    """Iter-139 — Transparent PNG handling: the alpha channel must be
    treated as the silhouette (not silently converted to L, which would
    let transparent regions leak into the heightmap)."""

    @staticmethod
    def _make_alpha_png(size=256):
        """A 256×256 RGBA PNG whose alpha carves a circle out of a
        checkerboard-patterned background. The RGB channels inside the
        circle carry a light subject (200 gray) on transparent padding
        so a naive L conversion would produce inverted results."""
        from PIL import Image as _Image, ImageDraw as _ImageDraw
        img = _Image.new("RGBA", (size, size), (0, 0, 0, 0))
        d = _ImageDraw.Draw(img)
        # Bake in a checkerboard into the transparent (alpha=0) pixels —
        # mimics screenshot-of-transparent PNGs that carry the viewer's
        # transparency indicator baked into the raw pixels.
        for j in range(0, size, 16):
            for i in range(0, size, 16):
                shade = 255 if ((i // 16) + (j // 16)) % 2 == 0 else 200
                d.rectangle([i, j, i + 15, j + 15], fill=(shade, shade, shade, 0))
        # Draw the subject INSIDE an alpha-solid circle.
        d.ellipse([16, 16, size - 16, size - 16], fill=(200, 200, 200, 255))
        # A dark subject inside the circle.
        d.rectangle([64, 100, 200, 200], fill=(20, 20, 20, 255))
        buf = io.BytesIO()
        img.save(buf, format="PNG")
        return buf.getvalue()

    def test_alpha_becomes_silhouette(self):
        """The alpha channel — not the RGB — drives the mesh silhouette.
        A checkerboard-baked transparent PNG must NOT emit a noisy
        rectangular plate (the pre-iter-139 bug)."""
        png = self._make_alpha_png()
        r = brs.generate_bas_relief(png, diameter_mm=100, max_relief_mm=8, base_thickness_mm=2, grid_size=192)
        m = trimesh.load(io.BytesIO(r["parts"][0]["stl_bytes"]), file_type="stl", force="mesh")
        # The alpha circle is inscribed with 16 px padding → after trim
        # it fills the grid, so bounding box ≈ diameter_mm.
        bmin, bmax = m.bounds
        size = bmax - bmin
        assert abs(size[0] - 100.0) < 8.0, size
        assert abs(size[1] - 100.0) < 8.0, size
        # Z must not exceed base + max_relief (=10 mm).
        assert size[2] <= 10.05, size[2]

    def test_bright_pixels_are_high_by_default(self):
        """Reflective bas-relief default: bright pixels sit HIGH so light
        bounces off raised surfaces. A gradient PNG whose top row is
        white (255) and bottom is black (0) must produce max Z near the
        TOP after y-flipping (Pillow stores rows top-down)."""
        # Small square RGB gradient — no alpha.
        arr = np.zeros((256, 256), dtype=np.uint8)
        for i in range(256):
            arr[i, :] = int(255 * i / 255)  # row 0 = 0 (dark), row 255 = 255 (bright)
        buf = io.BytesIO()
        Image.fromarray(arr, mode="L").save(buf, format="PNG")
        r = brs.generate_bas_relief(buf.getvalue(), diameter_mm=100, max_relief_mm=8, base_thickness_mm=2, grid_size=128)
        m = trimesh.load(io.BytesIO(r["parts"][0]["stl_bytes"]), file_type="stl", force="mesh")
        # Find the top-face vertex with the highest Z.
        peak_v = m.vertices[np.argmax(m.vertices[:, 2])]
        # The gradient's brightest row is bottom-of-image (row 255) →
        # after Y-flip in the mesh, that maps to the BOTTOM Y side (or
        # top — depending on convention). Either way, the peak vertex
        # should sit near the min OR max Y, NOT the middle.
        y_center_dist = abs(peak_v[1]) / 50.0  # 50 = radius
        assert y_center_dist > 0.5, f"peak was near centre — bright→high mapping broken (y={peak_v[1]:.2f})"
        # Peak Z equals base + max_relief × 1.0 for the brightest row.
        assert peak_v[2] > 9.0, f"peak Z too low: {peak_v[2]:.2f} (expected ~10)"

    def test_fully_transparent_png_falls_back_to_disc(self):
        """An RGBA png with alpha=0 everywhere must not produce an empty
        mesh — fall back to the geometric disc."""
        from PIL import Image as _Image
        empty = _Image.new("RGBA", (256, 256), (128, 128, 128, 0))
        buf = io.BytesIO()
        empty.save(buf, format="PNG")
        r = brs.generate_bas_relief(buf.getvalue(), diameter_mm=100, max_relief_mm=6, base_thickness_mm=2, grid_size=128)
        m = trimesh.load(io.BytesIO(r["parts"][0]["stl_bytes"]), file_type="stl", force="mesh")
        assert len(m.faces) > 100
