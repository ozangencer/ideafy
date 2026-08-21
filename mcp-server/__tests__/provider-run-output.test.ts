import test from "node:test";
import assert from "node:assert/strict";

import * as codexNs from "../../lib/platform/codex-provider";
import * as geminiNs from "../../lib/platform/gemini-provider";
import * as opencodeNs from "../../lib/platform/opencode-provider";
import * as selectNs from "../../lib/autonomous-run/select-run-output";
import * as namesNs from "../../lib/platform/mcp-tool-names";
import type { ParsedRunOutput, RunOutputCollector } from "../../lib/platform/types";

/** See run-output.test.ts — `lib/` comes back through the CJS interop. */
function interop<T extends object>(ns: T): T {
  return (ns as { default?: T }).default ?? ns;
}

const { codexProvider } = interop(codexNs);
const { geminiProvider } = interop(geminiNs);
const { opencodeProvider } = interop(opencodeNs);
const { selectRunOutput, RUN_OUTPUT_CONTRACTS } = interop(selectNs);
const { adaptMcpToolNames } = interop(namesNs);

/**
 * Non-Claude autonomous runs used to skip the collector entirely and hand
 * `parseJsonResponse` the whole stdout as the run's single output: Codex's
 * quiet mode returned its full transcript, OpenCode concatenated every text
 * delta. `selectRunOutput` then had exactly one candidate and no choice, so a
 * verify run could write its narration into a card's checklist. These tests
 * pin the split that stops it — the same failure IDE-280 fixed for Claude.
 */

const CHECKLIST = "## Temel akış\n- [x] Kart Human Test'te açılıyor";

function collect(collector: RunOutputCollector, ndjson: string): ParsedRunOutput {
  // Chunked on purpose: real stdout splits mid-line.
  const chunk = 7;
  for (let i = 0; i < ndjson.length; i += chunk) {
    collector.push(ndjson.slice(i, i + chunk));
  }
  return collector.finish();
}

// ---------------------------------------------------------------------------
// Codex
// ---------------------------------------------------------------------------

test("codex autonomous runs ask for the event stream, not quiet text", () => {
  const args = codexProvider.buildAutonomousArgs({ prompt: "p" });
  assert.ok(args.includes("--json"), `no --json in ${JSON.stringify(args)}`);
  assert.ok(!args.includes("-q"), "quiet mode returns the whole transcript as one blob");
});

