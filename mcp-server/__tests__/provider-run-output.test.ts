import test from "node:test";
import assert from "node:assert/strict";

import * as claudeNs from "../../lib/platform/claude-provider";
import * as claudeCollectNs from "../../lib/platform/claude-provider/collect-run-output";
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

const { claudeProvider, AUTONOMOUS_DISALLOWED_TOOLS } = interop(claudeNs);
const { createClaudeRunOutputCollector, IDEAFY_MCP_FAILED_MESSAGE } = interop(claudeCollectNs);
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
// Claude — one-shot runs (IDE-319)
// ---------------------------------------------------------------------------

test("claude autonomous runs deny the tools that wait to be woken up", () => {
  const args = claudeProvider.buildAutonomousArgs({ prompt: "p" });
  const at = args.indexOf("--disallowedTools");
  assert.ok(at >= 0, `no --disallowedTools in ${JSON.stringify(args)}`);

  // One comma-joined value: the flag is variadic, so a bare list would run on
  // into whatever argument follows it.
  const denied = args[at + 1].split(",");
  for (const tool of ["Monitor", "ScheduleWakeup", "CronCreate", "RemoteTrigger", "AskUserQuestion"]) {
    assert.ok(denied.includes(tool), `${tool} is not denied`);
  }
  assert.deepEqual(denied, [...AUTONOMOUS_DISALLOWED_TOOLS]);
});

// IDE-361: one-shot runs pin their own model and effort; Evaluate also drops
// every user MCP server but Ideafy's own.

function flagValue(args: string[], flag: string): string | undefined {
  const at = args.indexOf(flag);
  return at >= 0 ? args[at + 1] : undefined;
}

test("claude evaluate pins opus, medium effort and an Ideafy-only MCP set", () => {
  const args = claudeProvider.buildAutonomousArgs({ prompt: "p", runKind: "evaluate" });
  assert.equal(flagValue(args, "--model"), "opus");
  assert.equal(flagValue(args, "--effort"), "medium");
  assert.ok(args.includes("--strict-mcp-config"), `no --strict-mcp-config in ${JSON.stringify(args)}`);
  const config = JSON.parse(flagValue(args, "--mcp-config") ?? "{}");
  assert.deepEqual(Object.keys(config.mcpServers), ["ideafy"]);
  assert.ok(config.mcpServers.ideafy.command, "ideafy server has no command");
});

test("claude quick-fix pins model and effort but keeps the user's MCP servers", () => {
  const args = claudeProvider.buildAutonomousArgs({ prompt: "p", runKind: "quick-fix" });
  assert.equal(flagValue(args, "--model"), "opus");
  assert.equal(flagValue(args, "--effort"), "medium");
  assert.ok(!args.includes("--strict-mcp-config"));
  assert.ok(!args.includes("--mcp-config"));
});

test("claude runs without a runKind inherit the global CLI settings", () => {
  const args = claudeProvider.buildAutonomousArgs({ prompt: "p" });
  for (const flag of ["--model", "--effort", "--strict-mcp-config", "--mcp-config"]) {
    assert.ok(!args.includes(flag), `${flag} leaked into a phase run`);
  }
});

function claudeAssistant(content: unknown[], id = "m1"): string {
  return JSON.stringify({
    type: "assistant",
    parent_tool_use_id: null,
    message: { id, content },
  });
}

const CLAUDE_RESULT = JSON.stringify({ type: "result", result: "", is_error: false });

test("claude collector flags a run that ends on a backgrounded command", () => {
  // The IDE-319 shape: the run backgrounds its wait and says nothing more, so
  // `-p` exits with the checklist never written.
  const ndjson = [
    claudeAssistant([{ type: "text", text: "Dev server'ı başlatıyorum." }]),
    claudeAssistant([
      {
        type: "tool_use",
        id: "t1",
        name: "Bash",
        input: { command: "npm run dev", run_in_background: true },
      },
    ]),
    CLAUDE_RESULT,
  ].join("\n");

  const parsed = collect(createClaudeRunOutputCollector(), ndjson);
  assert.equal(parsed.waitTailStart, 1);

  const selected = selectRunOutput(parsed, RUN_OUTPUT_CONTRACTS.verify);
  assert.equal(selected.endedWhileWaiting, true);
});

test("claude collector flags a holding remark after a wait as stranded", () => {
  const ndjson = [
    claudeAssistant([{ type: "tool_use", id: "t1", name: "Monitor", input: {} }]),
    claudeAssistant([{ type: "text", text: "Arka plan betiği tamamlandığında bildirim gelecek." }], "m2"),
    CLAUDE_RESULT,
  ].join("\n");

  const selected = selectRunOutput(
    collect(createClaudeRunOutputCollector(), ndjson),
    RUN_OUTPUT_CONTRACTS.verify,
  );
  assert.equal(selected.endedWhileWaiting, true);
});

