import test from "node:test";
import assert from "node:assert/strict";

import * as allowedNs from "../../lib/ai/allowed-tools";
import * as claudeNs from "../../lib/platform/claude-provider";
import * as namesNs from "../../lib/platform/mcp-tool-names";

/** See run-output.test.ts — `lib/` comes back through the CJS interop. */
function interop<T extends object>(ns: T): T {
  return (ns as { default?: T }).default ?? ns;
}

const { getAllowedTools } = interop(allowedNs);
const { claudeProvider } = interop(claudeNs);
const { mcpServerKey } = interop(namesNs);

/**
 * A chat mention of a plugin's MCP server used to be allowed under its sidebar
 * id (`ideafy:ideafy`), which never matches the name Claude Code registers it
 * under, and a resumed chat never received an allow-list at all. Both landed
 * as silent permission denials.
 */

const PLUGIN_MCP = { type: "mcp", id: "ideafy:ideafy", label: "ideafy:ideafy" };
const PLAIN_MCP = { type: "mcp", id: "supabase", label: "supabase" };

test("a plugin MCP id maps to Claude Code's plugin server key", () => {
  assert.equal(mcpServerKey("ideafy:ideafy"), "plugin_ideafy_ideafy");
  assert.equal(mcpServerKey("supabase"), "supabase");
});

test("chat sections allow get_card under the registered server name", () => {
  const tools = getAllowedTools("detail", [PLUGIN_MCP, PLAIN_MCP]);
  assert.ok(tools.includes("mcp__plugin_ideafy_ideafy__get_card"));
  assert.ok(tools.includes("mcp__supabase__get_card"));
  assert.ok(!tools.some((t) => t.includes("ideafy:ideafy")));
});

test("a chat outside the Tests tab cannot queue a card", () => {
  // queue_card starts an unattended run; only the Tests tab gets the whole
  // server, and the other tabs stay on get_card.
  for (const section of ["detail", "opinion", "solution"] as const) {
    const tools = getAllowedTools(section, [PLUGIN_MCP]);
    assert.ok(!tools.some((t) => /queue_card|__\*$/.test(t)), section);
  }
});

test("the tests section allows every tool of the mentioned server", () => {
  const tools = getAllowedTools("tests", [PLUGIN_MCP]);
  assert.ok(tools.includes("mcp__plugin_ideafy_ideafy__*"));
});

test("a resumed stream still carries the allow-list", () => {
  const args = claudeProvider.buildStreamArgs({
    prompt: "hi",
    resumeSessionId: "abc",
    allowedTools: ["Read", "mcp__plugin_ideafy_ideafy__get_card"],
  });
  assert.ok(args.includes("--resume"));
  const i = args.indexOf("--allowedTools");
  assert.ok(i !== -1);
  assert.equal(args[i + 2], "mcp__plugin_ideafy_ideafy__get_card");
});

test("skipPermissions drops the allow-list", () => {
  const args = claudeProvider.buildStreamArgs({
    prompt: "hi",
    resumeSessionId: "abc",
    skipPermissions: true,
    allowedTools: ["Read"],
  });
  assert.ok(!args.includes("--allowedTools"));
});

/**
 * A chat turn is its own `-p`: background work it leaves running is stopped at
 * exit (IDE-392), so the wait tools are denied on every turn, resumed or not.
 */
function disallowedTools(args: string[]): string[] {
  const flags = args.filter((a) => a === "--disallowedTools");
  assert.equal(flags.length, 1, "one --disallowedTools flag");
  return args[args.indexOf("--disallowedTools") + 1].split(",");
}

test("a chat turn denies the background wait tools, resumed too", () => {
  for (const extra of [{}, { resumeSessionId: "abc" }]) {
    const denied = disallowedTools(claudeProvider.buildStreamArgs({ prompt: "hi", ...extra }));
    assert.ok(denied.includes("Monitor"));
    assert.ok(denied.includes("ScheduleWakeup"));
    assert.ok(!denied.includes("Edit"));
  }
});

test("a read-only Tests turn shares the flag with the write denials", () => {
  const denied = disallowedTools(
    claudeProvider.buildStreamArgs({ prompt: "hi", skipPermissions: true, readOnly: true }),
  );
  assert.ok(denied.includes("Monitor"));
  assert.ok(denied.includes("Edit"));
  assert.ok(denied.includes("Bash"));
});
