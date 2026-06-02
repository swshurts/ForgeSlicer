/**
 * Iter-82 — customSlicers registry tests. The launcher itself can't
 * be unit-tested in jsdom (no real protocol handler / window focus),
 * so we focus on the CRUD + validation surface that's actually
 * called from React components.
 */
import {
  BUILTIN_SLICERS, loadCustomSlicers, addCustomSlicer, removeCustomSlicer,
  getAllSlicers, getPreferredSlicer, setPreferredSlicerId,
} from "./customSlicers";

beforeEach(() => {
  try { localStorage.clear(); } catch { /* jsdom always supports localStorage */ }
});

describe("BUILTIN_SLICERS", () => {
  test("contains at least the 7 known mainstream slicers", () => {
    const names = BUILTIN_SLICERS.map((s) => s.name);
    expect(names).toEqual(expect.arrayContaining([
      "OrcaSlicer", "Bambu Studio", "PrusaSlicer", "SuperSlicer",
      "Flash Studio Desktop", "Ultimaker Cura",
    ]));
  });

  test("every built-in has a valid URL protocol", () => {
    for (const s of BUILTIN_SLICERS) {
      expect(s.protocol).toMatch(/^[a-z][a-z0-9+\-.]*:\/?\/?$/i);
    }
  });
});

describe("loadCustomSlicers", () => {
  test("returns empty array on fresh storage", () => {
    expect(loadCustomSlicers()).toEqual([]);
  });

  test("filters out malformed entries silently", () => {
    localStorage.setItem("forgeslicer.customSlicers.v1", JSON.stringify([
      { id: "good", name: "Good", protocol: "good://" },
      { id: "bad-no-protocol", name: "Bad" },             // missing protocol
      "not even an object",
      null,
      { id: "bad-protocol", name: "X", protocol: "no-colon-here" },
    ]));
    const list = loadCustomSlicers();
    expect(list.length).toBe(1);
    expect(list[0].id).toBe("good");
  });

  test("tolerates corrupted JSON without crashing", () => {
    localStorage.setItem("forgeslicer.customSlicers.v1", "{this is { not json");
    expect(() => loadCustomSlicers()).not.toThrow();
    expect(loadCustomSlicers()).toEqual([]);
  });
});

describe("addCustomSlicer validation", () => {
  test("happy path: assigns an id and persists", () => {
    const out = addCustomSlicer({
      name: "Bambu Studio Open",
      protocol: "bambustudio-open://",
      installUrl: "https://example.com/dl",
    });
    expect(out.id).toMatch(/^user-bambu-studio-open-/);
    expect(loadCustomSlicers().length).toBe(1);
  });

  test("rejects empty name", () => {
    expect(() => addCustomSlicer({ name: "", protocol: "x://" })).toThrow(/name/i);
    expect(() => addCustomSlicer({ name: "   ", protocol: "x://" })).toThrow(/name/i);
  });

  test("rejects malformed protocol", () => {
    expect(() => addCustomSlicer({ name: "X", protocol: "" })).toThrow(/protocol/i);
    expect(() => addCustomSlicer({ name: "X", protocol: "no-colon" })).toThrow(/protocol/i);
    expect(() => addCustomSlicer({ name: "X", protocol: "1starts-with-digit://" })).toThrow(/protocol/i);
  });

  test("rejects names that collide with built-ins", () => {
    expect(() => addCustomSlicer({ name: "PrusaSlicer", protocol: "prusa://" })).toThrow(/built-in/i);
    // Case-insensitive collision check.
    expect(() => addCustomSlicer({ name: "prusaslicer", protocol: "prusa://" })).toThrow(/built-in/i);
  });

  test("multiple additions of same name get unique ids (timestamp-suffixed)", () => {
    const a = addCustomSlicer({ name: "MySlicer", protocol: "ms1://" });
    const b = addCustomSlicer({ name: "MySlicer 2", protocol: "ms2://" });
    expect(a.id).not.toBe(b.id);
    expect(loadCustomSlicers().length).toBe(2);
  });
});

describe("removeCustomSlicer", () => {
  test("removes by id without affecting others", () => {
    const a = addCustomSlicer({ name: "A", protocol: "a://" });
    const b = addCustomSlicer({ name: "B", protocol: "b://" });
    removeCustomSlicer(a.id);
    const remaining = loadCustomSlicers();
    expect(remaining.length).toBe(1);
    expect(remaining[0].id).toBe(b.id);
  });

  test("clearing the preferred slicer when removing it", () => {
    const a = addCustomSlicer({ name: "A", protocol: "a://" });
    setPreferredSlicerId(a.id);
    expect(getPreferredSlicer().id).toBe(a.id);
    removeCustomSlicer(a.id);
    expect(getPreferredSlicer()).toBeNull();
  });
});

describe("getAllSlicers + preferred flag", () => {
  test("merges builtins + customs, tags isPreferred correctly", () => {
    addCustomSlicer({ name: "Custom A", protocol: "custom-a://" });
    setPreferredSlicerId("prusaslicer");
    const all = getAllSlicers();
    expect(all.length).toBe(BUILTIN_SLICERS.length + 1);
    const prusa = all.find((s) => s.id === "prusaslicer");
    expect(prusa.isPreferred).toBe(true);
    const others = all.filter((s) => s.id !== "prusaslicer");
    for (const o of others) expect(o.isPreferred).toBe(false);
  });

  test("getPreferredSlicer returns null when no preference set", () => {
    expect(getPreferredSlicer()).toBeNull();
  });
});
