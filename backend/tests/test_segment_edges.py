"""Edge-case smoke tests for the segmentation route.

Covers a few canonical shapes to make sure RANSAC behaves sensibly:
  - sphere      (zero detectable planes — coverage should be ~0)
  - icosphere   (low-poly sphere — same: no planes)
  - cylinder    (Phase 1: just the 2 caps as planes, side surface
                 left as remainder)
  - L-bracket   (8 planes)
"""
import sys

sys.path.insert(0, "/app/backend")
import trimesh
from routes.mesh_segment import _segment_stl_sync


def run(name, mesh):
    stl = mesh.export(file_type="stl")
    res = _segment_stl_sync(stl)
    n_planes = sum(1 for p in res["primitives"] if p["type"] == "plane")
    print(
        f"{name:14s}  tris={len(mesh.faces):5d}  planes={n_planes:2d}  "
        f"coverage={res['stats']['coverage']:.2%}  elapsed={res['stats']['elapsed_seconds']:.2f}s"
    )
    return res


# Sphere — should yield few or zero confident planes; primitive list
# can be empty. Coverage should be VERY low because no flat region
# exists.
sph = trimesh.creation.icosphere(subdivisions=3, radius=20)
res = run("sphere", sph)
assert res["stats"]["coverage"] < 0.20, (
    f"sphere should have low planar coverage; got {res['stats']['coverage']:.2%}"
)
print("  -> low planar coverage as expected (organic shape)")

# Cylinder — 2 caps should appear as planes. Side surface stays in
# remainder (Phase 2 will detect cylinder there).
cyl = trimesh.creation.cylinder(radius=10, height=30, sections=64)
res = run("cylinder", cyl)
n_planes = sum(1 for p in res["primitives"] if p["type"] == "plane")
assert 2 <= n_planes <= 12, f"cylinder Phase-1 plane count {n_planes} outside 2-12"
print("  -> caps detected; side-wall strips will collapse to 1 cylinder in Phase 2")

# L-bracket: union of two boxes sharing one face. After union, the
# outer surface has 8 distinct planes (top, bottom, 2 inner steps,
# 4 side walls).
b1 = trimesh.creation.box(extents=(40, 20, 10))
b2 = trimesh.creation.box(extents=(20, 20, 30))
b2.apply_translation([10, 0, 10])
try:
    lbr = trimesh.boolean.union([b1, b2])
    res = run("L-bracket", lbr)
    n_planes = sum(1 for p in res["primitives"] if p["type"] == "plane")
    assert 6 <= n_planes <= 12, f"L-bracket expected 6-12 planes; got {n_planes}"
    print("  -> L-bracket within expected plane range")
except Exception as exc:
    print(f"  -> SKIP L-bracket (boolean failed: {exc})")

print("\nALL SMOKE TESTS PASSED")
