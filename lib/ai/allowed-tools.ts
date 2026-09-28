import type { SectionType } from "../types";
import { mcpServerKey } from "../platform/mcp-tool-names";

export type AllowedToolsMention = { type: string; id: string; label: string };

/**
 * The `--allowedTools` list for a chat-stream spawn: read-only file tools plus
 * whatever the referenced MCP servers may be asked for in this section.
 */
export function getAllowedTools(
  section: SectionType,
  mentions?: AllowedToolsMention[]
): string[] {
  const base = ["Read", "Grep", "Glob"];

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
