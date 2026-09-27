import type Database from "better-sqlite3";
import { v4 as uuidv4 } from "uuid";

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
