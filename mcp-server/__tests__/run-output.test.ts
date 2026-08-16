import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import * as collectNs from "../../lib/platform/claude-provider/collect-run-output";
import * as selectNs from "../../lib/autonomous-run/select-run-output";

/**
 * `lib/` lives under the Next.js root package, which is CommonJS, while this
 * package is `"type": "module"`. tsx therefore hands those modules back through
 * the CJS interop, which parks the named exports on `default`. Unwrap either
 * shape so the tests keep working whichever way the loader resolves them.
 */
function interop<T extends object>(ns: T): T {
  return (ns as { default?: T }).default ?? ns;
}

const { createClaudeRunOutputCollector } = interop(collectNs);
const { selectRunOutput, RUN_OUTPUT_CONTRACTS } = interop(selectNs);

// IDE-280: a headless run's output used to be whatever the CLI put in its
// `result` field, which is only ever the LAST assistant message. A backgrounded
// bash command finishing mid-run re-invokes the model, and the follow-up remark
// then overwrote the run's real output — a 16k plan replaced by a 1k footnote,
// with no error and no warning.
//
// These live under mcp-server/ because that is the only package in the repo
// with a test runner. Both modules under test are deliberately free of `@/`
// aliases and of any import that opens the database, so unlike the older
// source-text drift guards here they can be imported for real.

const fixture = (name: string) =>
  readFileSync(new URL(`./fixtures/run-output/${name}`, import.meta.url), "utf8");

function collect(ndjson: string, chunkSize = Infinity) {
  const collector = createClaudeRunOutputCollector();
  if (chunkSize === Infinity) {
    collector.push(ndjson);
  } else {
    for (let i = 0; i < ndjson.length; i += chunkSize) {
      collector.push(ndjson.slice(i, i + chunkSize));
    }
  }
  return collector.finish();
}

// ---------------------------------------------------------------------------
// Collector
// ---------------------------------------------------------------------------

