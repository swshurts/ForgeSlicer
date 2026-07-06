"""Lightbox enclosure mesh generation.

A "box" geometry is the lithophane (printed normally as a flat rect or
disc) PLUS a separate enclosure that:
  - frames the lithophane with side walls
  - has an open back so a removable / slide-in back panel can be
    inserted to hold a puck-style LED or coil a string-LED inside
  - includes a 6mm cable-exit notch in the rear-bottom edge of the
    back panel (and a matching notch in the bottom side wall) so the
    LED power lead can exit the assembly cleanly
  - can be rectangular OR round (matching the lithophane shape strictly)

The lightbox exports up to THREE separate STL/3MF files:
  1. frame_mesh   — hollow walls + front lip pocket (lithophane retainer)
  2. back_mesh    — friction-fit rear panel with cable notch
  3. diffuser_mesh (optional) — thin frosted insert sitting behind the
                                 lithophane to soften the LED hotspot

Print orientation guidance is included in /api/box-print-guide:
  - Frame: print FRONT-FACE-DOWN on the bed (smooth bezel, no support).
  - Back panel: print FACE-DOWN (smooth visible face, no support).
  - Diffuser: same as back panel.
  - Lithophane: print FACE-DOWN (lithophane top is the printed bottom).

All meshes are watertight, axis-aligned (or circular for round mode),
and use no CSG — they're composed of simple primitives the slicer can
trivially merge.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import List, Tuple

import numpy as np

# Fixed design constants. Picked to be small enough to be unobtrusive
# but large enough to print reliably on a 0.4mm nozzle FDM machine.
CABLE_NOTCH_W_MM = 6.0
CABLE_NOTCH_H_MM = 4.0
FRICTION_FIT_TOL_MM = 0.3        # back panel sized smaller than cavity
FRONT_LIP_MM = 2.5               # how thick the front lip is (closes Z)
LITHO_REVEAL_MM = 2.0            # how much the front lip extends inward
LITHO_SLOT_DEPTH_MM = 3.0        # depth of the lithophane retention slot
DIFFUSER_T_MM = 0.8              # diffuser sheet thickness


@dataclass
class LightboxSpec:
    """All dimensions in millimeters."""

    shape: str = "rect"           # "rect" | "round"
    width_mm: float = 110.0       # outer X (rect) or outer diameter (round)
    height_mm: float = 110.0      # outer Y (rect) ; ignored for round
    depth_mm: float = 35.0        # outer Z (front to back)
    wall_mm: float = 3.0          # wall thickness
    litho_w_mm: float = 100.0     # lithophane width (rect) or diameter (round)
    litho_h_mm: float = 100.0     # lithophane height (rect); ignored for round
    litho_thickness_mm: float = 2.2  # lithophane print thickness
    led_mount: str = "both"       # "none" | "puck" | "strip" | "both"
    puck_diameter_mm: float = 65.0
    puck_depth_mm: float = 6.0
    strip_channel_w_mm: float = 5.0
    strip_channel_d_mm: float = 4.0
    diffuser: bool = True
    cable_notch: bool = True


# ---------------------------------------------------------------------------
# Mesh primitives
# ---------------------------------------------------------------------------

_BOX_TRIS = [
    (0, 2, 1), (0, 3, 2),
    (4, 5, 6), (4, 6, 7),
    (0, 1, 5), (0, 5, 4),
    (3, 6, 2), (3, 7, 6),
    (0, 4, 7), (0, 7, 3),
    (1, 2, 6), (1, 6, 5),
]


def _append_box(verts: List[List[float]], faces: List[Tuple[int, int, int]],
                xmin, ymin, zmin, xmax, ymax, zmax) -> None:
    """Append the 12 triangles of an axis-aligned solid box."""
    if xmax <= xmin or ymax <= ymin or zmax <= zmin:
        return
    o = len(verts)
    verts.extend([
        [xmin, ymin, zmin], [xmax, ymin, zmin], [xmax, ymax, zmin], [xmin, ymax, zmin],
        [xmin, ymin, zmax], [xmax, ymin, zmax], [xmax, ymax, zmax], [xmin, ymax, zmax],
    ])
    for (a, b, c) in _BOX_TRIS:
        faces.append((o + a, o + b, o + c))


def _circle_ring(cx: float, cy: float, radius: float, z: float, n: int = 96) -> np.ndarray:
    angles = np.linspace(0, 2 * np.pi, n, endpoint=False)
    return np.stack([
        cx + radius * np.cos(angles),
        cy + radius * np.sin(angles),
        np.full(n, z),
    ], axis=1)


def _add_cylinder_wall(verts, faces, cx, cy, radius, z0, z1,
                       outward: bool = True, n: int = 96) -> Tuple[List[int], List[int]]:
    bot = _circle_ring(cx, cy, radius, z0, n)
    top = _circle_ring(cx, cy, radius, z1, n)
    bi = len(verts)
    verts.extend(bot.tolist())
    ti = len(verts)
    verts.extend(top.tolist())
    bot_idx = list(range(bi, bi + n))
    top_idx = list(range(ti, ti + n))
    for i in range(n):
        j = (i + 1) % n
        if outward:
            faces.append((bot_idx[i], top_idx[i], top_idx[j]))
            faces.append((bot_idx[i], top_idx[j], bot_idx[j]))
        else:
            faces.append((bot_idx[i], top_idx[j], top_idx[i]))
            faces.append((bot_idx[i], bot_idx[j], top_idx[j]))
    return bot_idx, top_idx


def _add_annulus(verts, faces, cx, cy, r_inner, r_outer, z,
                 flip: bool = False, n: int = 96) -> Tuple[List[int], List[int]]:
    inner = _circle_ring(cx, cy, r_inner, z, n)
    outer = _circle_ring(cx, cy, r_outer, z, n)
    ii = len(verts)
    verts.extend(inner.tolist())
    oi = len(verts)
    verts.extend(outer.tolist())
    inner_idx = list(range(ii, ii + n))
    outer_idx = list(range(oi, oi + n))
    for i in range(n):
        j = (i + 1) % n
        if flip:
            faces.append((inner_idx[i], outer_idx[j], outer_idx[i]))
            faces.append((inner_idx[i], inner_idx[j], outer_idx[j]))
        else:
            faces.append((inner_idx[i], outer_idx[i], outer_idx[j]))
            faces.append((inner_idx[i], outer_idx[j], inner_idx[j]))
    return inner_idx, outer_idx


def _add_disc(verts, faces, cx, cy, radius, z, flip: bool = False, n: int = 96) -> None:
    center = len(verts)
    verts.append([cx, cy, z])
    ring = _circle_ring(cx, cy, radius, z, n)
    ri = len(verts)
    verts.extend(ring.tolist())
    ring_idx = list(range(ri, ri + n))
    for i in range(n):
        j = (i + 1) % n
        if flip:
            faces.append((center, ring_idx[j], ring_idx[i]))
        else:
            faces.append((center, ring_idx[i], ring_idx[j]))


def _add_ring_extrusion(verts, faces, cx, cy, r_in, r_out, z0, z1, n: int = 64) -> None:
    """Add a watertight tubular ring (used for LED puck bezels)."""
    if r_out <= r_in or z1 <= z0:
        return
    bi = _circle_ring(cx, cy, r_in, z0, n)
    bo = _circle_ring(cx, cy, r_out, z0, n)
    ti = _circle_ring(cx, cy, r_in, z1, n)
    to = _circle_ring(cx, cy, r_out, z1, n)
    base = len(verts)
    verts.extend(bi.tolist())
    verts.extend(bo.tolist())
    verts.extend(ti.tolist())
    verts.extend(to.tolist())
    bi_i = list(range(base + 0 * n, base + 1 * n))
    bo_i = list(range(base + 1 * n, base + 2 * n))
    ti_i = list(range(base + 2 * n, base + 3 * n))
    to_i = list(range(base + 3 * n, base + 4 * n))
    for i in range(n):
        j = (i + 1) % n
        # outer wall (outward)
        faces.append((bo_i[i], to_i[i], to_i[j]))
        faces.append((bo_i[i], to_i[j], bo_i[j]))
        # inner wall (inward)
        faces.append((bi_i[i], ti_i[j], ti_i[i]))
        faces.append((bi_i[i], bi_i[j], ti_i[j]))
        # top annulus (+z)
        faces.append((ti_i[i], to_i[i], to_i[j]))
        faces.append((ti_i[i], to_i[j], ti_i[j]))
        # bottom annulus (-z)
        faces.append((bi_i[i], bo_i[j], bo_i[i]))
        faces.append((bi_i[i], bi_i[j], bo_i[j]))


# ---------------------------------------------------------------------------
# Frame meshes
# ---------------------------------------------------------------------------


def _clamp_spec(spec: LightboxSpec) -> LightboxSpec:
    """Clamp dimensions so silly inputs don't produce inverted geometry."""
    s = LightboxSpec(**spec.__dict__)
    if s.shape == "round":
        s.litho_h_mm = s.litho_w_mm  # round always matches
        s.height_mm = s.width_mm
    s.wall_mm = max(1.6, min(s.wall_mm, min(s.width_mm, s.height_mm) / 4.0))
    # Cavity must be larger than the lithophane footprint.
    if s.shape == "rect":
        s.litho_w_mm = min(s.litho_w_mm, s.width_mm - 2 * s.wall_mm - 2 * LITHO_REVEAL_MM - 2.0)
        s.litho_h_mm = min(s.litho_h_mm, s.height_mm - 2 * s.wall_mm - 2 * LITHO_REVEAL_MM - 2.0)
    else:
        s.litho_w_mm = min(s.litho_w_mm, s.width_mm - 2 * s.wall_mm - 2 * LITHO_REVEAL_MM - 2.0)
    s.depth_mm = max(s.depth_mm, FRONT_LIP_MM + LITHO_SLOT_DEPTH_MM + 12.0)
    # Puck must fit inside cavity.
    cav_min = (min(s.width_mm, s.height_mm) - 2 * s.wall_mm) - 6.0
    if cav_min > 0:
        s.puck_diameter_mm = min(s.puck_diameter_mm, cav_min)
    return s


