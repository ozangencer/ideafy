import type { AgentListItem, SkillListItem, ToolkitItem, UnifiedItem } from "@/lib/types";
import { groupToolkitByFolder } from "../toolkit-keys";

export interface UnifiedItemSources {
  skills: string[];
  mcps: string[];
  agents: string[];
  // Catalog rows, used only to tell which names came from a plugin.
  skillItems: SkillListItem[];
  agentItems: AgentListItem[];
  toolkit: ToolkitItem[];
}

/**
 * The `/` picker's list: every skill, MCP and agent once, with the project's
 * Toolkit pins first in the order the sidebar shows them (loose pins, then
 * folders) and flagged `pinned` with their folder, the rest alphabetical. A
 * pin the catalog no longer lists is left out — the picker only offers what
 * the active provider can run.
 */
export function buildUnifiedItems(sources: UnifiedItemSources): UnifiedItem[] {
  const skillPluginKeys = new Map<string, string>();
  sources.skillItems.forEach((item) => {
    if (item.pluginKey) skillPluginKeys.set(item.name, item.pluginKey);
  });
  const agentPluginKeys = new Map<string, string>();
  sources.agentItems.forEach((item) => {
    if (item.pluginKey) agentPluginKeys.set(item.name, item.pluginKey);
  });

  const items: UnifiedItem[] = [];
  const seen = new Set<string>();
  const add = (values: string[], type: UnifiedItem["type"], pluginKeyOf: (name: string) => string | null) => {
    for (const value of values) {
      const key = `${type}-${value}`;
      if (seen.has(key)) continue;
      seen.add(key);
      items.push({ id: value, label: value, type, pluginKey: pluginKeyOf(value) });
    }
  };

  add(sources.skills, "skill", (name) => skillPluginKeys.get(name) ?? null);
  // MCPs arrive as bare names; the namespace prefix is the only plugin signal.
  add(sources.mcps, "mcp", (name) => (name.includes(":") ? name.split(":")[0] : null));
  add(sources.agents, "agent", (name) => agentPluginKeys.get(name) ?? null);

  const pinOrder = new Map<string, number>();
  const pinFolder = new Map<string, string | null>();
  groupToolkitByFolder(sources.toolkit)
    .flatMap((group) => group.items)
    .forEach((pin, index) => {
      pinOrder.set(`${pin.kind}-${pin.name}`, index);
      pinFolder.set(`${pin.kind}-${pin.name}`, pin.folder);
    });

  const pinned: UnifiedItem[] = [];
  const rest: UnifiedItem[] = [];
  for (const item of items) {
    const key = `${item.type}-${item.id}`;
    if (pinOrder.has(key)) pinned.push({ ...item, pinned: true, folder: pinFolder.get(key) ?? null });
    else rest.push(item);
  }

  pinned.sort((a, b) => pinOrder.get(`${a.type}-${a.id}`)! - pinOrder.get(`${b.type}-${b.id}`)!);
  rest.sort((a, b) => a.label.localeCompare(b.label));
  return [...pinned, ...rest];
}
