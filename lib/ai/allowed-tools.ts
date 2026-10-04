import type { SectionType } from "../types";
import { IDEAFY_MCP_SERVER, IDEAFY_PLUGIN_MCP_ID, mcpServerKey } from "../platform/mcp-tool-names";

export type AllowedToolsMention = { type: string; id: string; label: string };

/**
 * The Tests tab on a card past planning runs with every permission, so it gets
 * no allow-list. Asked to fix something, it writes, in the card's worktree or
 * else the project folder, and the run queue counts it as a run for that reason.
 */
export function isTestActionFor(sectionType: string, status: string): boolean {
  return sectionType === "tests" && ["progress", "test", "completed"].includes(status);
}

/**
 * The `--allowedTools` list for a chat-stream spawn: read-only file tools plus
 * whatever the referenced MCP servers may be asked for in this section.
 */
/**
 * The read-only Ideafy tools the Opinion chat's evaluation runs on: the card,
 * the earlier-cards search and the open-work list. Allowed without a mention,
 * or a -p turn denies them and the check falls through to "tools missing".
 * Under both names Ideafy registers with — the plugin and a plain server.
 */
const EVALUATION_TOOLS = ["get_card", "search_cards", "list_open_work"];

function evaluationTools(): string[] {
  const servers = [mcpServerKey(IDEAFY_PLUGIN_MCP_ID), IDEAFY_MCP_SERVER];
  return servers.flatMap((server) => EVALUATION_TOOLS.map((tool) => `mcp__${server}__${tool}`));
}

export function getAllowedTools(
  section: SectionType,
  mentions?: AllowedToolsMention[]
): string[] {
  const base = ["Read", "Grep", "Glob"];
  // Writes stay out: the Opinion still lands on the card through Apply.
  if (section === "opinion") base.push(...evaluationTools());

  // Add MCP tool patterns for referenced MCP mentions
  if (mentions?.length) {
    for (const m of mentions) {
      if (m.type === "mcp" || m.type === "plugin") {
        const server = mcpServerKey(m.id);
        if (section === "tests") {
          base.push(`mcp__${server}__*`);
          continue;
        }

        // Outside the Tests tab, never expose save_tests/move_card/etc.
        // Restrict the model to read-only inspection plus the field-appropriate
        // persistence tools for the active section.
        base.push(`mcp__${server}__get_card`);
        // Detail/Solution/Opinion intentionally exclude their write tools
        // (update_card / save_plan / save_opinion). All content writes go
        // through the chat-UI Apply buttons (append/replace) so the user
        // controls when existing content is overwritten. Letting the model
        // call write tools from here re-introduces the silent-overwrite bug.
        // Status transition (→ in progress on Solution apply) and verdict
        // parsing (on Opinion apply) are handled by the apply-message route.
      }
    }
  }

  return Array.from(new Set(base));
}
