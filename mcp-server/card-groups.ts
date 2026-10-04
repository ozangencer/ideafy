import type { Db } from "./db.js";
import {
  CardGroupError,
  buildChainContext,
  compareByChainOrder,
  getGroup,
  isFinished,
  listGroups,
  moveCardInChain as moveInChain,
  type CardGroupRow,
  type ChainCardRef,
  type ChainContext,
} from "./shared.js";
import { hasCapability } from "./schema-caps.js";

// Card groups over MCP, the read side: get_card's `chain` and list_groups'
// members. Every group write — create, update, delete, membership checks and
// the chain order — lives in lib/card-ops/groups.ts and reaches this server
// through shared.ts, so a group minted or deleted by Claude behaves exactly
// like one handled in the card modal's picker.
// __tests__/group-writes.test.ts fails if a raw card_groups write lands here.

export {
  CardGroupError,
  assertGroupAssignable,
  createGroup,
  deleteGroup,
  getGroup,
  listGroups,
  normalizeGroupCode,
  normalizeGroupId,
  updateGroup,
} from "./shared.js";
export type { CardGroupRow } from "./shared.js";

// ---------------------------------------------------------------------------
// Chain context: where a card sits in its group
// ---------------------------------------------------------------------------
// The order is the board's, from lib/chain-order.ts —
// an MCP `next` that disagrees with the board's row would be worse than none.

export interface CardChain extends ChainContext {
  groupId: string;
  groupCode: string;
  groupName: string;
}

export interface ChainMemberRow {
  id: string;
  groupId: string;
  title: string;
  status: string;
  taskNumber: number | null;
  groupOrder: number | null;
  idPrefix: string | null;
}

export interface GroupWithChain extends CardGroupRow {
  /** The chain's next actionable card; null once every member is finished. */
  next: ChainCardRef | null;
  /** Every member in chain order, finished ones included. */
  members: Array<ChainCardRef & { position: number }>;
}

// group_order arrived with migration 0016, which the app may not have run yet
// (the plugin and the app update independently). Without it every member
// reads as unplaced, so the order falls back to task numbers — the rule every
// chain followed before manual ordering existed.
function groupOrderSelect(db: Db): string {
  return hasCapability(db, "groupOrder") ? "c.group_order" : "NULL";
}

// Joined per card, not per group: without a projectId, list_groups returns
// global groups whose members can come from different projects, and each
// displayId has to carry its own project's prefix.
//
// Ordered the way /api/cards hands the board its cards — task number down,
// then creation time — because compareByChainOrder is a stable sort: members
// it cannot tell apart (two unplaced drafts) keep this order, and the board
// and a terminal have to show them the same way round.
function selectMembers(db: Db, where: string): string {
  return `
    SELECT
      c.id, c.group_id AS groupId, c.title, c.status,
      c.task_number AS taskNumber, ${groupOrderSelect(db)} AS groupOrder,
      p.id_prefix AS idPrefix
    FROM cards c LEFT JOIN projects p ON p.id = c.project_id
    WHERE ${where}
    ORDER BY c.task_number DESC, c.created_at
  `;
}

export function toChainRef(member: ChainMemberRow): ChainCardRef {
  return {
    displayId:
      member.idPrefix && member.taskNumber != null
        ? `${member.idPrefix}-${member.taskNumber}`
        : null,
    title: member.title,
    status: member.status,
  };
}

// get_card's `chain` field. Null for a card in no group — and for one whose
// group id points at nothing, which the board does not render as a chain
// either.
export function getChainForCard(
  db: Db,
  card: { id: string; groupId: string | null }
): CardChain | null {
  if (!card.groupId) return null;
  const group = getGroup(db, card.groupId);
  if (!group) return null;
  const members = db
    .prepare(selectMembers(db, "c.group_id = ?"))
    .all(card.groupId) as ChainMemberRow[];
  const context = buildChainContext(members, card.id, toChainRef);
  if (!context) return null;
  return { groupId: group.id, groupCode: group.code, groupName: group.name, ...context };
}

// list_groups with each chain's order spelled out. One query for every
// member of every listed group, sorted per group in memory.
export function listGroupsWithChains(db: Db, projectId?: string): GroupWithChain[] {
  const groups = listGroups(db, projectId);
  if (groups.length === 0) return [];

  const placeholders = groups.map(() => "?").join(", ");
  const rows = db
    .prepare(selectMembers(db, `c.group_id IN (${placeholders})`))
    .all(...groups.map((g) => g.id)) as ChainMemberRow[];

  const byGroup = new Map<string, ChainMemberRow[]>();
  for (const row of rows) {
    const bucket = byGroup.get(row.groupId);
    if (bucket) bucket.push(row);
    else byGroup.set(row.groupId, [row]);
  }

  return groups.map((group) => {
    const ordered = (byGroup.get(group.id) ?? []).sort(compareByChainOrder);
    const refs = ordered.map(toChainRef);
    return {
      ...group,
      next: refs.find((ref) => !isFinished(ref)) ?? null,
      members: refs.map((ref, index) => ({ ...ref, position: index + 1 })),
    };
  });
}

// update_card's afterCardId. The order itself is lib/card-ops' — the same
// function the app's order route calls; what stays here is the plugin's own
// worry, an app that has not run migration 0016 yet.
export function moveCardInChain(
  db: Db,
  cardId: string,
  afterCardId: string | null
): { position: number; total: number; changed: boolean } {
  if (!hasCapability(db, "groupOrder")) {
    throw new CardGroupError(
      "This Ideafy database cannot store a chain order yet. Update the Ideafy app, then try again."
    );
  }
  const { position, total, changed } = moveInChain(db, cardId, afterCardId);
  return { position, total, changed };
}
