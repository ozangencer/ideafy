import { MentionData } from "@/lib/types";

type NodeType = {
  type?: string;
  attrs?: Record<string, unknown>;
  content?: NodeType[];
};

/**
 * Walk a TipTap document JSON and collect every mention node into a flat
 * `MentionData[]`. Handles the unified node as well as legacy skill/mcp
 * nodes (kept for back-compat with older card content).
 */
export function extractMentions(json: Record<string, unknown>): MentionData[] {
  const mentions: MentionData[] = [];

  const traverse = (node: NodeType) => {
    if (node.type === "unifiedMention" && node.attrs) {
      const itemType = node.attrs.itemType as "skill" | "mcp" | "agent" | "plugin";
      mentions.push({
        type: itemType,
        id: node.attrs.id as string,
        label: node.attrs.label as string,
      });
    } else if (node.type === "skillMention" && node.attrs) {
      mentions.push({
        type: "skill",
        id: node.attrs.id as string,
        label: node.attrs.label as string,
      });
    } else if (node.type === "mcpMention" && node.attrs) {
      mentions.push({
        type: "mcp",
        id: node.attrs.id as string,
        label: node.attrs.label as string,
      });
    } else if (node.type === "cardMention" && node.attrs) {
      const displayId = (node.attrs.displayId as string) || "";
      const title = (node.attrs.title as string) || "";
      const cardLabel =
        displayId && title ? `${displayId} · ${title}` : displayId || title || "Card";
      mentions.push({
        type: "card",
        id: node.attrs.id as string,
        label: cardLabel,
      });
    } else if (node.type === "documentMention" && node.attrs) {
      const docLabel = (node.attrs.name || node.attrs.label || "Document") as string;
      mentions.push({
        type: "document",
        id: node.attrs.id as string,
        label: docLabel,
      });
    }

    if (node.content && Array.isArray(node.content)) {
      node.content.forEach(traverse);
    }
  };

  traverse(json as NodeType);
  return mentions;
}
