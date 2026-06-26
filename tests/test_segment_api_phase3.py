"""End-to-end API tests for /api/mesh/segment (Phase 3 frontend support).

Validates auth gating and the exact response shape the frontend dialog
expects: primitive type counts and stats.coverage for cube / sphere / cyl.
"""
import io
import os
from collections import Counter

import pytest
import requests
import trimesh

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "https://orca-cad-slice.preview.emergentagent.com").rstrip("/")
TOKEN = "st_test_nfudltnz7mcm7552"
AUTH = {"Authorization": f"Bearer {TOKEN}", "Content-Type": "application/octet-stream"}


def _stl(mesh) -> bytes:
    buf = io.BytesIO()
    mesh.export(buf, file_type="stl")
    return buf.getvalue()


@pytest.fixture(scope="module")
def cube_stl():
    return _stl(trimesh.creation.box(extents=[20, 20, 20]))


@pytest.fixture(scope="module")
def sphere_stl():
    return _stl(trimesh.creation.icosphere(subdivisions=3, radius=20))


@pytest.fixture(scope="module")
def cyl_stl():
    return _stl(trimesh.creation.cylinder(radius=10, height=30, sections=64))


def test_auth_required_returns_401(cube_stl):
    r = requests.post(f"{BASE_URL}/api/mesh/segment", data=cube_stl,
                      headers={"Content-Type": "application/octet-stream"})
    assert r.status_code == 401


def test_cube_returns_six_planes(cube_stl):
    r = requests.post(f"{BASE_URL}/api/mesh/segment", data=cube_stl, headers=AUTH)
    assert r.status_code == 200
    d = r.json()
    counts = Counter(p["type"] for p in d["primitives"])
    assert counts.get("plane") == 6
    assert counts.get("cylinder", 0) == 0
    assert counts.get("sphere", 0) == 0
    assert d["stats"]["coverage"] >= 0.99


def test_sphere_returns_one_sphere(sphere_stl):
    r = requests.post(f"{BASE_URL}/api/mesh/segment", data=sphere_stl, headers=AUTH)
    assert r.status_code == 200
    d = r.json()
    counts = Counter(p["type"] for p in d["primitives"])
    assert counts.get("sphere") == 1
    assert d["stats"]["coverage"] >= 0.99


def test_cylinder_returns_one_cyl_plus_two_caps(cyl_stl):
    r = requests.post(f"{BASE_URL}/api/mesh/segment", data=cyl_stl, headers=AUTH)
    assert r.status_code == 200
    d = r.json()
    counts = Counter(p["type"] for p in d["primitives"])
    assert counts.get("cylinder") == 1
    assert counts.get("plane") == 2
    assert d["stats"]["coverage"] >= 0.99
