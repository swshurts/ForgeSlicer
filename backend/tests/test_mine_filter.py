"""Regression tests for the `mine=true` query param on /gallery and /components.

When a user saves an item as private it disappears from the default public
listing (by design). They should be able to flip a "Mine" filter in the
Gallery to find it again. These tests verify that:

  1. Without auth, `mine=true` returns an empty list (no information leak).
  2. Without `mine`, the listing still works (back-compat).
  3. The endpoints still accept calls with no extra params.
"""
import os
import requests

BASE_URL = os.environ.get(
    "REACT_APP_BACKEND_URL",
    "https://orca-cad-slice.preview.emergentagent.com",
).rstrip("/")
API = f"{BASE_URL}/api"


class TestMineFilter:
    def test_gallery_mine_unauthenticated_returns_empty(self):
        r = requests.get(f"{API}/gallery?mine=true", timeout=15)
        assert r.status_code == 200
        assert r.json() == []

    def test_components_mine_unauthenticated_returns_empty(self):
        r = requests.get(f"{API}/components?mine=true", timeout=15)
        assert r.status_code == 200
        assert r.json() == []

    def test_gallery_public_listing_still_works(self):
        r = requests.get(f"{API}/gallery", timeout=15)
        assert r.status_code == 200
        assert isinstance(r.json(), list)

    def test_components_public_listing_still_works(self):
        r = requests.get(f"{API}/components", timeout=15)
        assert r.status_code == 200
        assert isinstance(r.json(), list)

    def test_components_public_listing_with_filters_still_works(self):
        # Pre-existing filter combo should keep working alongside the new param.
        r = requests.get(
            f"{API}/components",
            params={"modifier": "positive", "category": "mechanical"},
            timeout=15,
        )
        assert r.status_code == 200
        assert isinstance(r.json(), list)
