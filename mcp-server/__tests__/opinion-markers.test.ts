import test from "node:test";
import assert from "node:assert/strict";

import * as markersNs from "../../lib/opinion-markers";
import { openDatabase } from "../db.js";
import { saveOpinion } from "../shared.js";

// See run-output.test.ts: lib/ modules come back through the CJS interop.
function interop<T extends object>(ns: T): T {
  return (ns as { default?: T }).default ?? ns;
}

const { parseVerdictWord, parseAiVerdict, parseOpinionMarkers, normalizeComplexity } = interop(markersNs);

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

const CARDS_TABLE = `CREATE TABLE cards (
  id TEXT PRIMARY KEY, ai_opinion TEXT, ai_verdict TEXT, ai_score INTEGER,
  priority TEXT NOT NULL DEFAULT 'medium', complexity TEXT NOT NULL DEFAULT 'medium', updated_at TEXT)`;

test("save_opinion stores the verdict the text names over the one it was sent", () => {
  const db = openDatabase(":memory:");
  db.exec(CARDS_TABLE);
  db.prepare(`INSERT INTO cards (id, updated_at) VALUES ('c1', 't0')`).run();
  const read = () => ({ ...(db.prepare(`SELECT ai_verdict, updated_at FROM cards`).get() as object) });

  const maybe = opinion("Maybe — needs a chat first.", 8);
  const saved = saveOpinion(db, { id: "c1", html: "<p/>", source: maybe, fallbackVerdict: "positive", now: "t1" });
  assert.equal(saved.ok && saved.verdict, "maybe");
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

// IDE-403: the tags come first, the score is stored, and priority/complexity
// land the same from every path.
const tagged = `## Summary Verdict

[VERDICT: maybe] — Yes in spirit, but the scope is unclear.

## Priority

[PRIORITY: high] — blocks the release.

## Complexity

[COMPLEXITY: very_high] — touches four write paths.

## Final Score

[SCORE: 6/10] — real problem, wide scope.`;

test("tags decide over the Summary Verdict prose and carry the other three fields", () => {
  assert.deepEqual(parseOpinionMarkers(tagged), {
    verdictWord: "maybe",
    verdict: "maybe",
    score: 6,
    priority: "high",
    complexity: "high",
  });
});

test("an untagged Turkish opinion still reads verdict and score from its sections", () => {
  const turkish =
    "## Summary Verdict\n\nBelki — önce notlarını topla.\n\n## Concerns\n\n- 3/10 kart etkilenir.\n\n## Final Score\n\n[7/10] — makul.";
  const markers = parseOpinionMarkers(turkish);
  assert.equal(markers.verdictWord, "maybe");
  assert.equal(markers.score, 7, "only the Final Score section's N/10 counts, not the 3/10 under Concerns");
  assert.equal(parseOpinionMarkers("## Summary Verdict\n\nGüçlü Evet.\n").verdictWord, "strong_yes");
  assert.equal(parseOpinionMarkers("<h2>Final Puanı</h2><p><strong>7/10.</strong> Fikir doğru.</p>").score, 7);
});

test("saved TipTap HTML reads tags and score the same as markdown", () => {
  const html =
    "<h2>Summary Verdict</h2><p>[VERDICT: strong_yes] — ship it.</p>" +
    "<h2>Final Score</h2><p>[SCORE: 9/10] — cheap and clear.</p>";
  const markers = parseOpinionMarkers(html);
  assert.equal(markers.verdict, "positive");
  assert.equal(markers.score, 9);
  // Opinions written before the tags existed: "[8/10]" under Final Score.
  assert.equal(parseOpinionMarkers("<h2>Final Score</h2><p>[8/10] — solid.</p>").score, 8);
});

test("the prompt template and quoted tags never read as values", () => {
  // A tag holds one value; the template's value lists are not tags.
  assert.deepEqual(
    parseOpinionMarkers(
      "[VERDICT: strong_yes/yes/maybe/no/strong_no]\n[PRIORITY: low/medium/high]\n[COMPLEXITY: trivial/low/medium/high/very_high]\n[SCORE: X/10]"
    ),
    { verdictWord: null, verdict: null, score: null, priority: null, complexity: null }
  );
  // A tag quoted as code is an example, not the card's value.
  const quoted = "A plan may write `[VERDICT: no]` or `[PRIORITY: high]`.\n\n[PRIORITY: low]";
  assert.equal(parseOpinionMarkers(quoted).verdict, null);
  assert.equal(parseOpinionMarkers(quoted).priority, "low");
  assert.equal(parseOpinionMarkers("<p><code>[SCORE: 9/10]</code></p>").score, null);
});

test("a score outside 0–10 is not a score", () => {
  assert.equal(parseOpinionMarkers("[SCORE: 12/10]").score, null);
  assert.equal(parseOpinionMarkers("[SCORE: 7.6/10]").score, 8);
  assert.equal(parseOpinionMarkers("[SCORE: 0]").score, 0);
});

test("every complexity value any path ever wrote folds onto three levels", () => {
  assert.equal(normalizeComplexity("trivial"), "low");
  assert.equal(normalizeComplexity("simple"), "low");
  assert.equal(normalizeComplexity("low"), "low");
  assert.equal(normalizeComplexity("medium"), "medium");
  assert.equal(normalizeComplexity("High"), "high");
  assert.equal(normalizeComplexity("complex"), "high");
  assert.equal(normalizeComplexity("very_high"), "high");
  assert.equal(normalizeComplexity("huge"), null);
  assert.equal(normalizeComplexity(undefined), null);
});

test("save_opinion writes verdict, score, priority and complexity from one opinion", () => {
  const db = openDatabase(":memory:");
  db.exec(CARDS_TABLE);
  db.prepare(`INSERT INTO cards (id, priority, complexity, updated_at) VALUES ('c1', 'low', 'simple', 't0')`).run();
  const read = () => ({
    ...(db.prepare(`SELECT ai_verdict, ai_score, priority, complexity FROM cards`).get() as object),
  });

  const saved = saveOpinion(db, { id: "c1", html: "<p/>", source: tagged, now: "t1" });
  assert.deepEqual(saved, { ok: true, verdict: "maybe", score: 6, priority: "high", complexity: "high" });
  assert.deepEqual(read(), { ai_verdict: "maybe", ai_score: 6, priority: "high", complexity: "high" });

  // Apply's append mode: a fragment naming nothing keeps verdict and score.
  saveOpinion(db, { id: "c1", html: "<p/>", source: "## Notes\n\nOne more risk.", mode: "append", now: "t2" });
  assert.deepEqual(read(), { ai_verdict: "maybe", ai_score: 6, priority: "high", complexity: "high" });

  // A full replacement that names no verdict or score clears both, and leaves
  // priority/complexity as they were — they may have been picked by hand.
  saveOpinion(db, { id: "c1", html: "<p/>", source: "## Concerns\n\n- Unclear.", now: "t3" });
  assert.deepEqual(read(), { ai_verdict: null, ai_score: null, priority: "high", complexity: "high" });
});
