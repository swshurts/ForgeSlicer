"""Server-side STL thumbnail renderer.

Renders small (256×256) PNG previews of mesh files using matplotlib's
`mpl_toolkits.mplot3d` (headless Agg backend — no OpenGL required).
Produces a base64-encoded PNG body compatible with the
``thumbnail_base64`` field on `db.gallery` and `db.components`.

Used by the admin health dashboard to backfill thumbnails for legacy
items whose client-side render was lost (deleted account, migration,
etc.).
"""
from __future__ import annotations

import base64
import io
import logging
import os
import re

import matplotlib
matplotlib.use("Agg")  # noqa: E402  headless — must precede pyplot import
import matplotlib.pyplot as plt  # noqa: E402
from mpl_toolkits.mplot3d.art3d import Poly3DCollection  # noqa: E402
import numpy as np  # noqa: E402
import trimesh  # noqa: E402

logger = logging.getLogger(__name__)

# Small size keeps DB payload manageable — gallery card only shows the
# thumbnail at ~200×150 px anyway.
THUMB_PX = 256


def _decode_stl(b64: str) -> bytes:
    """Strip an optional ``data:*;base64,`` prefix and decode the STL body."""
    if not b64:
        raise ValueError("empty stl_base64")
    if "," in b64[:64]:
        b64 = b64.split(",", 1)[1]
    b64 = re.sub(r"\s+", "", b64)
    return base64.b64decode(b64)


def render_stl_thumbnail(stl_b64: str, px: int = THUMB_PX) -> str:
    """Render a mesh to a base64 PNG (no ``data:`` prefix — the DB stores
    the raw body). Raises ``ValueError`` on any load or render failure so
    the caller can log + skip. The output matches the shape frontend
    thumbnails use so gallery cards can render it without special-casing.
    """
    raw = _decode_stl(stl_b64)
    try:
        loaded = trimesh.load(io.BytesIO(raw), file_type="stl", force="mesh")
    except Exception as e:  # noqa: BLE001
        raise ValueError(f"stl parse failed: {e}") from e

    # Downstream can hand us a Scene when the STL contains multiple bodies;
    # concatenate so we render every part in one frame.
    if isinstance(loaded, trimesh.Scene):
        if not loaded.geometry:
            raise ValueError("stl scene contains no geometry")
        mesh = trimesh.util.concatenate(list(loaded.geometry.values()))
    else:
        mesh = loaded

    if mesh.vertices is None or len(mesh.vertices) == 0 or len(mesh.faces) == 0:
        raise ValueError("mesh is empty")

    # Isometric-ish view: rotate around Z so the "front" isn't axis-aligned,
    # then let matplotlib's default elev=30/azim=-60 give a friendly angle.
    verts = np.asarray(mesh.vertices, dtype=np.float64)
    faces = np.asarray(mesh.faces, dtype=np.int64)

    # For huge meshes, decimate visually so matplotlib doesn't choke.
    # 40k triangles renders in ~1 s; anything beyond that we sample down
    # to keep the batch job snappy.
    if len(faces) > 40_000:
        step = max(1, len(faces) // 40_000)
        faces = faces[::step]

    # Compute per-face normals for flat shading. Normalise + take Z
    # component as a lambertian proxy against a light coming from above.
    tris = verts[faces]
    v0, v1, v2 = tris[:, 0], tris[:, 1], tris[:, 2]
    n = np.cross(v1 - v0, v2 - v0)
    lens = np.linalg.norm(n, axis=1, keepdims=True) + 1e-9
    n_hat = n / lens
    shade = np.clip(0.5 + 0.5 * n_hat[:, 2], 0.35, 1.0)  # 0.35..1 grey

    dpi = 100
    fig = plt.figure(figsize=(px / dpi, px / dpi), dpi=dpi)
    try:
        ax = fig.add_subplot(111, projection="3d")
        ax.set_axis_off()
        fig.patch.set_facecolor("#0f172a")  # slate-900 to match dark UI
        ax.set_facecolor("#0f172a")

        colours = np.stack([
            0.28 + 0.62 * shade,   # R — warm orange highlight
            0.16 + 0.48 * shade,
            0.05 + 0.20 * shade,
        ], axis=1)
        collection = Poly3DCollection(
            tris,
            facecolors=colours,
            edgecolors="none",
            linewidths=0,
            antialiased=False,
        )
        ax.add_collection3d(collection)

        # Equal-aspect box so the object doesn't look squashed.
        mins = verts.min(axis=0)
        maxs = verts.max(axis=0)
        centre = (mins + maxs) / 2.0
        span = float(np.max(maxs - mins))
        if span <= 0:
            span = 1.0
        pad = span * 0.55
        ax.set_xlim(centre[0] - pad, centre[0] + pad)
        ax.set_ylim(centre[1] - pad, centre[1] + pad)
        ax.set_zlim(centre[2] - pad, centre[2] + pad)
        ax.view_init(elev=25, azim=-40)
        try:
            ax.set_box_aspect((1, 1, 1))
        except Exception:  # pragma: no cover — older matplotlib fallback
            pass

        buf = io.BytesIO()
        fig.savefig(buf, format="png", facecolor="#0f172a", dpi=dpi,
                    bbox_inches="tight", pad_inches=0)
    finally:
        plt.close(fig)

    return base64.b64encode(buf.getvalue()).decode("ascii")


def is_missing_thumbnail(doc: dict) -> bool:
    """Row eligible for regeneration — no thumbnail body OR the body is
    ridiculously small (a broken 1×1 PNG left over from a failed save)."""
    t = doc.get("thumbnail_base64") or ""
    return len(t) < 200


def has_usable_stl(doc: dict) -> bool:
    """A thumbnail can only be rebuilt if the STL blob is still present.
    Extremely tiny or absent blobs get skipped (they'd fail parse anyway)."""
    s = doc.get("stl_base64") or ""
    return len(s) > 512
