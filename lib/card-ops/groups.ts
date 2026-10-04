import { compareByChainOrder, placeAfter } from "../chain-order";
import { allRows, getRow, runChanges, transaction, type SqlDb } from "./db";

// Card groups, as both the app and the MCP server write them.
//
// A group is a chain of cards that belong to one piece of work — a label with
// an identity, not an epic (no status, no completion state, no date). The app's
// /api/card-groups routes and the MCP's create_group / update_group /
// delete_group / update_card(afterCardId) call these, so a group minted by
// Claude looks and collides exactly like one minted in the picker, and a group
// deleted from a terminal lets go of its cards the way the board does.
//
// Card PUT and POST keep their own single write; they only ask
// assertGroupAssignable() first, so a group id that points at nothing or at
// another project's group is refused on both sides.
//
// Imports nothing but chain-order and db: the MCP bundle pulls this file in.

/** What a group gets when nobody picked a color: the picker's first preset. */
export const DEFAULT_GROUP_COLOR = "#5e6ad2";

// The code is shown on the card face, so it is normalised, not trusted —
// uppercase, letters and digits only, at most six characters.
export const GROUP_CODE_MAX = 6;

export function normalizeGroupCode(raw: string): string {
  return raw
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "")
    .slice(0, GROUP_CODE_MAX);
}

/**
 * A card's groupId as a request carries it. Undefined means "not sent, leave
 * it"; null and "" both mean "take the card out of its group" — the board's
 * picker sends "" for None, and an agent sends null.
 */
export function normalizeGroupId(value: unknown): string | null | undefined {
  if (value === undefined) return undefined;
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

/**
 * The routes turn `kind` into 404 / 400 / 409; the MCP shows the message as
 * it is, so the message is written for an agent that has to pick its next
 * call.
 */
export class CardGroupError extends Error {
  constructor(
    message: string,
    readonly kind: "not_found" | "invalid" | "conflict" = "invalid"
  ) {
    super(message);
    this.name = "CardGroupError";
  }
}

export interface CardGroupRow {
  id: string;
  projectId: string | null;
  code: string;
  name: string;
  color: string | null;
  createdAt: string;
  memberCount: number;
}

// card_groups arrived with a migration. The plugin can run against an app that
// has not taken it yet, and a raw "no such table" would read as a bug in the
// tool rather than an app that needs updating. The app always has the table.
function assertGroupsTable(db: SqlDb): void {
  const row = getRow(db, `SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'card_groups'`);
  if (!row) {
    throw new CardGroupError(
      "This Ideafy database has no card groups yet. Update the Ideafy app, then try again."
    );
  }
}

function assertProjectExists(db: SqlDb, projectId: string): void {
  if (!getRow(db, `SELECT id FROM projects WHERE id = ?`, projectId)) {
    throw new CardGroupError(`Project not found: ${projectId}`);
  }
}

const SELECT_GROUPS = `
  SELECT
    g.id, g.project_id AS projectId, g.code, g.name, g.color, g.created_at AS createdAt,
    (SELECT COUNT(*) FROM cards c WHERE c.group_id = g.id) AS memberCount
  FROM card_groups g
`;

export function getGroup(db: SqlDb, id: string): CardGroupRow | null {
  assertGroupsTable(db);
  return getRow<CardGroupRow>(db, `${SELECT_GROUPS} WHERE g.id = ?`, id) ?? null;
}

// With a projectId, returns what the card modal would offer for a card in that
// project: the project's own groups plus the ones not tied to any project.
export function listGroups(db: SqlDb, projectId?: string): CardGroupRow[] {
  assertGroupsTable(db);
  if (projectId) {
    return allRows<CardGroupRow>(
      db,
      `${SELECT_GROUPS} WHERE g.project_id IS NULL OR g.project_id = ? ORDER BY g.code`,
      projectId
    );
  }
  return allRows<CardGroupRow>(db, `${SELECT_GROUPS} ORDER BY g.code`);
}

// A code only has to be unique among the groups a card could be offered
// together: a project's own groups plus the global ones. A global group is
// offered in every project, so it has to be unique against all of them.
function findCodeClash(
  db: SqlDb,
  code: string,
  projectId: string | null,
  exceptId: string | null
): CardGroupRow | null {
  const candidates = projectId ? listGroups(db, projectId) : listGroups(db);
  return candidates.find((g) => g.id !== exceptId && g.code.toUpperCase() === code) ?? null;
}

// group_id is a plain column, not a foreign key. An unknown id would leave the
// card pointing at nothing, and the board would silently render it outside any
// chain; another project's group would never be offered by the picker.
export function assertGroupAssignable(
  db: SqlDb,
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

export function createGroup(
  db: SqlDb,
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
      `A group with code ${code} already exists: ${clash.id} (${clash.name}). Use that id as groupId instead of creating a new one.`,
      "conflict"
    );
  }

  const row = {
    id: globalThis.crypto.randomUUID(),
    projectId,
    code,
    // A nameless group reads as its code — the backfill writes the same.
    name: input.name?.trim() || code,
    // Not sent: the picker's default, so a terminal-made group does not show
    // up grey next to hand-made ones. An explicit null or "" means no color.
    color: input.color === undefined ? DEFAULT_GROUP_COLOR : input.color || null,
    createdAt: now,
  };
  runChanges(
    db,
    `INSERT INTO card_groups (id, project_id, code, name, color, created_at) VALUES (?, ?, ?, ?, ?, ?)`,
    row.id,
    row.projectId,
    row.code,
    row.name,
    row.color,
    row.createdAt
  );
  return { ...row, memberCount: 0 };
}

