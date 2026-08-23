import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

// Drift guard between what the phase-aware hook PROMISES the model and what the
// MCP handlers actually DO.
//
// The bug this exists for: PHASE_INSTRUCTIONS.ideation told every model, on
// every turn, that "save_opinion moves the card to Backlog". The handler's
// UPDATE never touched `status` and never had. The model believed the policy,
// reported a move that never happened, and the user found the card still
// sitting in Ideation. Nothing in the codebase connected the sentence to the
// SQL, so nothing could notice.
//
// These tests read both sources as text and cross-check them. Importing
// index.ts is not an option — it would start a stdio server — and the policy
// assertions are about the written text (clause order, the exact promises a
// sentence makes), which a runtime import would not show. The existing suite
// already asserts against index.ts source for the same reason (see
// worktree-write.test.ts).

const indexSrc = readFileSync(new URL("../index.ts", import.meta.url), "utf8");
const policySrc = readFileSync(
  new URL("../../lib/prompts/phase-policy.ts", import.meta.url),
  "utf8"
);
const gitHelpersSrc = readFileSync(
  new URL("../git-helpers.ts", import.meta.url),
  "utf8"
);
const hookPolicySrc = readFileSync(
  new URL("../../lib/hook-policy.ts", import.meta.url),
  "utf8"
);

// Column labels as PHASE_INSTRUCTIONS writes them → the stored status value.
const COLUMN_LABEL_TO_STATUS: Record<string, string> = {
  backlog: "backlog",
  "in progress": "progress",
  "human test": "test",
  withdrawn: "withdrawn",
  ideation: "ideation",
  bugs: "bugs",
  completed: "completed",
};

/** The body of one `case "<tool>": { ... }` block in index.ts. */
function handlerBody(tool: string): string {
  const start = indexSrc.indexOf(`case "${tool}": {`);
  assert.ok(start !== -1, `Could not find handler for ${tool} in index.ts`);
  const next = indexSrc.indexOf(`case "`, start + 1);
  return indexSrc.slice(start, next === -1 ? undefined : next);
}

/** The literal status a handler writes, or null when it writes none. */
function statusWrittenBy(tool: string): string | null {
  const body = handlerBody(tool);
  // Only the hardcoded form (`status = 'progress'`) counts as a claimable
  // move. A bound `status = ?` is caller-driven, which is move_card's job.
  const match = body.match(/status\s*=\s*'([a-z]+)'/);
  return match ? match[1] : null;
}

/** PHASE_INSTRUCTIONS entries as (column, instruction) pairs. */
function phaseInstructions(): Array<[string, string]> {
  const block = policySrc.slice(
    policySrc.indexOf("const PHASE_INSTRUCTIONS"),
    policySrc.indexOf("export function isTerminalPhase")
  );
  assert.ok(block.length > 0, "Could not locate PHASE_INSTRUCTIONS");

  const entries: Array<[string, string]> = [];
  const re = /(\w+):\s*\n?\s*"((?:[^"\\]|\\.)*)"/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(block)) !== null) entries.push([m[1], m[2]]);

  assert.ok(entries.length >= 4, "Expected at least 4 phase instructions");
  return entries;
}

// ---------------------------------------------------------------------------
// Every move the policy promises must be a move a handler actually performs
// ---------------------------------------------------------------------------

test("PHASE_INSTRUCTIONS: every promised column move is backed by the handler's SQL", () => {
  for (const [column, instruction] of phaseInstructions()) {
    const tool = instruction.match(/\b(save_opinion|save_plan|save_tests)\b/)?.[1];
    assert.ok(tool, `No save_* tool named in the "${column}" instruction`);

    // "moves the card to Backlog", "This moves the card to In Progress",
    // "Moves to Human Test" — every way the text has claimed a move so far.
    const claimed = instruction.match(
      /moves?(?: the card)? to ([A-Za-z ]+?)(?:\.|,|$)/i
    )?.[1];

    const actual = statusWrittenBy(tool);

    if (!claimed) {
      // The text promises nothing. The handler may still move the card —
      // save_plan/save_tests legitimately do — this test only guards against
      // promises with no implementation behind them.
      continue;
    }

    const expected = COLUMN_LABEL_TO_STATUS[claimed.trim().toLowerCase()];
    assert.ok(
      expected,
      `"${column}" instruction names an unknown column "${claimed}"`
    );
    assert.strictEqual(
      actual,
      expected,
      `PHASE_INSTRUCTIONS.${column} says ${tool} moves the card to "${claimed}" ` +
        `(status "${expected}"), but the handler writes ` +
        `${actual === null ? "no status at all" : `"${actual}"`}. ` +
        `Either make the handler do it or stop promising it.`
    );
  }
});

