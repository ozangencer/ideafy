import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

// Imported dynamically, not with a static `import {}`. mcp-server is
// "type": "module" while the repo root is not, so a static named import
// across that boundary fails to link ("does not provide an export named ...")
// even though the export is right there. A dynamic import resolves the
// namespace at runtime and sees it. The module itself is pure regex with no
// dependencies, which is what makes importing it from here viable at all.
//
// The specifier goes through a const because the root tsconfig covers this
// file too and rejects a literal ending in ".ts" (TS5097) — which tsx needs.
const DETECTOR_MODULE = "../../lib/card-request-detection.ts";
const { promptLooksLikeCardRequest } = await import(DETECTOR_MODULE);

// The bug these tests exist for: a user whose very first message said
// "Ideafy'da bir kart açabilirsin" still got asked "Bunu Backlog kartı olarak
// açayım mı?". The creation-offer policy said to ask and had no clause for
// permission that had already been given.
//
// Two things guard the fix. The detector below is the cheap keyword signal,
// and it is deliberately fallible — see the complaint case. The real fix is
// the exception clause in the policy text, so the second half of this file
// asserts that clause is still ordered ahead of the asking clause.

test("recognises Turkish card requests", () => {
  for (const prompt of [
    "Ideafy'da bir kart açabilirsin.",
    "bunun için bir kart aç",
    "kartı oluştur ve başla",
    "buna bir kart ekle lütfen",
    "KART AÇ",
  ]) {
    assert.equal(promptLooksLikeCardRequest(prompt), true, prompt);
  }
});

test("recognises English card requests", () => {
  for (const prompt of [
    "create a card for this",
    "Open a new card and get going",
    "add an ideafy card",
    "make a card, then implement it",
  ]) {
    assert.equal(promptLooksLikeCardRequest(prompt), true, prompt);
  }
});

test("recognises 'add this to Ideafy' without the word card", () => {
  assert.equal(promptLooksLikeCardRequest("bunu ideafy'a ekle"), true);
  assert.equal(promptLooksLikeCardRequest("ideafy'e kaydet"), true);
});

test("ignores ordinary work requests", () => {
  for (const prompt of [
    "bu fonksiyonu refactor eder misin",
    "why does the build fail on main?",
    "credit card validation is broken",
  ]) {
    assert.equal(promptLooksLikeCardRequest(prompt), false, prompt);
  }
});

test("returns false for empty or non-string input", () => {
  assert.equal(promptLooksLikeCardRequest(""), false);
  assert.equal(promptLooksLikeCardRequest(null), false);
  assert.equal(promptLooksLikeCardRequest(undefined), false);
});

// Documents the known limit rather than pretending it away. A complaint about
// card creation carries the same keywords as a request for one, so the
// detector says yes here and is wrong. This is exactly why the signal is
// rendered into the policy as "a hint, not a command" — the model reads the
// message and overrules it.
test("also flags a complaint about card creation — hence advisory only", () => {
  const complaint = "kart aç dememe rağmen hook her halükarda soruyor";
  assert.equal(promptLooksLikeCardRequest(complaint), true);
});

// Drift guard on the policy text itself. The text lives in an import-free
// module so mcp-server can compile a copy of it, but this file reads it as
// source anyway — the assertions below are about clause ORDER in the written
// text, which a runtime import would not show. Same approach as
// phase-policy.test.ts.
const policySrc = readFileSync(
  new URL("../../lib/prompts/phase-policy.ts", import.meta.url),
  "utf8"
);

test("the exception clause is ordered ahead of the asking clause", () => {
  const exceptionAt = policySrc.indexOf("1. EXCEPTION");
  const askAt = policySrc.indexOf("STOP before doing anything else and ask");

  assert.ok(exceptionAt !== -1, "creation offer lost its EXCEPTION clause");
  assert.ok(askAt !== -1, "creation offer lost its ask clause");
  assert.ok(
    exceptionAt < askAt,
    "the EXCEPTION clause must come before the ask clause, or the model " +
      "hits 'STOP and ASK' before it ever reads that permission was given"
  );
});

test("the signal is worded as a hint, not a command", () => {
  assert.match(policySrc, /The match is a hint, not a command/);
});
