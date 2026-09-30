import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import * as phasePolicyNs from "../../lib/prompts/phase-policy";
import * as voiceStyleNs from "../../lib/prompts/voice-style";

// See run-output.test.ts: lib/ modules come back through the CJS interop.
function interop<T extends object>(ns: T): T {
  return (ns as { default?: T }).default ?? ns;
}

const { buildPhasePolicyBody } = interop(phasePolicyNs);
const { buildVoicePrompt } = interop(voiceStyleNs);

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
