import type Database from "better-sqlite3";
import { v4 as uuidv4 } from "uuid";
import {
  buildChainContext,
  compareByChainOrder,
  isFinished,
  placeAfter,
  type ChainCardRef,
  type ChainContext,
} from "./chain-order.generated.js";
import { hasColumn } from "./output-paths.js";

// Card groups over MCP. A group is a chain of cards that belong to one piece
// of work — a label with an identity, not an epic (no status, no completion
// state, no date). The rules here mirror the card modal's group picker
// (components/board/card-modal/card-group-picker.tsx) so a group minted by
// Claude looks and collides exactly like one minted by hand.

export interface CardGroupRow {
  id: string;
  projectId: string | null;
  code: string;
  name: string;
  color: string | null;
  createdAt: string;
  memberCount: number;
}

export class CardGroupError extends Error {}

// Same as the picker: the code is shown on the card face, so it is normalised,
// not trusted — uppercase, letters and digits only, at most six characters.
export const GROUP_CODE_MAX = 6;

export function normalizeGroupCode(raw: string): string {
  return raw
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "")
    .slice(0, GROUP_CODE_MAX);
}

// card_groups arrived with a migration. The plugin can run against an app that
// has not taken it yet, and a raw "no such table" would read as a bug in the
// tool rather than an app that needs updating.
function assertGroupsTable(db: Database.Database): void {
  const row = db
    .prepare(`SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'card_groups'`)
    .get();
  if (!row) {
    throw new CardGroupError(
      "This Ideafy database has no card groups yet. Update the Ideafy app, then try again."
    );
  }
}

function assertProjectExists(db: Database.Database, projectId: string): void {
  const row = db.prepare(`SELECT id FROM projects WHERE id = ?`).get(projectId);
  if (!row) throw new CardGroupError(`Project not found: ${projectId}`);
}

const SELECT_GROUPS = `
  SELECT
    g.id, g.project_id AS projectId, g.code, g.name, g.color, g.created_at AS createdAt,
    (SELECT COUNT(*) FROM cards c WHERE c.group_id = g.id) AS memberCount
  FROM card_groups g
`;

export function getGroup(db: Database.Database, id: string): CardGroupRow | null {
  assertGroupsTable(db);
  const row = db.prepare(`${SELECT_GROUPS} WHERE g.id = ?`).get(id) as CardGroupRow | undefined;
  return row ?? null;
}

// With a projectId, returns what the card modal would offer for a card in that
// project: the project's own groups plus the ones not tied to any project.
export function listGroups(db: Database.Database, projectId?: string): CardGroupRow[] {
  assertGroupsTable(db);
  if (projectId) {
    return db
      .prepare(`${SELECT_GROUPS} WHERE g.project_id IS NULL OR g.project_id = ? ORDER BY g.code`)
      .all(projectId) as CardGroupRow[];
  }
  return db.prepare(`${SELECT_GROUPS} ORDER BY g.code`).all() as CardGroupRow[];
}

// A code only has to be unique among the groups a card could be offered
// together: a project's own groups plus the global ones. A global group is
// offered in every project, so it has to be unique against all of them.
function findCodeClash(
  db: Database.Database,
  code: string,
  projectId: string | null,
  exceptId: string | null
): CardGroupRow | null {
  const candidates = projectId ? listGroups(db, projectId) : listGroups(db);
  return candidates.find((g) => g.id !== exceptId && g.code.toUpperCase() === code) ?? null;
}

export function createGroup(
  db: Database.Database,
  input: { code: string; name?: string; color?: string | null; projectId?: string | null },
  now: string = new Date().toISOString()
): CardGroupRow {
  assertGroupsTable(db);
  const code = normalizeGroupCode(input.code ?? "");
  if (!code) {
    throw new CardGroupError("Group code is required: letters and digits, up to 6 characters (e.g. MOBILE).");
  }
  const projectId = input.projectId || null;
  if (projectId) assertProjectExists(db, projectId);

  const clash = findCodeClash(db, code, projectId, null);
  if (clash) {
    throw new CardGroupError(
      `A group with code ${code} already exists: ${clash.id} (${clash.name}). Use that id as groupId instead of creating a new one.`
    );
  }

  const row = {
    id: uuidv4(),
    projectId,
    code,
    // A nameless group reads as its code, same as the app's POST route.
    name: input.name?.trim() || code,
    color: input.color || null,
    createdAt: now,
  };
  db.prepare(
    `INSERT INTO card_groups (id, project_id, code, name, color, created_at) VALUES (?, ?, ?, ?, ?, ?)`
  ).run(row.id, row.projectId, row.code, row.name, row.color, row.createdAt);

  return { ...row, memberCount: 0 };
}