// ---------------------------------------------------------------------------
// The specific regression
// ---------------------------------------------------------------------------

test("save_opinion does not write a status — it is not a move tool", () => {
  assert.strictEqual(
    statusWrittenBy("save_opinion"),
    null,
    "save_opinion must not change the card's column. Moving after an opinion " +
      "is the user's call, made through move_card."
  );
});

test("ideation policy does not claim save_opinion moves the card", () => {
  const ideation = phaseInstructions().find(([c]) => c === "ideation")?.[1];
  assert.ok(ideation, "No ideation instruction found");
  assert.doesNotMatch(
    ideation,
    /save_opinion moves/i,
    "The ideation policy is telling the model save_opinion moves the card. It does not."
  );
  assert.match(
    ideation,
    /move_card/,
    "The ideation policy must point at move_card as the way to move the card."
  );
});

test("save_opinion tool description states it does not move the card", () => {
  const region = indexSrc.slice(
    indexSrc.indexOf('name: "save_opinion"'),
    indexSrc.indexOf('name: "get_project_by_folder"')
  );
  assert.ok(region.length > 0, "Could not locate save_opinion tool definition");
  assert.match(
    region,
    /does NOT move the card/,
    "The policy text and the tool description are the model's two sources for " +
      "this. Both have to say it, or the model infers a move from the other one."
  );
});

// ---------------------------------------------------------------------------
// The moves that ARE real stay real
// ---------------------------------------------------------------------------

test("save_plan moves the card to progress", () => {
  assert.strictEqual(statusWrittenBy("save_plan"), "progress");
});

test("save_tests moves the card to test", () => {
  assert.strictEqual(statusWrittenBy("save_tests"), "test");
});

// ---------------------------------------------------------------------------
// Result messages must be built from the stored row, not from intent
// ---------------------------------------------------------------------------
// `updated_at` is unconditional in every SET list, so `result.changes` is 1 for
// any existing card even when nothing the caller asked for was written. A
// handler that reports success off a hardcoded template is asserting a side
// effect it never checked.

