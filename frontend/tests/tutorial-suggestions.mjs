// Unit tests for suggestTutorialFor. Runs in Node — no DOM, no React.
//   $ node frontend/tests/tutorial-suggestions.mjs
//
// We use a tiny inline assert helper so the test file has zero deps.
import { suggestTutorialFor } from "../src/lib/tutorialSuggestions.js";

let failures = 0;
function assertEq(actual, expected, label) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) {
    failures += 1;
    console.error(`FAIL ${label}\n  expected: ${JSON.stringify(expected)}\n  actual:   ${JSON.stringify(actual)}`);
  } else {
    console.log(`ok    ${label}`);
  }
}

// ---- Texture trumps everything else ----
assertEq(
  suggestTutorialFor({ type: "cube", texture: { pattern: "knurl" } }),
  { file: "ForgeSlicer-Texture-Tutorial.pdf", title: "Texture Library" },
  "textured cube → Texture tutorial"
);

// ---- Direct primitive-type matches ----
assertEq(
  suggestTutorialFor({ type: "sweep" }),
  { file: "ForgeSlicer-Sweep-Tutorial.pdf", title: "Sweep + Sketch" },
  "sweep → Sweep tutorial"
);
assertEq(
  suggestTutorialFor({ type: "sketch" }),
  { file: "ForgeSlicer-Sweep-Tutorial.pdf", title: "Sweep + Sketch" },
  "sketch → Sweep tutorial"
);
assertEq(
  suggestTutorialFor({ type: "bolt" }),
  { file: "ForgeSlicer-Hardware-Tutorial.pdf", title: "Hardware Library" },
  "bolt → Hardware tutorial"
);
assertEq(
  suggestTutorialFor({ type: "nut" }),
  { file: "ForgeSlicer-Hardware-Tutorial.pdf", title: "Hardware Library" },
  "nut → Hardware tutorial"
);

// ---- Composite group fallback ----
// buildFastenerPair emits children with groupId 'fastener-…' and a cube/cylinder type.
assertEq(
  suggestTutorialFor({ type: "cylinder", groupId: "fastener-abc123", groupName: "Fastener Pair" }),
  { file: "ForgeSlicer-Hardware-Tutorial.pdf", title: "Hardware Library" },
  "fastener-pair child cylinder → Hardware tutorial via groupId"
);
assertEq(
  suggestTutorialFor({ type: "cube", groupId: "slot-xyz", groupName: "Slot 20×20×20" }),
  { file: "ForgeSlicer-Hardware-Tutorial.pdf", title: "Hardware Library" },
  "slot child cube → Hardware tutorial via groupId 'slot-'"
);
assertEq(
  suggestTutorialFor({ type: "cube", groupId: "cs-99", groupName: "Countersink" }),
  { file: "ForgeSlicer-Hardware-Tutorial.pdf", title: "Hardware Library" },
  "countersink child → Hardware tutorial via groupId 'cs-'"
);
assertEq(
  suggestTutorialFor({ type: "cylinder", groupId: "hexp-7", groupName: "Hex Pocket" }),
  { file: "ForgeSlicer-Hardware-Tutorial.pdf", title: "Hardware Library" },
  "hex-pocket child → Hardware tutorial via groupId 'hexp-'"
);
assertEq(
  suggestTutorialFor({ type: "cube", groupId: "gus-42", groupName: "Gusset" }),
  { file: "ForgeSlicer-Hardware-Tutorial.pdf", title: "Hardware Library" },
  "gusset child → Hardware tutorial via groupId 'gus-'"
);

// ---- Null returns for everything else ----
assertEq(suggestTutorialFor({ type: "cube" }), null, "plain cube → null");
assertEq(suggestTutorialFor({ type: "sphere" }), null, "plain sphere → null");
assertEq(suggestTutorialFor(null), null, "null obj → null");
assertEq(suggestTutorialFor(undefined), null, "undefined obj → null");

if (failures > 0) {
  console.error(`\n${failures} test(s) failed`);
  process.exit(1);
}
console.log("\nAll tutorial-suggestion tests passed.");
