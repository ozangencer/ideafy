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