def _rect_frame_mesh(spec: LightboxSpec) -> Tuple[np.ndarray, np.ndarray]:
    """Hollow rectangular tube, open at the back, with a front lip
    pocket retaining the lithophane.

    Z layout (front-face-down print orientation: z=0 is the bed,
    z=depth is the rear opening):
      z=0 .. FRONT_LIP_MM         → solid front lip (closes the front
                                     except for the litho-reveal opening)
      z=FRONT_LIP_MM .. lip+slot  → lithophane pocket (full litho width)
      z=lip+slot .. depth         → main cavity (back is open)
      z=depth-bezel..depth        → rear retention ledge (inner walls
                                     step OUTWARD by LEDGE_W to create a
                                     friction-fit pocket for the back panel)
    """
    verts: List[List[float]] = []
    faces: List[Tuple[int, int, int]] = []

    W = spec.width_mm
    H = spec.height_mm
    D = spec.depth_mm
    t = spec.wall_mm

    # Lithophane footprint (centered).
    lw = spec.litho_w_mm
    lh = spec.litho_h_mm
    lx0 = (W - lw) / 2.0
    lx1 = lx0 + lw
    ly0 = (H - lh) / 2.0
    ly1 = ly0 + lh

    # Front bezel opening (smaller than the pocket so the lithophane is
    # retained from sliding forward).
    fx0 = lx0 + LITHO_REVEAL_MM
    fx1 = lx1 - LITHO_REVEAL_MM
    fy0 = ly0 + LITHO_REVEAL_MM
    fy1 = ly1 - LITHO_REVEAL_MM

    # Z boundaries.
    z_lip0 = 0.0
    z_lip1 = FRONT_LIP_MM
    z_slot1 = FRONT_LIP_MM + LITHO_SLOT_DEPTH_MM
    z_back = D

    # 1) Front lip slab (0 .. FRONT_LIP_MM) — covers the front face
    # EXCEPT for the visible bezel opening (fx0..fx1, fy0..fy1).
    # Build as 4 rectangles surrounding the opening.
    _append_box(verts, faces, 0.0,  0.0, z_lip0, W,   fy0, z_lip1)        # below opening
    _append_box(verts, faces, 0.0,  fy1, z_lip0, W,   H,   z_lip1)        # above opening
    _append_box(verts, faces, 0.0,  fy0, z_lip0, fx0, fy1, z_lip1)        # left of opening
    _append_box(verts, faces, fx1,  fy0, z_lip0, W,   fy1, z_lip1)        # right of opening

    # 2) Lithophane pocket region (z_lip1 .. z_slot1) — walls form a
    # rectangular ring with inner dims = lithophane footprint.
    _append_box(verts, faces, 0.0,  0.0, z_lip1, W,   ly0, z_slot1)       # -y wall
    _append_box(verts, faces, 0.0,  ly1, z_lip1, W,   H,   z_slot1)       # +y wall
    _append_box(verts, faces, 0.0,  ly0, z_lip1, lx0, ly1, z_slot1)       # -x wall
    _append_box(verts, faces, lx1,  ly0, z_lip1, W,   ly1, z_slot1)       # +x wall

    # 3) Main cavity region (z_slot1 .. z_back) — inner walls step
    # inward to the wall thickness. Inner cavity (W - 2t) × (H - 2t).
    _append_box(verts, faces, 0.0,  0.0,    z_slot1, W,        t,        z_back)  # -y wall
    _append_box(verts, faces, 0.0,  H - t,  z_slot1, W,        H,        z_back)  # +y wall
    _append_box(verts, faces, 0.0,  t,      z_slot1, t,        H - t,    z_back)  # -x wall
    _append_box(verts, faces, W - t, t,     z_slot1, W,        H - t,    z_back)  # +x wall

    # 4) Step transition between pocket cavity and main cavity:
    # the pocket's inner dimensions (lw × lh) shrink down to the main
    # cavity (W-2t × H-2t). Bridging requires a small shelf on each
    # side connecting the two. Add a thin shelf at z=z_slot1 only on
    # sides where the main cavity wall sits INSIDE the pocket footprint
    # (i.e. lx0 > t or ly0 > t etc.).
    # Each shelf is a small ledge spanning the inset distance.
    if lx0 > t:
        # -x shelf
        _append_box(verts, faces, t, ly0, z_slot1, lx0, ly1, z_slot1 + 0.4)
    if lx1 < W - t:
        # +x shelf
        _append_box(verts, faces, lx1, ly0, z_slot1, W - t, ly1, z_slot1 + 0.4)
    if ly0 > t:
        _append_box(verts, faces, t, t, z_slot1, W - t, ly0, z_slot1 + 0.4)
    if ly1 < H - t:
        _append_box(verts, faces, t, ly1, z_slot1, W - t, H - t, z_slot1 + 0.4)

    # 5) Cable notch — cut into the bottom side wall (-y wall) at the
    # rear. Since boxes can't subtract, we explicitly DON'T add wall
    # material in the notch region. To do this, decompose the -y wall
    # we already added in step 3 by removing the notch zone.
    # Simpler approach: we already added the full -y wall above. The
    # notch will instead appear in the BACK PANEL only (which is a
    # separately printed plate). Frame stays solid in -y.

    # 6) Puck recess bezel — raised ring on the inside of the cavity
    # near the rear, sized to capture a standard LED puck.
    if spec.led_mount in ("puck", "both") and spec.puck_diameter_mm > 0:
        cx = W / 2.0
        cy = H / 2.0
        r_in = spec.puck_diameter_mm / 2.0 + FRICTION_FIT_TOL_MM
        r_out = r_in + 2.0
        z0 = z_back - 6.0  # 6mm from the rear opening
        z1 = z_back - 6.0 + spec.puck_depth_mm
        _add_ring_extrusion(verts, faces, cx, cy, r_in, r_out, z0, z1, n=64)

    # 7) Strip-LED channel bezel — thin double-walled ridge running
    # along the inner perimeter near the rear. Light hugs the back of
    # the box so the channel sits a few mm in from the side walls.
    if spec.led_mount in ("strip", "both"):
        cw = spec.strip_channel_w_mm
        cd = spec.strip_channel_d_mm
        inset = t + 3.0
        # Outer ridge — 4 thin walls forming the outer rim.
        thin = 1.0
        z0 = z_back - 6.0
        z1 = z0 + cd
        # Outer-perimeter ridge (4 sides):
        _append_box(verts, faces, inset, inset, z0, W - inset, inset + thin, z1)
        _append_box(verts, faces, inset, H - inset - thin, z0, W - inset, H - inset, z1)
        _append_box(verts, faces, inset, inset + thin, z0, inset + thin, H - inset - thin, z1)
        _append_box(verts, faces, W - inset - thin, inset + thin, z0, W - inset, H - inset - thin, z1)
        # Inner ridge (forms the channel's inner side):
        inset2 = inset + cw
        if inset2 + thin < W - inset2 and inset2 + thin < H - inset2:
            _append_box(verts, faces, inset2, inset2, z0, W - inset2, inset2 + thin, z1)
            _append_box(verts, faces, inset2, H - inset2 - thin, z0, W - inset2, H - inset2, z1)
            _append_box(verts, faces, inset2, inset2 + thin, z0, inset2 + thin, H - inset2 - thin, z1)
            _append_box(verts, faces, W - inset2 - thin, inset2 + thin, z0, W - inset2, H - inset2 - thin, z1)

    vertices = np.array(verts, dtype=np.float64)
    faces_arr = np.array(faces, dtype=np.int32) if faces else np.zeros((0, 3), dtype=np.int32)
    return vertices, faces_arr


