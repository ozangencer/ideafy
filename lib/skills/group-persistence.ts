import { and, asc, eq, inArray, isNull, sql } from "drizzle-orm";
import { v4 as uuidv4 } from "uuid";
import { db, schema } from "@/lib/db";
import type {
  SkillGroupCollectionsResponse,
  SkillSource,
  UserSkillGroup,
} from "@/lib/types";

type ScopeDescriptor =
  | { source: "global"; projectId?: null }
  | { source: "project"; projectId: string };

function buildScopeWhere(scope: ScopeDescriptor) {
  if (scope.source === "global") {
    return and(eq(schema.skillGroups.scope, "global"), isNull(schema.skillGroups.projectId));
  }

  return and(
    eq(schema.skillGroups.scope, "project"),
    eq(schema.skillGroups.projectId, scope.projectId)
  );
}

function normalizeScope(
  source: SkillSource,
  projectId?: string | null
): ScopeDescriptor | null {
  if (source === "global") return { source: "global" };
  if (!projectId) return null;
  return { source: "project", projectId };
}

function buildCollections(
  groupRows: Array<typeof schema.skillGroups.$inferSelect>,
  itemRows: Array<typeof schema.skillGroupItems.$inferSelect>
): SkillGroupCollectionsResponse {
  const itemsByGroupId = new Map<string, string[]>();

  itemRows.forEach((item) => {
    const current = itemsByGroupId.get(item.groupId) || [];
    current.push(item.skillName);
    itemsByGroupId.set(item.groupId, current);
  });

  const globalGroups: UserSkillGroup[] = [];
  const projectGroups: Record<string, UserSkillGroup[]> = {};

  groupRows.forEach((group) => {
    const nextGroup: UserSkillGroup = {
      id: group.id,
      name: group.name,
      skillNames: itemsByGroupId.get(group.id) || [],
    };

    if (group.scope === "project" && group.projectId) {
      const current = projectGroups[group.projectId] || [];
      current.push(nextGroup);
      projectGroups[group.projectId] = current;
      return;
    }

    globalGroups.push(nextGroup);
  });

  return { globalGroups, projectGroups };
}

export function listSkillGroups(): SkillGroupCollectionsResponse {
  const groupRows = db
    .select()
    .from(schema.skillGroups)
    .orderBy(
      asc(schema.skillGroups.scope),
      asc(schema.skillGroups.projectId),
      asc(schema.skillGroups.order),
      asc(schema.skillGroups.createdAt)
    )
    .all();

  if (groupRows.length === 0) {
    return {
      globalGroups: [],
      projectGroups: {},
    };
  }

  const groupIds = groupRows.map((group) => group.id);
  const itemRows = db
    .select()
    .from(schema.skillGroupItems)
    .where(inArray(schema.skillGroupItems.groupId, groupIds))
    .orderBy(asc(schema.skillGroupItems.order), asc(schema.skillGroupItems.createdAt))
    .all();

  return buildCollections(groupRows, itemRows);
}

export function createSkillGroupRecord(
  name: string,
  source: SkillSource,
  projectId?: string | null
): { groupId: string; created: boolean } | null {
  const scope = normalizeScope(source, projectId);
  if (!scope) return null;

  const trimmedName = name.trim();
  if (!trimmedName) return null;

  const existingGroups = db
    .select()
    .from(schema.skillGroups)
    .where(buildScopeWhere(scope))
    .orderBy(asc(schema.skillGroups.order), asc(schema.skillGroups.createdAt))
    .all();

  const existing = existingGroups.find(
    (group) => group.name.toLocaleLowerCase() === trimmedName.toLocaleLowerCase()
  );

  if (existing) {
    return { groupId: existing.id, created: false };
  }

  const now = new Date().toISOString();
  const nextOrder =
    existingGroups.reduce((maxOrder, group) => Math.max(maxOrder, group.order), -1) + 1;
  const id = uuidv4();

  db.insert(schema.skillGroups)
    .values({
      id,
      name: trimmedName,
      scope: scope.source,
      projectId: scope.source === "project" ? scope.projectId : null,
      order: nextOrder,
      createdAt: now,
      updatedAt: now,
    })
    .run();

  return { groupId: id, created: true };
}

export function renameSkillGroupRecord(groupId: string, name: string): boolean {
  const trimmedName = name.trim();
  if (!trimmedName) return false;

  const group = db
    .select()
    .from(schema.skillGroups)
    .where(eq(schema.skillGroups.id, groupId))
    .get();

  if (!group) return false;

  const scope = group.scope === "project" && group.projectId
    ? { source: "project" as const, projectId: group.projectId }
    : { source: "global" as const };

  const siblings = db
    .select()
    .from(schema.skillGroups)
    .where(buildScopeWhere(scope))
    .all();

  const hasConflict = siblings.some(
    (sibling) =>
      sibling.id !== groupId &&
      sibling.name.toLocaleLowerCase() === trimmedName.toLocaleLowerCase()
  );

  if (hasConflict) return false;

  db.update(schema.skillGroups)
    .set({
      name: trimmedName,
      updatedAt: new Date().toISOString(),
    })
    .where(eq(schema.skillGroups.id, groupId))
    .run();

  return true;
}

export function deleteSkillGroupRecord(groupId: string): boolean {
  const deleted = db.delete(schema.skillGroups).where(eq(schema.skillGroups.id, groupId)).run();
  return deleted.changes > 0;
}

export function assignSkillToGroupRecord(
  skillName: string,
  groupId: string | null,
  source: SkillSource,
  projectId?: string | null
): boolean {
  const scope = normalizeScope(source, projectId);
  if (!scope) return false;

  const trimmedSkillName = skillName.trim();
  if (!trimmedSkillName) return false;

  const scopedGroups = db
    .select()
    .from(schema.skillGroups)
    .where(buildScopeWhere(scope))
    .all();

  const scopedGroupIds = scopedGroups.map((group) => group.id);
  if (groupId && !scopedGroups.some((group) => group.id === groupId)) {
    return false;
  }

  db.transaction((tx) => {
    if (scopedGroupIds.length > 0) {
      tx.delete(schema.skillGroupItems)
        .where(
          and(
            inArray(schema.skillGroupItems.groupId, scopedGroupIds),
            eq(schema.skillGroupItems.skillName, trimmedSkillName)
          )
        )
        .run();
    }

    if (!groupId) return;

    const [orderRow] = tx
      .select({
        maxOrder: sql<number>`coalesce(max(${schema.skillGroupItems.order}), -1)`,
      })
      .from(schema.skillGroupItems)
      .where(eq(schema.skillGroupItems.groupId, groupId))
      .all();

    tx.insert(schema.skillGroupItems)
      .values({
        id: uuidv4(),
        groupId,
        skillName: trimmedSkillName,
        order: (orderRow?.maxOrder ?? -1) + 1,
        createdAt: new Date().toISOString(),
      })
      .run();
  });

  return true;
}
