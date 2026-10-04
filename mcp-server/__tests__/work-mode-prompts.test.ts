import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import * as phasePolicyNs from "../../lib/prompts/phase-policy";
import * as voiceStyleNs from "../../lib/prompts/voice-style";
import * as priorDecisionsNs from "../../lib/prompts/prior-decisions";
import * as narrativeNs from "../../lib/prompts/narrative";

// See run-output.test.ts: lib/ modules come back through the CJS interop.
function interop<T extends object>(ns: T): T {
  return (ns as { default?: T }).default ?? ns;
}

const { buildPhasePolicyBody } = interop(phasePolicyNs);
const { buildVoicePrompt } = interop(voiceStyleNs);
const { CHAIN_IMPLEMENTATION_RULE } = interop(priorDecisionsNs);

// IDE-335 made the phase policy and the voice prompt mode-aware. Development
// is the flow every existing board runs on, so its text must not move by a
// byte. The fixtures were captured from the code as it stood before the mode
// existed; a Development change that is meant to happen has to update them on
// purpose, in the same commit.
function fixture(name: string): Record<string, string | null> {
  return JSON.parse(
    readFileSync(new URL(`./fixtures/prompt-snapshots/${name}`, import.meta.url), "utf8"),
  );
}

const CARD_ID = "11111111-2222-3333-4444-555555555555";
const BRANCH = { enforced: true, targetBranch: "kanban/IDE-1-snapshot" };

function policyFor(key: string, mode?: "development" | "work") {
  const [status, variant] = key.split("|");
  const card = {
    id: CARD_ID,
    title: "Snapshot card",
    status,
    displayId: variant === "noid" ? null : "IDE-1",
  };
  const branch = variant === "branch" ? BRANCH : undefined;
  return mode ? buildPhasePolicyBody(card, branch, mode) : buildPhasePolicyBody(card, branch);
}

test("Development phase policy is unchanged, with or without the mode argument", () => {
  const snapshot = fixture("phase-policy-development.json");
  for (const [key, expected] of Object.entries(snapshot)) {
    assert.equal(policyFor(key), expected, `${key}: default call drifted`);
    assert.equal(policyFor(key, "development"), expected, `${key}: "development" drifted`);
  }
});

type Voice = "entrepreneur" | "builder" | "engineer";
type Section = "tests" | "plan" | "opinion" | "chat" | "quick_fix" | "description";

test("Development voice prompts are unchanged for all three voices", () => {
  const snapshot = fixture("voice-development.json");
  for (const [key, expected] of Object.entries(snapshot)) {
    const [voice, section, lang] = key.split("|") as [Voice, Section, string];
    const language = lang === "auto" ? undefined : (lang as "tr" | "en");
    const opts = language ? { language } : {};
    assert.equal(buildVoicePrompt(voice, section, opts), expected, `${key}: default drifted`);
    assert.equal(
      buildVoicePrompt(voice, section, { ...opts, mode: "development" }),
      expected,
      `${key}: "development" drifted`,
    );
  }
});

test("a Work card in Backlog does the work in the project folder instead of planning", () => {
  const body = buildPhasePolicyBody(
    { id: CARD_ID, title: "Kick-off tutanağı", status: "backlog", displayId: "SOL-4" },
    BRANCH,
    "work",
  )!;
  assert.match(body, /project folder/);
  assert.match(body, /save_output/);
  assert.match(body, /review checklist/);
  assert.match(body, /In Review/);
  assert.doesNotMatch(body, /save_plan/, "Work skips the plan-then-implement split");
  assert.doesNotMatch(body, /branch/i, "no branch clause on a Work card");
  assert.doesNotMatch(body, /Card: SOL-4/, "no commit trailer on a Work card");
});

test("a Work card in review ticks the checklist and closes into Done", () => {
  const body = buildPhasePolicyBody(
    { id: CARD_ID, title: "Kick-off tutanağı", status: "test", displayId: "SOL-4" },
    undefined,
    "work",
  )!;
  assert.match(body, /This card is in review/);
  assert.match(body, /move the card to Done/);
  assert.doesNotMatch(body, /manual testing/);
});

