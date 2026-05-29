"""End-to-end smoke test for the ARM64 OrcaSlicer slice pipeline.

Posts a hand-rolled 10mm cube STL to /api/slice/orca and asserts:
  - HTTP 200
  - Returned gcode is non-empty
  - Returned gcode contains expected slicer-emitted tokens

Run from inside /app/backend:
    REACT_APP_BACKEND_URL=https://orca-cad-slice.preview.emergentagent.com \
      python tests/test_orca_arm64_slice.py
"""

import base64
import os
import struct

import requests

API = os.environ.get("REACT_APP_BACKEND_URL", "https://orca-cad-slice.preview.emergentagent.com")


def _build_cube_stl(size: float = 10.0) -> bytes:
    """Produce a binary STL of a centered cube with `size` mm sides.

    Each face is built from two right-angle triangles sharing a hypotenuse.
    Binary STL layout: 80-byte header + uint32 triangle count + 50-byte
    records (12-byte normal + 3 × 12-byte vertex + uint16 attr).
    """
    s = size / 2
    # 8 corners of an axis-aligned cube
    v = [
        (-s, -s, -s), (+s, -s, -s), (+s, +s, -s), (-s, +s, -s),
        (-s, -s, +s), (+s, -s, +s), (+s, +s, +s), (-s, +s, +s),
    ]
    faces = [
        # -Z (bottom)
        ((0, 0, -1), [v[0], v[2], v[1]]),
        ((0, 0, -1), [v[0], v[3], v[2]]),
        # +Z (top)
        ((0, 0,  1), [v[4], v[5], v[6]]),
        ((0, 0,  1), [v[4], v[6], v[7]]),
        # -X
        ((-1, 0, 0), [v[0], v[4], v[7]]),
        ((-1, 0, 0), [v[0], v[7], v[3]]),
        # +X
        ((1, 0, 0),  [v[1], v[2], v[6]]),
        ((1, 0, 0),  [v[1], v[6], v[5]]),
        # -Y
        ((0, -1, 0), [v[0], v[1], v[5]]),
        ((0, -1, 0), [v[0], v[5], v[4]]),
        # +Y
        ((0, 1, 0),  [v[3], v[7], v[6]]),
        ((0, 1, 0),  [v[3], v[6], v[2]]),
    ]
    out = bytearray(b"\x00" * 80)
    out += struct.pack("<I", len(faces))
    for (nx, ny, nz), tri in faces:
        out += struct.pack("<fff", nx, ny, nz)
        for (x, y, z) in tri:
            out += struct.pack("<fff", x, y, z)
        out += struct.pack("<H", 0)
    return bytes(out)


def main() -> int:
    print(f"API: {API}")
    # 1. Status
    r = requests.get(f"{API}/api/slice/orca/status", timeout=10)
    print(f"GET /status -> {r.status_code} {r.json()}")
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["installed"] is True, f"OrcaSlicer not installed: {body}"
    assert body["arch"] == "aarch64", f"Unexpected arch: {body['arch']!r}"

    # 2. Slice a cube using a known-good Custom preset (matches the
    #    backend's _FALLBACK_PRESETS chain — guaranteed to pass Orca's
    #    JSON validator).
    stl = _build_cube_stl(10.0)
    payload = {
        "stl_base64": base64.b64encode(stl).decode("ascii"),
        "printer_preset_name": "MyKlipper 0.4 nozzle",
        "printer_vendor": "Custom",
        "process_preset_name": "0.20mm Standard @MyKlipper",
        "process_vendor": "Custom",
        "filament_preset_name": "Generic PLA @System",
        "filament_vendor": "OrcaFilamentLibrary",
        "description": "ARM64 smoke test",
    }
    print(f"POST /slice (cube 10mm, payload bytes={len(stl)})...")
    r = requests.post(f"{API}/api/slice/orca/slice", json=payload, timeout=180)
    print(f"  status={r.status_code}")
    if r.status_code != 200:
        print(f"  body: {r.text[:1500]}")
        return 1
    data = r.json()
    gcode = data.get("gcode", "")
    print(f"  gcode bytes: {len(gcode)}")
    print(f"  stats: {data.get('stats')}")
    print(f"  job_id: {data.get('job_id')}")
    print(f"  first 8 lines:")
    for ln in gcode.splitlines()[:8]:
        print(f"    {ln}")

    assert len(gcode) > 1024, f"gcode too small: {len(gcode)} bytes"
    assert "G1" in gcode or "G0" in gcode, "no G0/G1 moves found"
    assert "M104" in gcode or "M109" in gcode, "no nozzle temp command found"

    print("\nALL CHECKS PASSED ✔")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
