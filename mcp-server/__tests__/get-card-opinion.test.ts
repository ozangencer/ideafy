import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { extractCardImages, buildOpinionPlanningNote, buildEvaluationNote } from "../serialize-card.js";
import * as opinionNs from "../../lib/prompts/opinion";
import * as evaluationNs from "../../lib/prompts/evaluation";
import * as priorDecisionsNs from "../../lib/prompts/prior-decisions";

/** See run-output.test.ts — `lib/` comes back through the CJS interop. */
function interop<T extends object>(ns: T): T {
  return (ns as { default?: T }).default ?? ns;
}

const { AI_OPINION_PLANNING_RULE } = interop(opinionNs);
const { EVALUATION_OUTPUT_SCHEMA } = interop(evaluationNs);
const { PRIOR_DECISIONS_EVALUATION_RULE } = interop(priorDecisionsNs);

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

// A session the user opens by hand never passes through Ideafy's planning
// prompts, so get_card has to carry the rule itself — but only when there is
// an opinion to build on and the card is somewhere a plan gets written.

test("get_card adds the planning rule when the card has an opinion to build on", () => {
  for (const status of ["backlog", "bugs", "progress"]) {
    const note = buildOpinionPlanningNote({ status, aiOpinion: "<p>Use the existing hook.</p>" });
    assert.ok(note, `no note for a ${status} card with an opinion`);
    assert.ok(note.includes(AI_OPINION_PLANNING_RULE));
  }
});

test("an empty opinion leaves get_card unchanged", () => {
  for (const aiOpinion of ["", "<p></p>", "<p> &nbsp; </p>", null, undefined]) {
    assert.equal(buildOpinionPlanningNote({ status: "backlog", aiOpinion }), null);
  }
});

test("columns where no plan is written get no note", () => {
  for (const status of ["ideation", "test", "completed", "withdrawn"]) {
    assert.equal(buildOpinionPlanningNote({ status, aiOpinion: "<p>Looks good.</p>" }), null);
  }
});

test("the get_card handler sends the note as its own block after the JSON", () => {
  const noteAt = getCardHandler.indexOf("buildOpinionPlanningNote(card)");
  assert.ok(noteAt !== -1, "get_card no longer builds the planning note");
  assert.ok(
    getCardHandler.indexOf("JSON.stringify(cleanedCard") < noteAt &&
      noteAt < getCardHandler.indexOf('type: "image"'),
    "The note has to follow the JSON block and precede the images, so content[0] stays plain JSON."
  );
});

test("save_plan's description carries the planning rule", () => {
  const region = indexSource.slice(
    indexSource.indexOf('name: "save_plan"'),
    indexSource.indexOf('name: "save_tests"')
  );
  assert.match(region, /\$\{AI_OPINION_PLANNING_RULE\}/);
});

// IDE-404: a terminal session evaluating an idea has none of Evaluate's or
// Ideate's prompts, so get_card carries the same rule and template — but only
// while the idea is still waiting for its opinion.

test("an ideation card without an opinion gets the evaluation rule and the template", () => {
  for (const aiOpinion of [null, "", "<p></p>"]) {
    const note = buildEvaluationNote({ status: "ideation", aiOpinion });
    assert.ok(note, "no evaluation note for an unevaluated idea");
    assert.ok(note.startsWith("If you are evaluating this idea:\n"));
    assert.ok(note.includes(PRIOR_DECISIONS_EVALUATION_RULE), "the rule differs from Evaluate's");
    assert.ok(note.includes(EVALUATION_OUTPUT_SCHEMA), "the template differs from Evaluate's");
    assert.match(note, /save_opinion/);
  }
});

test("the evaluation note stops once the opinion is written or the card left Ideation", () => {
  assert.equal(buildEvaluationNote({ status: "ideation", aiOpinion: "<p>Yes.</p>" }), null);
  for (const status of ["bugs", "progress", "test", "completed", "withdrawn"]) {
    assert.equal(buildEvaluationNote({ status, aiOpinion: null }), null, status);
  }
});

// IDE-405: a backlog card opened without an opinion is asked for one before
// its plan, so a session that binds to it later needs the same rule.
test("a backlog card with neither an opinion nor a plan gets the evaluation note", () => {
  for (const solutionSummary of [null, "", "<p></p>"]) {
    const note = buildEvaluationNote({ status: "backlog", aiOpinion: null, solutionSummary });
    assert.ok(note, "no evaluation note for an unevaluated backlog card");
    assert.ok(note.includes(EVALUATION_OUTPUT_SCHEMA));
  }
});

test("a backlog card with a plan or an opinion reads as before", () => {
  assert.equal(
    buildEvaluationNote({ status: "backlog", aiOpinion: null, solutionSummary: "<p>Step 1.</p>" }),
    null,
  );
  assert.equal(
    buildEvaluationNote({ status: "backlog", aiOpinion: "<p>Yes.</p>", solutionSummary: null }),
    null,
  );
  // An ideation card is evaluated whatever its description says about a plan.
  assert.ok(buildEvaluationNote({ status: "ideation", aiOpinion: null, solutionSummary: "<p>Plan.</p>" }));
});

test("the evaluation note's columns are open for a caller that needs another one", () => {
  assert.ok(buildEvaluationNote({ status: "progress", aiOpinion: null }, ["backlog", "progress", "test"]));
  assert.equal(buildEvaluationNote({ status: "ideation", aiOpinion: null }, ["backlog"]), null);
});

test("the get_card handler sends the evaluation note as its own block before the images", () => {
  const noteAt = getCardHandler.indexOf("buildEvaluationNote(card)");
  assert.ok(noteAt !== -1, "get_card no longer builds the evaluation note");
  assert.ok(
    getCardHandler.indexOf("JSON.stringify(cleanedCard") < noteAt &&
      noteAt < getCardHandler.indexOf('type: "image"'),
  );
});

test("save_opinion's aiOpinion description is the template Evaluate uses", () => {
  const region = indexSource.slice(
    indexSource.indexOf('name: "save_opinion"'),
    indexSource.indexOf('name: "save_output"')
  );
  assert.match(region, /\$\{EVALUATION_OUTPUT_SCHEMA\}/);
  assert.match(region, /get_card returns the full evaluation rule/);
  // The full rule stays out of the tool list: it would ride on every session.
  assert.doesNotMatch(region, /PRIOR_DECISIONS_EVALUATION_RULE/);
});

test("save_opinion and save_plan keep linked artifacts the way Apply does", () => {
  for (const [tool, next] of [["save_plan", "save_tests"], ["save_opinion", "save_output"]]) {
    const handler = indexSource.slice(indexSource.indexOf(`case "${tool}"`), indexSource.indexOf(`case "${next}"`));
    assert.match(handler, /cardFieldHtml\(id, /, `${tool} skips the artifact pass`);
  }
  const helper = indexSource.slice(indexSource.indexOf("function cardFieldHtml"));
  assert.match(helper, /materializeArtifactFences\(markdown, cardArtifactDir\(id\)\)/);
  assert.match(helper, /persistCardArtifacts\(linked, id\)/);
});