test("Work collapses the three voices into one tone and keeps the core heading", () => {
  const sections: Section[] = ["tests", "plan", "opinion", "chat", "quick_fix", "description"];
  for (const section of sections) {
    const outputs = (["entrepreneur", "builder", "engineer"] as Voice[]).map((voice) =>
      buildVoicePrompt(voice, section, { mode: "work", language: "tr" }),
    );
    assert.equal(new Set(outputs).size, 1, `${section}: voices still differ in Work`);
    assert.match(outputs[0], /## Voice: Work/);
    assert.doesNotMatch(outputs[0], /## Voice: (Entrepreneur|Builder|Engineer)/);
  }

  // The review checklist is read by the same core-flow badge and pre-verify as
  // a test checklist, so the style contract still leads the tests section.
  assert.match(buildVoicePrompt("builder", "tests", { mode: "work", language: "tr" }), /## Temel akış/);
  assert.match(buildVoicePrompt("builder", "tests", { mode: "work", language: "en" }), /## Core flow/);
});

// lib/prompts.ts re-exports modules that import through the `@/` alias, which
// this package cannot resolve, so the phase prompt is read as source: each
// case's body is the text between its label and the next one.
function phaseCase(phase: string): string {
  const source = readFileSync(new URL("../../lib/prompts.ts", import.meta.url), "utf8");
  const start = source.indexOf(`case "${phase}":`);
  assert.ok(start >= 0, `no ${phase} case`);
  const next = source.indexOf("case \"", start + 1);
  return source.slice(start, next < 0 ? undefined : next);
}

test("the chain implementation rule rides on the runs that write code, not the plan", () => {
  // Implementation builds on what the chain's earlier cards brought in, and
  // retest rewrites the checklist, so its regression step has to survive too.
  assert.match(phaseCase("implementation"), /\$\{CHAIN_IMPLEMENTATION_RULE\}/);
  assert.match(phaseCase("retest"), /\$\{CHAIN_IMPLEMENTATION_RULE\}/);
  assert.doesNotMatch(phaseCase("planning"), /CHAIN_IMPLEMENTATION_RULE/);
  assert.doesNotMatch(phaseCase("verify"), /CHAIN_IMPLEMENTATION_RULE/);

  assert.match(CHAIN_IMPLEMENTATION_RULE, /at most 3, nearest first/);
  assert.match(CHAIN_IMPLEMENTATION_RULE, /completed or test/);
  assert.match(CHAIN_IMPLEMENTATION_RULE, /the code wins/);
  assert.match(CHAIN_IMPLEMENTATION_RULE, /## Regresyon/);
  assert.match(CHAIN_IMPLEMENTATION_RULE, /Never put it in the core group/);
  assert.match(CHAIN_IMPLEMENTATION_RULE, /With no `chain` field, ignore this part/);
});

// IDE-358: a Work project's wizard writes a project brief, not a product
// narrative. The brief keeps the six sections the wizard asks about and drops
// the product-only ones.
const { buildWorkBriefPrompt, generateWorkBriefFallback } = interop(narrativeNs);

const EMPTY_BRIEF = {
  context: "",
  stakeholders: "",
  outputs: "",
  outOfScope: "",
  references: "",
  doneAndRhythm: "",
};

test("the Work brief prompt asks for brief sections, not product ones", () => {
  const prompt = buildWorkBriefPrompt("Northwind rollout", {
    ...EMPTY_BRIEF,
    context: "GRC rollout for a holding group",
  });
  assert.match(prompt, /GRC rollout for a holding group/);
  for (const section of ["Context", "Stakeholders", "Outputs", "Out of scope", "References", "Working rhythm"]) {
    assert.match(prompt, new RegExp(section), `missing ${section}`);
  }
  assert.doesNotMatch(prompt, /Competitive Positioning/);
  assert.doesNotMatch(prompt, /Vision Statement/);
  assert.doesNotMatch(prompt, /Product Architect/);
});

test("the Work brief fallback marks empty answers as not provided", () => {
  const content = generateWorkBriefFallback("Northwind rollout", EMPTY_BRIEF);
  assert.match(content, /^# Project Brief: Northwind rollout/);
  assert.equal(content.match(/_Not provided_/g)?.length, 6);
});
