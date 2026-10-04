import { eq } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { buildChainContext } from "@/lib/chain-order";
import type { PromptChain } from "@/lib/prompts/evaluation";

/**
 * A card's place in its chain, for the prompts that never call get_card —
 * one-shot Evaluate above all. Same order and same shape as MCP's `chain`
 * field (mcp-server/card-groups.ts getChainForCard), built by the same
 * buildChainContext. Every member is loaded, finished ones included: position
 * and total count the whole chain.
 */
export function loadCardChain(card: { id: string; groupId: string | null }): PromptChain | null {
  if (!card.groupId) return null;
  const group = db
    .select({ code: schema.cardGroups.code, name: schema.cardGroups.name })
    .from(schema.cardGroups)
    .where(eq(schema.cardGroups.id, card.groupId))
    .get();
  if (!group) return null;

  // Joined per card: a global group's members can come from several
  // projects, and each displayId carries its own project's prefix.
  const members = db
    .select({
      id: schema.cards.id,
      title: schema.cards.title,
      status: schema.cards.status,
      taskNumber: schema.cards.taskNumber,
      groupOrder: schema.cards.groupOrder,
      idPrefix: schema.projects.idPrefix,
    })
    .from(schema.cards)
    .leftJoin(schema.projects, eq(schema.projects.id, schema.cards.projectId))
    .where(eq(schema.cards.groupId, card.groupId))
    .all();

  const context = buildChainContext(members, card.id, (member) => ({
    displayId:
      member.idPrefix && member.taskNumber != null ? `${member.idPrefix}-${member.taskNumber}` : null,
    title: member.title,
    status: member.status,
  }));
  if (!context) return null;
  return { groupCode: group.code, groupName: group.name, ...context };
}
