"""Backend tests for iter-106 Gallery community/discovery feature."""
import os
import pytest
import requests

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "https://orca-cad-slice.preview.emergentagent.com").rstrip("/")


EXPECTED_CATEGORIES = [
    "household", "tools", "organizers", "replacement_parts", "toys",
    "education", "cosplay", "mechanical", "decorative", "misc",
]


@pytest.fixture(scope="module")
def session():
    s = requests.Session()
    s.headers.update({"Content-Type": "application/json"})
    return s


# --- Taxonomy endpoint ---
class TestTaxonomy:
    def test_taxonomy_returns_10_categories_in_order(self, session):
        r = session.get(f"{BASE_URL}/api/gallery/_meta/taxonomy", timeout=15)
        assert r.status_code == 200
        data = r.json()
        cats = data.get("categories") or data.get("items") or data
        # Try to normalise
        if isinstance(cats, dict):
            cats = cats.get("categories", [])
        ids = [c["id"] if isinstance(c, dict) else c for c in cats]
        assert ids == EXPECTED_CATEGORIES, f"Got {ids}"


# --- Featured creators ---
class TestFeaturedCreators:
    def test_featured_creators_returns_list_with_required_fields(self, session):
        r = session.get(f"{BASE_URL}/api/gallery/_meta/featured-creators", timeout=15)
        assert r.status_code == 200
        body = r.json()
        creators = body.get("creators") if isinstance(body, dict) else body
        assert isinstance(creators, list)
        assert len(creators) <= 6
        if creators:
            required = {"user_id", "name", "design_count", "remix_count", "source"}
            sample = creators[0]
            missing = required - set(sample.keys())
            assert not missing, f"Missing fields: {missing}; got {sample}"

    def test_steve_shurts_is_featured(self, session):
        r = session.get(f"{BASE_URL}/api/gallery/_meta/featured-creators", timeout=15)
        assert r.status_code == 200
        body = r.json()
        creators = body.get("creators") if isinstance(body, dict) else body
        names = [c.get("name", "") for c in creators]
        assert any("steve" in n.lower() and "shurts" in n.lower() for n in names), f"Steve Shurts not in {names}"


# --- Category filter ---
class TestCategoryFilter:
    def test_filter_by_tools_returns_200(self, session):
        r = session.get(f"{BASE_URL}/api/gallery?category=tools", timeout=15)
        assert r.status_code == 200
        data = r.json()
        items = data if isinstance(data, list) else data.get("items", [])
        # All returned items should have category == tools (if any)
        for item in items:
            if "category" in item:
                assert item["category"] == "tools", f"Item has wrong cat: {item.get('category')}"

    def test_filter_by_household_returns_200(self, session):
        r = session.get(f"{BASE_URL}/api/gallery?category=household", timeout=15)
        assert r.status_code == 200


# --- Backfill verification ---
class TestBackfill:
    def test_at_least_one_item_has_non_misc_category(self, session):
        r = session.get(f"{BASE_URL}/api/gallery", timeout=20)
        assert r.status_code == 200
        data = r.json()
        items = data if isinstance(data, list) else data.get("items", [])
        assert len(items) > 0, "Gallery is empty"
        non_misc = [i for i in items if i.get("category") and i["category"] != "misc"]
        assert len(non_misc) >= 1, f"No items have non-misc category. Sample item keys: {list(items[0].keys()) if items else []}"


# --- Create with category + tags ---
class TestCreateWithCategoryTags:
    def test_create_normalises_tags_and_keeps_category(self, session):
        payload = {
            "name": "TEST_iter106_taxonomy_create",
            "stl_base64": "AA==",
            "category": "tools",
            "tags": ["Keychain", "Outdoor"],
            "author_name": "TestBot",
        }
        r = session.post(f"{BASE_URL}/api/gallery", json=payload, timeout=20)
        assert r.status_code == 200, f"Got {r.status_code}: {r.text[:300]}"
        data = r.json()
        assert data.get("category") == "tools", f"category={data.get('category')}"
        tags = data.get("tags") or []
        # Tags should be lowercased / dashed-normalised
        assert "keychain" in tags or "key-chain" in tags, f"tags={tags}"
        assert "outdoor" in tags, f"tags={tags}"