test("claude collector does not flag a checklist written after the wait", () => {
  const ndjson = [
    claudeAssistant([
      { type: "tool_use", id: "t1", name: "Bash", input: { command: "sleep 1", run_in_background: true } },
    ]),
    claudeAssistant([{ type: "text", text: CHECKLIST }], "m2"),
    CLAUDE_RESULT,
  ].join("\n");

  const selected = selectRunOutput(
    collect(createClaudeRunOutputCollector(), ndjson),
    RUN_OUTPUT_CONTRACTS.verify,
  );
  assert.equal(selected.endedWhileWaiting, false);
  assert.match(selected.text, /^## Temel akış/);
});

test("claude collector does not flag a wait followed by more work", () => {
  const ndjson = [
    claudeAssistant([
      { type: "tool_use", id: "t1", name: "Bash", input: { command: "npm run dev", run_in_background: true } },
    ]),
    claudeAssistant([{ type: "tool_use", id: "t2", name: "Bash", input: { command: "curl localhost" } }], "m2"),
    claudeAssistant([{ type: "text", text: "Bu kadar." }], "m3"),
    CLAUDE_RESULT,
  ].join("\n");

  const parsed = collect(createClaudeRunOutputCollector(), ndjson);
  assert.equal(parsed.waitTailStart, undefined);
  assert.equal(selectRunOutput(parsed, RUN_OUTPUT_CONTRACTS.verify).endedWhileWaiting, false);
});

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
// Session ids — so the card can resume a one-shot run (IDE-347)
// ---------------------------------------------------------------------------

test("claude collector reads the session id off the init line", () => {
  const ndjson = [
    JSON.stringify({ type: "system", subtype: "init", session_id: "init-id" }),
    claudeAssistant([{ type: "text", text: CHECKLIST }]),
    JSON.stringify({ type: "result", result: "", is_error: false, session_id: "result-id" }),
  ].join("\n");

  assert.equal(collect(createClaudeRunOutputCollector(), ndjson).sessionId, "init-id");
});

test("claude collector falls back to the result envelope's session id", () => {
  const ndjson = [
    claudeAssistant([{ type: "text", text: CHECKLIST }]),
    JSON.stringify({ type: "result", result: "", is_error: false, session_id: "result-id" }),
  ].join("\n");

  assert.equal(collect(createClaudeRunOutputCollector(), ndjson).sessionId, "result-id");
});

test("claude collector leaves the session id unset when none arrived", () => {
  const ndjson = [claudeAssistant([{ type: "text", text: CHECKLIST }]), CLAUDE_RESULT].join("\n");
  assert.equal(collect(createClaudeRunOutputCollector(), ndjson).sessionId, undefined);
});

test("codex collector keeps the thread id as the session id", () => {
  const ndjson = [
    JSON.stringify({ type: "thread.started", thread_id: "thread-1" }),
    JSON.stringify({ type: "item.completed", item: { type: "agent_message", text: CHECKLIST } }),
  ].join("\n");

  assert.equal(collect(codexProvider.createRunOutputCollector(), ndjson).sessionId, "thread-1");
});

test("gemini collector keeps the first session id", () => {
  const ndjson = [
    JSON.stringify({ type: "init", session_id: "first" }),
    JSON.stringify({ type: "message", role: "assistant", delta: true, content: CHECKLIST }),
    JSON.stringify({ type: "init", session_id: "second" }),
  ].join("\n");

  assert.equal(collect(geminiProvider.createRunOutputCollector(), ndjson).sessionId, "first");
});

// ---------------------------------------------------------------------------
// Ideafy MCP down — the run's prose must not reach the card (IDE-380)
// ---------------------------------------------------------------------------

function initWith(servers: Array<{ name: string; status: string }>): string {
  return JSON.stringify({ type: "system", subtype: "init", session_id: "s", mcp_servers: servers });
}

const COULD_NOT_CONNECT = "Ideafy MCP sunucusu bu koşuda bağlanamadı, kartı okuyamadım.";

test("claude collector fails the run when the Ideafy plugin server failed at init", () => {
  const ndjson = [
    initWith([{ name: "plugin:ideafy:ideafy", status: "failed" }, { name: "bear", status: "connected" }]),
    claudeAssistant([{ type: "text", text: COULD_NOT_CONNECT }]),
    JSON.stringify({ type: "result", result: COULD_NOT_CONNECT, is_error: false }),
  ].join("\n");

  const parsed = collect(createClaudeRunOutputCollector(), ndjson);
  assert.equal(parsed.isError, true);
  assert.equal(parsed.result, IDEAFY_MCP_FAILED_MESSAGE);
});

test("claude collector keeps the run when one Ideafy server connected and the other failed", () => {
  const ndjson = [
    initWith([{ name: "plugin:ideafy:ideafy", status: "failed" }, { name: "ideafy", status: "connected" }]),
    claudeAssistant([{ type: "text", text: CHECKLIST }]),
    CLAUDE_RESULT,
  ].join("\n");

  assert.equal(collect(createClaudeRunOutputCollector(), ndjson).isError, false);
});

test("claude collector does not treat a pending Ideafy server as failed", () => {
  const ndjson = [
    initWith([{ name: "plugin:ideafy:ideafy", status: "pending" }]),
    claudeAssistant([{ type: "text", text: CHECKLIST }]),
    CLAUDE_RESULT,
  ].join("\n");

  assert.equal(collect(createClaudeRunOutputCollector(), ndjson).isError, false);
});

test("claude collector ignores failed servers that are not Ideafy", () => {
  const ndjson = [
    initWith([{ name: "bear", status: "failed" }, { name: "plugin:ideafy:ideafy", status: "connected" }]),
    claudeAssistant([{ type: "text", text: CHECKLIST }]),
    CLAUDE_RESULT,
  ].join("\n");

  assert.equal(collect(createClaudeRunOutputCollector(), ndjson).isError, false);
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
