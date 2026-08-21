import type { AiPlatform } from "../types";

/**
 * The Ideafy MCP server's name as every provider's config registers it
 * (`buildMcpInvocation` is installed under this key in all four).
 */
export const IDEAFY_MCP_SERVER = "ideafy";

/**
 * Claude Code's naming for an MCP tool, which is what every prompt in this
 * codebase is written in: `mcp__<server>__<tool>`.
 */
const CLAUDE_TOOL_REFERENCE = new RegExp(`mcp__${IDEAFY_MCP_SERVER}__([a-z_]+)`, "g");

const CROSS_PROVIDER_NOTE = `

## A note on the tool names above

They belong to the \`${IDEAFY_MCP_SERVER}\` MCP server. Your CLI may register them under a prefixed name — \`${IDEAFY_MCP_SERVER}_get_card\`, \`${IDEAFY_MCP_SERVER}__get_card\`, \`${IDEAFY_MCP_SERVER}.get_card\` — so match on the tool's own name and call whatever spelling is actually registered. If no such tool is available at all, say so plainly instead of guessing at the card's contents.`;

/**
 * Rewrite Claude-shaped MCP tool references for the provider that will actually
 * run the prompt.
 *
 * Every prompt builder spells its tools `mcp__ideafy__get_card` because that is
 * Claude Code's convention, and the convention is not shared: the other CLIs
 * expose MCP tools under their own prefixing scheme, which varies by version.
 * Rather than encode three guesses, this strips the Claude prefix down to the
 * bare tool name — which is stable across all of them — and appends one note
 * naming the server, so the model can match whatever spelling it was given.
 *
 * Claude prompts are returned untouched: for them the literal name is correct
 * and is also what `--allowedTools` style config keys off.
 */
export function adaptMcpToolNames(prompt: string, platform: AiPlatform): string {
  if (platform === "claude") return prompt;

  let rewrote = false;
  const adapted = prompt.replace(CLAUDE_TOOL_REFERENCE, (_match, tool: string) => {
    rewrote = true;
    return tool;
  });

  return rewrote ? `${adapted}${CROSS_PROVIDER_NOTE}` : adapted;
}
