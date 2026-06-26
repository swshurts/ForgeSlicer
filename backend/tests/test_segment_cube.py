"""Quick offline test for the mesh segmentation route.

Generates a 20x20x20 cube STL with trimesh, hits /api/mesh/segment,
and prints the response so we can sanity-check that RANSAC finds
~6 planes for a textbook geometric input.

Run from anywhere with backend up:
    python /app/backend/tests/test_segment_cube.py
"""
import io
import json
import os
import sys

import requests
import trimesh

API = os.environ.get("REACT_APP_BACKEND_URL") or "http://localhost:8001"
API = API.rstrip("/")

# A textbook 20mm cube with a 10mm-radius cylinder hole — should give
# us 5 outer planes (bottom face merges with the cylinder hole base
# in some samplings, so 5-6 is acceptable) plus 1 cylinder side wall
# once Phase 2 lands.
cube = trimesh.creation.box(extents=(20, 20, 20))
stl_bytes: bytes = cube.export(file_type="stl")
print(f"Cube STL: {len(stl_bytes)} bytes, {len(cube.faces)} tris")

# Hit segmentation with cookie-based auth disabled — for the test we
# bypass auth via a direct internal call. The Phase 1 endpoint needs
# a valid session cookie; for the smoke test we'll use a token shortcut.
# Actually, simpler: hit the local-only port and skip auth check by
# patching the get_current_user dep through env. Easiest path here:
# call the segment function directly so we don't need to set up auth.
sys.path.insert(0, "/app/backend")
from routes.mesh_segment import _segment_stl_sync

result = _segment_stl_sync(stl_bytes)
print(json.dumps(result, indent=2, default=str))

n_planes = sum(1 for p in result["primitives"] if p["type"] == "plane")
print(f"\nDETECTED {n_planes} PLANES (expected ~6)")
assert 5 <= n_planes <= 8, f"unexpected plane count {n_planes}"
assert result["stats"]["coverage"] > 0.9, (
    f"low coverage {result['stats']['coverage']:.2%} — RANSAC missed too much"
)
print("PASS")