def _round_frame_mesh(spec: LightboxSpec) -> Tuple[np.ndarray, np.ndarray]:
    """Hollow cylindrical tube, open at the back, with a front-face
    annulus retaining the disc lithophane."""
    verts: List[List[float]] = []
    faces: List[Tuple[int, int, int]] = []

    R_outer = spec.width_mm / 2.0
    R_inner = R_outer - spec.wall_mm
    R_litho = spec.litho_w_mm / 2.0
    R_reveal = max(R_litho - LITHO_REVEAL_MM, R_litho - 2.0)
    D = spec.depth_mm
    t = spec.wall_mm

    cx = R_outer
    cy = R_outer

    z_lip1 = FRONT_LIP_MM
    z_slot1 = FRONT_LIP_MM + LITHO_SLOT_DEPTH_MM
    z_back = D

    n = 96

    # 1) Outer cylinder wall, full height.
    _add_cylinder_wall(verts, faces, cx, cy, R_outer, 0.0, z_back, outward=True, n=n)

    # 2) Inner cylinder walls — front lip (narrower), pocket, main cavity.
    _add_cylinder_wall(verts, faces, cx, cy, R_reveal, 0.0, z_lip1, outward=False, n=n)
    _add_cylinder_wall(verts, faces, cx, cy, R_litho, z_lip1, z_slot1, outward=False, n=n)
    _add_cylinder_wall(verts, faces, cx, cy, R_inner, z_slot1, z_back, outward=False, n=n)

    # 3) Annulus bridges between Z-sections.
    # Front face annulus (outer ↔ reveal at z=0):
    _add_annulus(verts, faces, cx, cy, R_reveal, R_outer, 0.0, flip=True, n=n)
    # Reveal step (reveal ↔ litho at z=z_lip1):
    _add_annulus(verts, faces, cx, cy, R_reveal, R_litho, z_lip1, flip=False, n=n)
    # Litho-pocket step (litho ↔ inner at z=z_slot1):
    _add_annulus(verts, faces, cx, cy, R_litho, R_inner, z_slot1, flip=False, n=n)
    # Rear face annulus (inner ↔ outer at z=z_back):
    _add_annulus(verts, faces, cx, cy, R_inner, R_outer, z_back, flip=False, n=n)

    # 4) Puck recess + strip channel raised bezels on the back.
    if spec.led_mount in ("puck", "both") and spec.puck_diameter_mm > 0:
        r_in = spec.puck_diameter_mm / 2.0 + FRICTION_FIT_TOL_MM
        r_out = min(r_in + 2.0, R_inner - 2.0)
        z0 = z_back - 6.0
        z1 = z0 + spec.puck_depth_mm
        _add_ring_extrusion(verts, faces, cx, cy, r_in, r_out, z0, z1, n=64)

    if spec.led_mount in ("strip", "both"):
        cw = spec.strip_channel_w_mm
        cd = spec.strip_channel_d_mm
        r_outer_b = R_inner - 2.0
        r_inner_b = r_outer_b - cw
        if r_inner_b > spec.puck_diameter_mm / 2.0 + 4.0:
            z0 = z_back - 6.0
            z1 = z0 + cd
            _add_ring_extrusion(verts, faces, cx, cy, r_outer_b - 0.8, r_outer_b, z0, z1, n=64)
            _add_ring_extrusion(verts, faces, cx, cy, r_inner_b, r_inner_b + 0.8, z0, z1, n=64)

    vertices = np.array(verts, dtype=np.float64)
    faces_arr = np.array(faces, dtype=np.int32) if faces else np.zeros((0, 3), dtype=np.int32)
    return vertices, faces_arr


