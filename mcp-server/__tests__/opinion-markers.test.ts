import test from "node:test";
import assert from "node:assert/strict";

import * as markersNs from "../../lib/opinion-markers";
import { openDatabase } from "../db.js";
import { saveOpinion } from "../shared.js";

// See run-output.test.ts: lib/ modules come back through the CJS interop.
function interop<T extends object>(ns: T): T {
  return (ns as { default?: T }).default ?? ns;
}

const { parseVerdictWord, parseAiVerdict } = interop(markersNs);

// IDE-400: Evaluate, Apply and save_opinion all read the verdict here. The
// Summary Verdict's word decides — a Maybe stays maybe at any score — and
// nothing outside that section is read.
const opinion = (verdict: string, score = 8) =>
  `## Summary Verdict\n\n${verdict}\n\n## Concerns\n\n- No tests yet.\n\n## Final Score\n\n[${score}/10]`;

test("each verdict word maps to its value", () => {
  assert.equal(parseVerdictWord(opinion("Strong Yes. Ship it.")), "strong_yes");
  assert.equal(parseAiVerdict(opinion("Strong Yes. Ship it.")), "positive");
  assert.equal(parseAiVerdict(opinion("Yes — worth it.")), "positive");
  assert.equal(parseAiVerdict(opinion("No. Out of scope.")), "negative");
  assert.equal(parseVerdictWord(opinion("Strong No.")), "strong_no");
});

test("a Maybe stays maybe even at 8/10", () => {
  assert.equal(parseAiVerdict(opinion("Maybe — depends on the cloud merge.", 8)), "maybe");
});

test("the verdict can sit on the heading line", () => {
  assert.equal(parseVerdictWord("## Summary Verdict (Yes)\n\nWorth doing."), "yes");
});

test("Turkish verdicts read the same, and 'no' inside a Turkish word does not count", () => {
  assert.equal(parseVerdictWord(opinion("Güçlü Evet — hemen yapalım.")), "strong_yes");
  assert.equal(parseVerdictWord(opinion("Belki — önce notlarını topla.")), "maybe");
  assert.equal(parseVerdictWord(opinion("Önce notlarını oku. Hayır.")), "no");
});

test("the first verdict word wins", () => {
  assert.equal(parseVerdictWord(opinion("Yes, but Maybe later for the cloud side.")), "yes");
});

test("saved TipTap HTML reads the same as markdown", () => {
  const html =
    "<h2>Summary Verdict</h2><p>Maybe &mdash; the score is high but the scope isn&#39;t clear.</p>" +
    "<h2>Concerns</h2><ul><li><p>No tests.</p></li></ul>";
  assert.equal(parseAiVerdict(html), "maybe");
});

test("no Summary Verdict section, no verdict — the rest of the text is never read", () => {
  assert.equal(parseAiVerdict("## Concerns\n\nNo. This is a bad idea.\n\n## Final Score\n\n[2/10]"), null);
  assert.equal(parseAiVerdict(opinion("Hard to call either way.")), null);
});

test("save_opinion stores the verdict the text names over the one it was sent", () => {
  const db = openDatabase(":memory:");
  db.exec(`CREATE TABLE cards (id TEXT PRIMARY KEY, ai_opinion TEXT, ai_verdict TEXT, updated_at TEXT)`);
  db.prepare(`INSERT INTO cards VALUES ('c1', NULL, NULL, 't0')`).run();
  const read = () => ({ ...(db.prepare(`SELECT ai_verdict, updated_at FROM cards`).get() as object) });

  const maybe = opinion("Maybe — needs a chat first.", 8);
  assert.deepEqual(
    saveOpinion(db, { id: "c1", html: "<p/>", source: maybe, fallbackVerdict: "positive", now: "t1" }),
    { ok: true, verdict: "maybe" }
  );
  assert.deepEqual(read(), { ai_verdict: "maybe", updated_at: "t1" });

  // Nothing readable in the text: the argument fills in.
  saveOpinion(db, { id: "c1", html: "<p/>", source: "free text", fallbackVerdict: "negative", now: "t2" });
  assert.deepEqual(read(), { ai_verdict: "negative", updated_at: "t2" });

  assert.deepEqual(saveOpinion(db, { id: "nope", html: "", source: maybe, now: "t3" }), {
    ok: false,
    reason: "not-found",
  });
});

test("a Turkish 'Özet Kararı' heading counts as the Summary Verdict", () => {
  assert.equal(parseAiVerdict("<h2>Özet Kararı</h2><p><strong>Evet.</strong> Ucuz bir kazanç.</p>"), "positive");
});