for (const tool of ["save_plan", "save_tests", "save_opinion", "update_card", "move_card"]) {
  test(`${tool} builds its result from readStatus(), not a hardcoded column name`, () => {
    assert.match(
      handlerBody(tool),
      /readStatus\(/,
      `${tool} reports what it did without reading the row back.`
    );
  });
}

test("update_card rejects fields it cannot write instead of dropping them", () => {
  const body = handlerBody("update_card");
  assert.match(
    body,
    /unknownKeys/,
    "update_card silently ignores keys outside fieldMap while reporting success."
  );
});

test("move_card validates the status against the column list at runtime", () => {
  // The MCP SDK's low-level Server does not enforce inputSchema, so the enum
  // in the schema is documentation. An unlisted value would be written through
  // and the card would vanish from every column.
  assert.match(
    handlerBody("move_card"),
    /STATUSES\.includes\(/,
    "move_card writes the caller's status without checking it is a real column."
  );
});

// ---------------------------------------------------------------------------
// The generated copies must match their sources
// ---------------------------------------------------------------------------
// scripts/sync-mcp-shared.mjs runs from mcp-server's prebuild, so a normal
// build can never ship a stale copy. But `npm run dev` / tsx read the
// committed copy directly, and nothing stopped someone editing the generated
// file instead of the source — the DO NOT EDIT header is a request, not a
// guard. These make it a guard.

const COPIES = [
  { source: "lib/prompts/test-style.ts", target: "test-style.generated.ts" },
  { source: "lib/prompts/phase-policy.ts", target: "phase-policy.generated.ts" },
];

for (const { source, target } of COPIES) {
  test(`${target} is a verbatim copy of ${source}`, () => {
    const sourceText = readFileSync(
      new URL(`../../${source}`, import.meta.url),
      "utf8"
    );
    const generated = readFileSync(new URL(`../${target}`, import.meta.url), "utf8");
    const marker = "// ─────────────────────────────────────────────────────────────────────────\n\n";
    const bodyAt = generated.indexOf(marker);

    assert.ok(bodyAt !== -1, `${target} lost its GENERATED FILE header`);
    assert.strictEqual(
      generated.slice(bodyAt + marker.length),
      sourceText,
      `${target} has drifted from ${source}. Run scripts/sync-mcp-shared.mjs — ` +
        `and if the difference is a deliberate change, make it in the source.`
    );
  });
}

test("the copied policy module has no imports", () => {
  // mcp-server's tsconfig pins rootDir: "." and its dist/ is copied into the
  // plugin repo without lib/. One import in the source and the generated copy
  // stops compiling — at build time, in a different repo, long after the edit.
  assert.doesNotMatch(
    policySrc,
    /^\s*import\s/m,
    "lib/prompts/phase-policy.ts gained an import. It has to compile standalone " +
      "inside mcp-server — move whatever needs the dependency to lib/hook-policy.ts."
  );
});

// ---------------------------------------------------------------------------
// The policy has to reach the model on the turn the card is bound
// ---------------------------------------------------------------------------
// The bug: create_card + bind_session_to_card both run inside one turn, but the
// hook had already spoken for that turn, so no phase policy was in context
// while the model went on to do the work. An ideation card got a plan written
// straight onto it because nothing said an opinion comes first.

test("bind_session_to_card returns the phase policy, not a promise about next turn", () => {
  const body = handlerBody("bind_session_to_card");

  assert.match(
    body,
    /buildPhasePolicyBody\(/,
    "bind_session_to_card no longer returns the phase policy. Binding is the " +
      "only moment the model is guaranteed to be listening before it starts work."
  );
  assert.doesNotMatch(
    body,
    /from the next user turn/i,
    "bind_session_to_card is telling the model the policy starts next turn. " +
      "It ships the policy now — that sentence is what the bug was made of."
  );
});

test("bind_session_to_card's tool description does not defer to the next turn", () => {
  // bind_session_to_card is the last entry in the tools array, so the slice
  // ends at the array's close rather than the next `name:`.
  const start = indexSrc.indexOf('name: "bind_session_to_card"');
  const region = indexSrc.slice(start, indexSrc.indexOf("// Handle tool calls", start));
  assert.ok(region.length > 0, "Could not locate bind_session_to_card tool definition");
  assert.doesNotMatch(
    region,
    /from the next user turn/i,
    "The tool description still says the policy applies from the next user turn."
  );
});

test("create_card names the expected next action for the column it lands in", () => {
  assert.match(
    handlerBody("create_card"),
    /buildPhaseHint\(/,
    "create_card returns a bare card id. The column already implies what " +
      "happens next; saying so is the cheapest place to say it."
  );
});

test("save_plan's description states it is not the exit from Ideation", () => {
  const region = indexSrc.slice(
    indexSrc.indexOf('name: "save_plan"'),
    indexSrc.indexOf('name: "save_tests"')
  );
  assert.ok(region.length > 0, "Could not locate save_plan tool definition");
  assert.match(
    region,
    /ideation/i,
    "save_plan's description says nothing about ideation. The handler happily " +
      "writes status='progress' onto an ideation card, so the description is " +
      "the model's only warning that doing so skips the evaluation."
  );
});

// ---------------------------------------------------------------------------
// The two worktree resolvers must agree
// ---------------------------------------------------------------------------
// lib/hook-policy.ts owns one (it can import lib/git); mcp-server/git-helpers.ts
// mirrors it so the policy returned on bind carries the same branch clause the
// hook would inject on the next turn. Two copies that disagree would hand the
// model two different target branches for the same card.

test("resolveEffectiveWorktree is identical on both sides", () => {
  const bodyOf = (src: string, label: string) => {
    const start = src.indexOf("export function resolveEffectiveWorktree(");
    assert.ok(start !== -1, `resolveEffectiveWorktree missing from ${label}`);
    const end = src.indexOf("\n}", start);
    assert.ok(end !== -1, `Could not find the end of resolveEffectiveWorktree in ${label}`);
    return src.slice(start, end).replace(/\s+/g, " ").trim();
  };

  assert.strictEqual(
    bodyOf(gitHelpersSrc, "mcp-server/git-helpers.ts"),
    bodyOf(hookPolicySrc, "lib/hook-policy.ts"),
    "The two resolveEffectiveWorktree copies have drifted. They answer " +
      "'what branch should this card be on' for the same card through " +
      "different code paths; a difference is a bug the user sees as a " +
      "branch that keeps changing."
  );
});