test("codex collector splits prose at tool calls and keeps the last answer", () => {
  const ndjson = [
    JSON.stringify({ type: "thread.started", thread_id: "t1" }),
    JSON.stringify({ type: "turn.started" }),
    JSON.stringify({
      type: "item.completed",
      item: { type: "agent_message", text: "Kartı okuyorum, sonra testi koşacağım." },
    }),
    JSON.stringify({
      type: "item.started",
      item: { type: "command_execution", command: "npm test" },
    }),
    JSON.stringify({
      type: "item.completed",
      item: { type: "command_execution", status: "completed", aggregated_output: "ok" },
    }),
    JSON.stringify({ type: "item.completed", item: { type: "agent_message", text: CHECKLIST } }),
  ].join("\n");

  const parsed = collect(codexProvider.createRunOutputCollector(), ndjson);

  assert.equal(parsed.candidates.length, 2, "narration and answer must not merge");
  assert.ok(!parsed.candidates[0].text.includes("Temel akış"));

  const selected = selectRunOutput(parsed, RUN_OUTPUT_CONTRACTS.verify);
  assert.match(selected.text, /^## Temel akış/);
  assert.equal(selected.warning, null);
});

test("codex collector prefers the checklist over a later remark", () => {
  // The IDE-280 shape: the run finishes, a backgrounded command re-invokes the
  // model, and "Bu kadar." would be the CLI's own `result` field.
  const ndjson = [
    JSON.stringify({ type: "item.completed", item: { type: "agent_message", text: CHECKLIST } }),
    JSON.stringify({ type: "item.started", item: { type: "command_execution", command: "git status" } }),
    JSON.stringify({ type: "item.completed", item: { type: "agent_message", text: "Bu kadar." } }),
  ].join("\n");

  const selected = selectRunOutput(
    collect(codexProvider.createRunOutputCollector(), ndjson),
    RUN_OUTPUT_CONTRACTS.verify,
  );
  assert.match(selected.text, /^## Temel akış/);
});

test("codex collector separates consecutive agent messages", () => {
  // Each Codex `agent_message` is a whole utterance, so two in a row are two
  // paragraphs — not one word running into the next.
  const ndjson = [
    JSON.stringify({ type: "item.completed", item: { type: "agent_message", text: "Bir" } }),
    JSON.stringify({ type: "item.completed", item: { type: "agent_message", text: "İki" } }),
  ].join("\n");

  const parsed = collect(codexProvider.createRunOutputCollector(), ndjson);
  assert.equal(parsed.candidates.length, 1);
  assert.equal(parsed.candidates[0].text, "Bir\n\nİki");
});

test("codex collector falls back to plain text when the stream is unreadable", () => {
  // An older CLI still printing prose: the collector must not swallow the run.
  const parsed = collect(codexProvider.createRunOutputCollector(), `${CHECKLIST}\n`);
  assert.equal(parsed.candidates.length, 0);
  assert.match(parsed.result, /^## Temel akış/);
  assert.equal(parsed.sawResultEnvelope, true);
});

test("codex collector reports a failed turn as an error", () => {
  const ndjson = JSON.stringify({ type: "turn.failed", error: { message: "sandbox denied" } });
  const parsed = collect(codexProvider.createRunOutputCollector(), ndjson);
  assert.equal(parsed.isError, true);
  assert.match(parsed.result, /sandbox denied/);
});

// ---------------------------------------------------------------------------
// Gemini
// ---------------------------------------------------------------------------

test("gemini autonomous runs ask for stream-json", () => {
  const args = geminiProvider.buildAutonomousArgs({ prompt: "p" });
  assert.ok(args.includes("stream-json"), `no stream-json in ${JSON.stringify(args)}`);
});

test("gemini collector does not repeat accumulated snapshots across candidates", () => {
  // Gemini's assistant chunks carry the message SO FAR, and the accumulation
  // survives a tool call. Subtracting what earlier candidates already took is
  // what keeps the second candidate from re-stating the first.
  const first = "Kartı okudum, testi koşuyorum.";
  const ndjson = [
    JSON.stringify({ type: "init", session_id: "s1" }),
    JSON.stringify({ type: "message", role: "assistant", delta: true, content: "Kartı" }),
    JSON.stringify({ type: "message", role: "assistant", delta: true, content: first }),
    JSON.stringify({ type: "tool_use", tool_name: "run_shell_command", parameters: {} }),
    JSON.stringify({
      type: "message",
      role: "assistant",
      delta: true,
      content: `${first}${CHECKLIST}`,
    }),
    JSON.stringify({ type: "result", stats: {} }),
  ].join("\n");

  const parsed = collect(geminiProvider.createRunOutputCollector(), ndjson);

  assert.equal(parsed.candidates.length, 2);
  assert.equal(parsed.candidates[0].text, first);
  assert.equal(parsed.candidates[1].text, CHECKLIST, "the tail must not repeat the head");

  const selected = selectRunOutput(parsed, RUN_OUTPUT_CONTRACTS.verify);
  assert.match(selected.text, /^## Temel akış/);
});

test("gemini collector handles a snapshot that restarts after a tool call", () => {
  // The other plausible behaviour: the message resets per step. Then the
  // snapshot shares no prefix with what we already emitted and stands alone.
  const ndjson = [
    JSON.stringify({ type: "message", role: "assistant", delta: true, content: "Koşuyorum." }),
    JSON.stringify({ type: "tool_use", tool_name: "run_shell_command", parameters: {} }),
    JSON.stringify({ type: "message", role: "assistant", delta: true, content: CHECKLIST }),
  ].join("\n");

  const parsed = collect(geminiProvider.createRunOutputCollector(), ndjson);
  assert.deepEqual(
    parsed.candidates.map((c) => c.text),
    ["Koşuyorum.", CHECKLIST],
  );
});

// ---------------------------------------------------------------------------
// OpenCode
// ---------------------------------------------------------------------------

test("opencode collector splits text deltas at tool calls", () => {
  const ndjson = [
    JSON.stringify({ type: "message.part.delta", properties: { field: "text", delta: "Testi " } }),
    JSON.stringify({ type: "message.part.delta", properties: { field: "text", delta: "koşuyorum." } }),
    JSON.stringify({
      type: "message.part.updated",
      properties: { part: { type: "tool", tool: "bash", state: { status: "running", input: {} } } },
    }),
    JSON.stringify({ type: "message.part.delta", properties: { field: "text", delta: CHECKLIST } }),
  ].join("\n");

  const parsed = collect(opencodeProvider.createRunOutputCollector(), ndjson);

  assert.deepEqual(
    parsed.candidates.map((c) => c.text),
    ["Testi koşuyorum.", CHECKLIST],
  );
  assert.match(
    selectRunOutput(parsed, RUN_OUTPUT_CONTRACTS.verify).text,
    /^## Temel akış/,
  );
});

test("opencode collector still reports session errors", () => {
  // Parity with the buffered path it replaces: a failed run must reject rather
  // than write whatever partial text it produced.
  const ndjson = [
    JSON.stringify({ type: "message.part.delta", properties: { field: "text", delta: "yarım" } }),
    JSON.stringify({ type: "session.error", properties: {} }),
  ].join("\n");

  assert.equal(collect(opencodeProvider.createRunOutputCollector(), ndjson).isError, true);
});

// ---------------------------------------------------------------------------
// MCP tool naming
// ---------------------------------------------------------------------------

test("claude prompts keep their literal MCP tool names", () => {
  const prompt = "Read card via MCP (mcp__ideafy__get_card).";
  assert.equal(adaptMcpToolNames(prompt, "claude"), prompt);
});

test("other providers get bare tool names plus the server note", () => {
  const prompt = "Read card via MCP (mcp__ideafy__get_card). Do not call mcp__ideafy__save_tests.";

  for (const platform of ["codex", "gemini", "opencode"] as const) {
    const adapted = adaptMcpToolNames(prompt, platform);
    assert.ok(!adapted.includes("mcp__ideafy__"), `${platform} kept Claude's prefix`);
    assert.match(adapted, /\(get_card\)/);
    assert.match(adapted, /call save_tests/);
    assert.match(adapted, /`ideafy` MCP server/, `${platform} lost the server name`);
  }
});

test("a prompt with no MCP tools gains no note", () => {
  const prompt = "Task: pre-verify the core flow.";
  assert.equal(adaptMcpToolNames(prompt, "codex"), prompt);
});