/**
 * Changes a group's code, name, color or project. An update that names
 * nothing returns the row untouched — the app's Save can send one; the MCP
 * tool refuses an empty call before it gets here.
 */
export function updateGroup(
  db: SqlDb,
  id: string,
  updates: { code?: string; name?: string; color?: string | null; projectId?: string | null }
): CardGroupRow {
  const existing = getGroup(db, id);
  if (!existing) throw new CardGroupError(`Group not found: ${id}`, "not_found");

  const code = updates.code !== undefined ? normalizeGroupCode(String(updates.code)) : existing.code;
  const name = updates.name !== undefined ? String(updates.name).trim() : existing.name;
  if (!code || !name) throw new CardGroupError("Group code and name cannot be empty.");
  const color = updates.color !== undefined ? updates.color || null : existing.color;
  const projectId = updates.projectId !== undefined ? updates.projectId || null : existing.projectId;

  if (
    code === existing.code &&
    name === existing.name &&
    color === existing.color &&
    projectId === existing.projectId
  ) {
    return existing;
  }

  if (projectId !== existing.projectId && projectId) {
    assertProjectExists(db, projectId);
    // Members from another project would be left in a group their project is
    // never offered. Going global is always fine.
    const strays = getRow<{ count: number }>(
      db,
      `SELECT COUNT(*) AS count FROM cards WHERE group_id = ? AND project_id IS NOT NULL AND project_id != ?`,
      id,
      projectId
    );
    if (Number(strays?.count ?? 0) > 0) {
      throw new CardGroupError(
        `Group ${existing.code} has ${strays!.count} card(s) from another project; move them out of the group first, or keep it global.`,
        "conflict"
      );
    }
  }

  if (code !== existing.code || projectId !== existing.projectId) {
    const clash = findCodeClash(db, code, projectId, id);
    if (clash) {
      throw new CardGroupError(`Code ${code} is already used by group ${clash.id} (${clash.name}).`, "conflict");
    }
  }

  runChanges(
    db,
    `UPDATE card_groups SET project_id = ?, code = ?, name = ?, color = ? WHERE id = ?`,
    projectId,
    code,
    name,
    color,
    id
  );
  return { ...existing, projectId, code, name, color };
}