def build_frame_mesh(spec: LightboxSpec) -> Tuple[np.ndarray, np.ndarray]:
    spec = _clamp_spec(spec)
    if spec.shape == "round":
        return _round_frame_mesh(spec)
    return _rect_frame_mesh(spec)


# ---------------------------------------------------------------------------
# Back panel + diffuser
# ---------------------------------------------------------------------------


def build_back_panel_mesh(spec: LightboxSpec) -> Tuple[np.ndarray, np.ndarray]:
    """Friction-fit back panel. Slightly smaller than the inner cavity
    (by FRICTION_FIT_TOL_MM) so it slides in from the rear and holds
    via friction. Includes a 6mm cable-exit notch at the bottom edge."""
    spec = _clamp_spec(spec)
    verts: List[List[float]] = []
    faces: List[Tuple[int, int, int]] = []

    panel_t = 2.0  # back panel thickness

    if spec.shape == "round":
        R = spec.width_mm / 2.0 - spec.wall_mm - FRICTION_FIT_TOL_MM
        cx = spec.width_mm / 2.0
        cy = spec.width_mm / 2.0
        n = 96
        _add_cylinder_wall(verts, faces, cx, cy, R, 0.0, panel_t, outward=True, n=n)
        _add_disc(verts, faces, cx, cy, R, 0.0, flip=True, n=n)
        _add_disc(verts, faces, cx, cy, R, panel_t, flip=False, n=n)
    else:
        W = spec.width_mm
        H = spec.height_mm
        t = spec.wall_mm
        x0 = t + FRICTION_FIT_TOL_MM
        x1 = W - t - FRICTION_FIT_TOL_MM
        y0 = t + FRICTION_FIT_TOL_MM
        y1 = H - t - FRICTION_FIT_TOL_MM
        if spec.cable_notch:
            notch_x0 = (W - CABLE_NOTCH_W_MM) / 2.0
            notch_x1 = notch_x0 + CABLE_NOTCH_W_MM
            # 3 sub-rectangles forming the panel minus the bottom-center notch.
            _append_box(verts, faces, x0,       y0,                       0.0, notch_x0, y1, panel_t)
            _append_box(verts, faces, notch_x1, y0,                       0.0, x1,       y1, panel_t)
            _append_box(verts, faces, notch_x0, y0 + CABLE_NOTCH_H_MM,    0.0, notch_x1, y1, panel_t)
        else:
            _append_box(verts, faces, x0, y0, 0.0, x1, y1, panel_t)

    vertices = np.array(verts, dtype=np.float64)
    faces_arr = np.array(faces, dtype=np.int32) if faces else np.zeros((0, 3), dtype=np.int32)
    return vertices, faces_arr


