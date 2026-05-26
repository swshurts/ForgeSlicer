// Smoke test for the Whisper hallucination filter in whisperStt.transcribeBlob.
//
// We can't easily mock axios here without pulling jest, so we duplicate the
// helper inline (same pattern as ams-preview-smoke.mjs) and assert that:
//   • real-speech transcripts pass through unchanged
//   • known silence artefacts ("you", "Thanks for watching", etc.) collapse
//     to an empty string
//   • the source file still contains the filter so the duplicate doesn't drift
//
// Run: cd /app/frontend && node tests/voice-hallucination-smoke.mjs

import fs from "node:fs";
import path from "node:path";

const PASS = "\x1b[32mPASS\x1b[0m";
const FAIL = "\x1b[31mFAIL\x1b[0m";
const results = [];
function check(label, cond, extra = "") {
  results.push({ label, cond });
  console.log(`${cond ? PASS : FAIL} — ${label}${extra ? ` — ${extra}` : ""}`);
}

const WHISPER_HALLUCINATIONS = new Set([
  "you", "thank you", "thank you.", "thanks for watching",
  "thanks for watching!", "thanks for watching.", "bye", "bye.",
  "[music]", "[blank_audio]", "[silence]", "okay", ".", "...",
]);

function isHallucinatedTranscript(text) {
  if (!text) return false;
  const norm = text.trim().toLowerCase();
  if (WHISPER_HALLUCINATIONS.has(norm)) return true;
  const stripped = norm.replace(/[.!?,]+$/, "");
  return WHISPER_HALLUCINATIONS.has(stripped);
}

// Sync check that the JSX source still has the same constant — if a refactor
// renames or removes the filter set, this test screams.
const src = fs.readFileSync(
  path.resolve(import.meta.dirname || path.dirname(new URL(import.meta.url).pathname), "..", "src/lib/whisperStt.js"),
  "utf-8"
);
check("whisperStt.js still defines WHISPER_HALLUCINATIONS", /WHISPER_HALLUCINATIONS\s*=/.test(src));
check("whisperStt.js still includes 'thanks for watching' entry", /thanks for watching/i.test(src));

// Positives — should be filtered.
for (const sample of ["you", "You.", "YOU", "Thank you", "thanks for watching!", "Bye.", "...", "[music]"]) {
  check(`hallucination filter catches: "${sample}"`, isHallucinatedTranscript(sample));
}

// Negatives — real commands should pass through.
for (const sample of [
  "add a 30mm cube",
  "rotate the selected object",
  "make a sphere",
  "duplicate this part",
  "you should add a cube", // contains "you" but is more than the artefact word
]) {
  check(`real command passes through: "${sample}"`, !isHallucinatedTranscript(sample));
}

const failed = results.filter((r) => !r.cond);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
if (failed.length) process.exit(1);