/**
 * Drops a group and lets go of its cards: they stay where they are, in no
 * group. Membership is a plain column, not a foreign key, so releasing the
 * members is our job — otherwise they keep pointing at a group that is gone.
 * 0016's trigger clears each released card's chain position.
 */
export function deleteGroup(
  db: SqlDb,
  id: string
): { group: CardGroupRow; releasedCards: number } {
  return transaction(db, () => {
    const group = getGroup(db, id);
    if (!group) throw new CardGroupError(`Group not found: ${id}`, "not_found");
    const { changes } = runChanges(db, `UPDATE cards SET group_id = NULL WHERE group_id = ?`, id);
    runChanges(db, `DELETE FROM card_groups WHERE id = ?`, id);
    return { group, releasedCards: changes };
  });
}

export interface ChainMove {
  groupId: string;
  /** 1-based position of the moved card. */
  position: number;
  total: number;
  /** Every member in chain order with the position it has now. */
  order: Array<{ id: string; groupOrder: number | null }>;
  /** False when the move asked for the order the chain already had. */
  changed: boolean;
}

/**
 * Moves one card within its chain, the board's "Move after…": a null
 * `afterCardId` puts it at the start. Every member gets a fresh 1..N,
 * finished ones included, computed from the rows as they are inside the
 * transaction — so a board tab and a session reordering at once still leave
 * one consistent order, whichever wrote last. A move that lands the chain in
 * the order it already had writes nothing.
 *
 * `updated_at` is left alone on purpose: the Stale row measures age from it,
 * and reordering a chain is not work on any card.
 *
 * Needs `group_order` (0016); the MCP checks for it before calling. Runs as a
 * savepoint when update_card calls it inside its own transaction.
 */
export function moveCardInChain(
  db: SqlDb,
  cardId: string,
  afterCardId: string | null,
  expectedGroupId?: string
): ChainMove {
  if (afterCardId === cardId) {
    throw new CardGroupError("afterCardId cannot be the card itself.");
  }

  return transaction(db, () => {
    const card = getRow<{ groupId: string | null }>(db, `SELECT group_id AS groupId FROM cards WHERE id = ?`, cardId);
    if (!card) throw new CardGroupError(`Card not found: ${cardId}`, "not_found");
    if (expectedGroupId !== undefined && card.groupId !== expectedGroupId) {
      throw new CardGroupError("Card is not in this group.");
    }
    if (!card.groupId) {
      throw new CardGroupError(
        "This card is in no group, so it has no chain to order. Pass groupId in the same call to add it to one."
      );
    }

    const members = allRows<{ id: string; groupOrder: number | null; taskNumber: number | null }>(
      db,
      `SELECT id, group_order AS groupOrder, task_number AS taskNumber FROM cards WHERE group_id = ?`,
      card.groupId
    );
    if (afterCardId !== null && !members.some((member) => member.id === afterCardId)) {
      throw new CardGroupError("afterCardId is not in this card's group. Call list_groups to see the chain.");
    }

    const current = [...members].sort(compareByChainOrder);
    const ids = placeAfter(members, cardId, afterCardId);
    const position = ids.indexOf(cardId) + 1;
    if (ids.every((id, index) => id === current[index].id)) {
      return {
        groupId: card.groupId,
        position,
        total: ids.length,
        order: current.map((member) => ({ id: member.id, groupOrder: member.groupOrder })),
        changed: false,
      };
    }

    const write = db.prepare(`UPDATE cards SET group_order = ? WHERE id = ?`);
    ids.forEach((id, index) => write.run(index + 1, id));
    return {
      groupId: card.groupId,
      position,
      total: ids.length,
      order: ids.map((id, index) => ({ id, groupOrder: index + 1 })),
      changed: true,
    };
  });
}