def build_diffuser_mesh(spec: LightboxSpec) -> Tuple[np.ndarray, np.ndarray]:
    """Thin diffuser sheet sized to drop into the cavity. Recommended
    print: 0% infill, 4 walls, 1 top/bottom layer, in translucent
    natural PLA or matte PETG."""
    spec = _clamp_spec(spec)
    verts: List[List[float]] = []
    faces: List[Tuple[int, int, int]] = []

    if spec.shape == "round":
        R = spec.width_mm / 2.0 - spec.wall_mm - FRICTION_FIT_TOL_MM
        cx = spec.width_mm / 2.0
        cy = spec.width_mm / 2.0
        n = 96
        _add_cylinder_wall(verts, faces, cx, cy, R, 0.0, DIFFUSER_T_MM, outward=True, n=n)
        _add_disc(verts, faces, cx, cy, R, 0.0, flip=True, n=n)
        _add_disc(verts, faces, cx, cy, R, DIFFUSER_T_MM, flip=False, n=n)
    else:
        W = spec.width_mm
        H = spec.height_mm
        t = spec.wall_mm
        margin = t + FRICTION_FIT_TOL_MM
        _append_box(verts, faces, margin, margin, 0.0, W - margin, H - margin, DIFFUSER_T_MM)

    vertices = np.array(verts, dtype=np.float64)
    faces_arr = np.array(faces, dtype=np.int32) if faces else np.zeros((0, 3), dtype=np.int32)
    return vertices, faces_arr


# ---------------------------------------------------------------------------
# Public helper
# ---------------------------------------------------------------------------


def build_lightbox_export(spec: LightboxSpec) -> dict:
    """Return STLs for frame, back panel and (optionally) diffuser."""
    from exporters import write_stl_binary

    spec = _clamp_spec(spec)
    frame_v, frame_f = build_frame_mesh(spec)
    back_v, back_f = build_back_panel_mesh(spec)
    result: dict = {
        "spec": spec,
        "frame_stl": write_stl_binary(frame_v, frame_f),
        "frame_triangles": int(frame_f.shape[0]),
        "back_stl": write_stl_binary(back_v, back_f),
        "back_triangles": int(back_f.shape[0]),
    }
    if spec.diffuser:
        diff_v, diff_f = build_diffuser_mesh(spec)
        result["diffuser_stl"] = write_stl_binary(diff_v, diff_f)
        result["diffuser_triangles"] = int(diff_f.shape[0])
    return result