export function updateGroup(
  db: Database.Database,
  id: string,
  updates: { code?: string; name?: string; color?: string | null }
): CardGroupRow {
  const existing = getGroup(db, id);
  if (!existing) throw new CardGroupError(`Group not found: ${id}`);

  const code = updates.code !== undefined ? normalizeGroupCode(updates.code) : existing.code;
  const name = updates.name !== undefined ? updates.name.trim() : existing.name;
  if (!code || !name) throw new CardGroupError("Group code and name cannot be empty.");
  if (updates.code === undefined && updates.name === undefined && updates.color === undefined) {
    throw new CardGroupError(`update_group: nothing to update for group ${id}. Pass code, name or color.`);
  }

  if (code !== existing.code) {
    const clash = findCodeClash(db, code, existing.projectId, id);
    if (clash) throw new CardGroupError(`Code ${code} is already used by group ${clash.id} (${clash.name}).`);
  }

  const color = updates.color !== undefined ? updates.color || null : existing.color;
  db.prepare(`UPDATE card_groups SET code = ?, name = ?, color = ? WHERE id = ?`).run(code, name, color, id);
  return { ...existing, code, name, color };
}

// create_card and update_card write group_id as a plain column, not a foreign
// key. An unknown id would leave the card pointing at nothing, and the board
// would silently render it outside any chain.
export function assertGroupAssignable(
  db: Database.Database,
  groupId: string | null | undefined,
  projectId: string | null
): void {
  if (groupId === null || groupId === undefined) return;
  const group = getGroup(db, groupId);
  if (!group) {
    throw new CardGroupError(`Group not found: ${groupId}. Call list_groups for valid ids, or create_group first.`);
  }
  if (group.projectId && projectId && group.projectId !== projectId) {
    throw new CardGroupError(
      `Group ${group.code} belongs to another project (${group.projectId}); this card is in ${projectId}.`
    );
  }
}

// ---------------------------------------------------------------------------
// Chain context: where a card sits in its group
// ---------------------------------------------------------------------------
// The order is the board's, from lib/chain-order.ts via the generated copy —
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
function groupOrderSelect(db: Database.Database): string {
  return hasColumn(db, "cards", "group_order") ? "c.group_order" : "NULL";
}

// Joined per card, not per group: without a projectId, list_groups returns
// global groups whose members can come from different projects, and each
// displayId has to carry its own project's prefix.
function selectMembers(db: Database.Database, where: string): string {
  return `
    SELECT
      c.id, c.group_id AS groupId, c.title, c.status,
      c.task_number AS taskNumber, ${groupOrderSelect(db)} AS groupOrder,
      p.id_prefix AS idPrefix
    FROM cards c LEFT JOIN projects p ON p.id = c.project_id
    WHERE ${where}
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
  db: Database.Database,
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
export function listGroupsWithChains(db: Database.Database, projectId?: string): GroupWithChain[] {
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

// update_card's afterCardId: the MCP twin of the app's order route
// (app/api/card-groups/[id]/order/route.ts). Every member gets a fresh 1..N,
// finished ones included, computed from the rows as they are inside the
// transaction — so a board tab and a session reordering at once still leave
// one consistent order, whichever wrote last.
//
// `updated_at` is left alone on purpose, as in the route: the Stale row
// measures age from it, and reordering a chain is not work on any card.
export function moveCardInChain(
  db: Database.Database,
  cardId: string,
  afterCardId: string | null
): { position: number; total: number } {
  if (!hasColumn(db, "cards", "group_order")) {
    throw new CardGroupError(
      "This Ideafy database cannot store a chain order yet. Update the Ideafy app, then try again."
    );
  }
  if (afterCardId === cardId) {
    throw new CardGroupError("afterCardId cannot be the card itself.");
  }

  return db.transaction(() => {
    const card = db.prepare(`SELECT group_id AS groupId FROM cards WHERE id = ?`).get(cardId) as
      | { groupId: string | null }
      | undefined;
    if (!card) throw new CardGroupError(`Card not found: ${cardId}`);
    if (!card.groupId) {
      throw new CardGroupError(
        "This card is in no group, so it has no chain to order. Pass groupId in the same call to add it to one."
      );
    }

    const members = db
      .prepare(`SELECT id, group_order AS groupOrder, task_number AS taskNumber FROM cards WHERE group_id = ?`)
      .all(card.groupId) as Array<{ id: string; groupOrder: number | null; taskNumber: number | null }>;
    if (afterCardId !== null && !members.some((member) => member.id === afterCardId)) {
      throw new CardGroupError("afterCardId is not in this card's group. Call list_groups to see the chain.");
    }

    const ids = placeAfter(members, cardId, afterCardId);
    const write = db.prepare(`UPDATE cards SET group_order = ? WHERE id = ?`);
    ids.forEach((id, index) => write.run(index + 1, id));
    return { position: ids.indexOf(cardId) + 1, total: ids.length };
  })();
}
