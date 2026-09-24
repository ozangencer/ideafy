import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { extractCardImages } from "../serialize-card.js";
import * as opinionNs from "../../lib/prompts/opinion";

/** See run-output.test.ts — `lib/` comes back through the CJS interop. */
function interop<T extends object>(ns: T): T {
  return (ns as { default?: T }).default ?? ns;
}

const { AI_OPINION_PLANNING_RULE } = interop(opinionNs);

// A plan can only build on the AI Opinion if get_card hands it over. The
// SELECT lives inside the tool handler, so read it straight from the source.
const indexSource = readFileSync(new URL("../index.ts", import.meta.url), "utf8");
const getCardHandler = indexSource.slice(
  indexSource.indexOf('case "get_card"'),
  indexSource.indexOf('case "list_cards"')
);

test("get_card selects the AI Opinion and its verdict", () => {
  assert.match(getCardHandler, /ai_opinion as aiOpinion/);
  assert.match(getCardHandler, /ai_verdict as aiVerdict/);
});

test("images pasted into the opinion become their own content blocks", () => {
  const card = {
    description: "<p>desc</p>",
    aiOpinion: '<p>see</p><img src="data:image/png;base64,QUJD"><p>end</p>',
    aiVerdict: "positive",
  };

  const { cleanedCard, images } = extractCardImages(card);

  assert.equal(cleanedCard.aiOpinion, "<p>see</p>[IMAGE: aiOpinion_image_0]<p>end</p>");
  assert.equal(cleanedCard.aiVerdict, "positive");
  assert.deepEqual(
    images.map((img) => [img.id, img.mimeType, img.data]),
    [["aiOpinion_image_0", "image/png", "QUJD"]]
  );
  // The source card is left untouched.
  assert.match(card.aiOpinion, /base64/);
});

test("the planning rule names the field and covers deviations", () => {
  assert.match(AI_OPINION_PLANNING_RULE, /aiOpinion/);
  assert.match(AI_OPINION_PLANNING_RULE, /why you deviated/);
  assert.match(AI_OPINION_PLANNING_RULE, /empty/);
});