test("single uninterrupted run yields exactly one candidate", () => {
  const parsed = collect(fixture("single-text.ndjson"));

  assert.equal(parsed.candidates.length, 1);
  assert.match(parsed.candidates[0].text, /## Test Scenarios/);
  assert.equal(parsed.injectedUserMessages, 0);
  assert.equal(parsed.sawResultEnvelope, true);
});

test("reads total_cost_usd, not the cost_usd that never existed", () => {
  const parsed = collect(fixture("single-text.ndjson"));
  assert.equal(parsed.cost, 0.4211);
  assert.equal(parsed.duration, 2802);
});

test("a tool call splits one message into two candidates", () => {
  // Recorded from the real CLI: it emits one assistant envelope PER CONTENT
  // BLOCK, so "text, then tool_use" arrives as two events sharing a message id.
  // Splitting per envelope, or per message, both give the wrong unit.
  const parsed = collect(fixture("split-blocks.ndjson"));

  assert.equal(parsed.candidates.length, 2);
  assert.match(parsed.candidates[0].text, /ALPHA/);
  assert.equal(parsed.candidates[0].followedByToolUse, true);
  assert.match(parsed.candidates[1].text, /OMEGA/);
  assert.doesNotMatch(parsed.candidates[1].text, /ALPHA/);

  // A tool result is not an injected re-invocation.
  assert.equal(parsed.injectedUserMessages, 0);
});

test("an injected user message opens a new segment", () => {
  const parsed = collect(fixture("task-notification.ndjson"));

  assert.equal(parsed.injectedUserMessages, 1);
  const last = parsed.candidates[parsed.candidates.length - 1];
  assert.equal(last.segment, 1, "the footnote belongs to the re-invocation");
  assert.ok(
    parsed.candidates.some((c) => c.segment === 0 && /\[COMPLEXITY:/.test(c.text)),
    "the plan belongs to the original invocation",
  );
});

test("subagent prose and unknown events are ignored", () => {
  const parsed = collect(fixture("noise.ndjson"));

  assert.equal(parsed.candidates.length, 1);
  assert.doesNotMatch(parsed.candidates[0].text, /Subagent chatter/);
  assert.match(parsed.candidates[0].text, /Summary Verdict/);
});

test("a final line with no trailing newline is not lost", () => {
  // noise.ndjson deliberately ends without one, which is how the CLI ends.
  const raw = fixture("noise.ndjson");
  assert.ok(!raw.endsWith("\n"), "fixture must not end with a newline");

  const parsed = collect(raw);
  assert.equal(parsed.sawResultEnvelope, true);
  assert.match(parsed.result, /Final Score/);
});

test("chunk boundaries do not change the result", () => {
  // Incremental NDJSON parsers break on split lines, not on well-formed input.
  const raw = fixture("task-notification.ndjson");
  const whole = collect(raw);

  for (const size of [1, 7, 64, 999]) {
    assert.deepEqual(
      collect(raw, size),
      whole,
      `chunking at ${size} bytes changed the parse`,
    );
  }
});

test("falls back to a single JSON envelope from an older CLI", () => {
  const legacy = JSON.stringify({
    type: "result",
    result: "plain old envelope",
    total_cost_usd: 1.5,
    duration_ms: 42,
    is_error: false,
  });

  // No newline at all — one object, exactly what --output-format json emits.
  const collector = createClaudeRunOutputCollector();
  collector.push(legacy);
  const parsed = collector.finish();

  assert.equal(parsed.result, "plain old envelope");
  assert.equal(parsed.cost, 1.5);
  assert.equal(parsed.sawResultEnvelope, true);
});

test("a run that dies mid-stream reports no result envelope", () => {
  // This is the predicate the exit-code guard keys on. The old guard asked
  // whether stdout was empty, which worked only because --output-format json
  // wrote nothing until the very end. Under stream-json a system/init line
  // lands within milliseconds, so a crashed run has plenty of stdout and would
  // have sailed straight past it.
  const partial =
    JSON.stringify({ type: "system", subtype: "init", session_id: "x" }) +
    "\n" +
    JSON.stringify({
      type: "assistant",
      parent_tool_use_id: null,
      message: { id: "m1", content: [{ type: "text", text: "starting work" }] },
    }) +
    "\n";

  const parsed = collect(partial);

  assert.equal(parsed.sawResultEnvelope, false, "no result line arrived");
  assert.ok(partial.trim().length > 0, "yet stdout is far from empty");
});

test("non-JSON output is handed back rather than swallowed", () => {
  const parsed = collect("command not found: claude\n");
  assert.equal(parsed.candidates.length, 0);
  assert.match(parsed.result, /command not found/);
});

// ---------------------------------------------------------------------------
// Selector
// ---------------------------------------------------------------------------

test("DIC-15: the plan wins over the footnote the CLI reported", () => {
  const parsed = collect(fixture("task-notification.ndjson"));
  const selected = selectRunOutput(parsed, RUN_OUTPUT_CONTRACTS.planning);

  assert.match(selected.text, /\[COMPLEXITY: high\]/);
  assert.doesNotMatch(selected.text, /background query finished/i);
  assert.equal(
    selected.warning,
    null,
    "the contract matched exactly, so there is nothing to warn about",
  );

  // The regression this whole card exists for.
  assert.notEqual(selected.text, parsed.result);
});

test("no candidate satisfies the contract → longest plus a warning", () => {
  const parsed = collect(fixture("no-contract-multi.ndjson"));
  const selected = selectRunOutput(parsed, RUN_OUTPUT_CONTRACTS.planning);

  assert.match(selected.text, /The narrative body/);
  assert.ok(selected.warning, "the fallback must not be silent");
  assert.match(selected.warning!, /plan/);
});

test("without a contract, deviating from the last word is flagged", () => {
  const parsed = collect(fixture("no-contract-multi.ndjson"));
  const selected = selectRunOutput(parsed);

  assert.match(selected.text, /The narrative body/);
  assert.ok(selected.warning, "picking something other than the last word is worth saying");
});

test("a single candidate is returned verbatim and silently", () => {
  const parsed = collect(fixture("single-text.ndjson"));
  const selected = selectRunOutput(parsed, RUN_OUTPUT_CONTRACTS.implementation);

  assert.equal(selected.text, parsed.candidates[0].text);
  assert.equal(selected.warning, null);
});

test("no candidates falls back to result without a warning", () => {
  // A run cut short mid-tool-call, or any provider with no collector. This is
  // what every caller did before selection existed; it is not a degradation.
  const selected = selectRunOutput({
    candidates: [],
    result: "whatever the CLI said",
    isError: false,
    sawResultEnvelope: true,
    injectedUserMessages: 0,
  });

  assert.equal(selected.text, "whatever the CLI said");
  assert.equal(selected.warning, null);
});

test("evaluate and quick-fix contracts match their own fixtures", () => {
  const noise = collect(fixture("noise.ndjson"));
  assert.equal(selectRunOutput(noise, RUN_OUTPUT_CONTRACTS.evaluate).warning, null);

  // quickFix requires BOTH headings: a run with the summary but no tests must
  // NOT pass, because the route silently substitutes placeholder scenarios.
  const summaryOnly = {
    candidates: [
      { text: "## Quick Fix Summary\nDid the thing.", segment: 0, followedByToolUse: false },
      { text: "Done.", segment: 0, followedByToolUse: false },
    ],
    result: "Done.",
    isError: false,
    sawResultEnvelope: true,
    injectedUserMessages: 0,
  };
  assert.ok(
    selectRunOutput(summaryOnly, RUN_OUTPUT_CONTRACTS.quickFix).warning,
    "a quick fix with no test scenarios must not pass silently",
  );
});

test("contract patterns are not global", () => {
  // A /g regex carries lastIndex between candidates and would match every
  // other one, making selection depend on how many candidates preceded it.
  for (const [name, contract] of Object.entries(RUN_OUTPUT_CONTRACTS)) {
    for (const re of contract.requires) {
      assert.equal(re.global, false, `${name} has a global pattern: ${re}`);
    }
  }
});

// ---------------------------------------------------------------------------
// Drift guard: contracts vs. the prompts that are supposed to produce them
// ---------------------------------------------------------------------------

test("every contract is still demanded by its prompt", () => {
  // The failure mode of a contract system is a prompt edit that orphans one:
  // runs then silently take the length-heuristic path forever. Same idea as
  // phase-policy.test.ts — cross-check the two sources as text.
  const prompts = readFileSync(new URL("../../lib/prompts.ts", import.meta.url), "utf8");
  const cardPrompts = readFileSync(
    new URL("../../lib/prompts/card.ts", import.meta.url),
    "utf8",
  );
  const all = prompts + cardPrompts;

  // What each contract's patterns should find verbatim in the prompt text.
  const EXPECTED: Record<keyof typeof RUN_OUTPUT_CONTRACTS, string[]> = {
    planning: ["[COMPLEXITY:", "[PRIORITY:"],
    implementation: ["## Test Scenarios"],
    retest: ["## Test Scenarios"],
    verify: ["## Core flow", "## Temel akış"],
    evaluate: ["## Summary Verdict", "## Final Score"],
    quickFix: ["## Quick Fix Summary", "## Test Scenarios"],
  };

  for (const [name, needles] of Object.entries(EXPECTED)) {
    for (const needle of needles) {
      assert.ok(
        all.includes(needle),
        `contract "${name}" requires ${JSON.stringify(needle)} but no prompt asks for it`,
      );
    }
    // And the contract's own regexes must agree with those needles.
    const contract = RUN_OUTPUT_CONTRACTS[name as keyof typeof RUN_OUTPUT_CONTRACTS];
    const sample = needles.join("\n");
    for (const re of contract.requires) {
      assert.ok(re.test(sample), `${name}: ${re} does not match its own prompt markers`);
    }
  }
});

test("the retest phase has a contract and a prompt that asks for it", () => {
  // retest used to demand no output format at all while its output was written
  // straight into testScenarios — pure heuristic territory.
  const prompts = readFileSync(new URL("../../lib/prompts.ts", import.meta.url), "utf8");
  const retestBlock = prompts.slice(prompts.indexOf('case "retest"'));
  assert.match(
    retestBlock.slice(0, 1200),
    /## Test Scenarios/,
    "the retest prompt must still demand the format its contract checks for",
  );
});
