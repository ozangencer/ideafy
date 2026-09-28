import { and, asc, eq, sql } from "drizzle-orm";
import { v4 as uuidv4 } from "uuid";
import { db, schema } from "./db";
import type { ProjectToolkitItemRecord } from "./db/schema";
import type { SkillSource, ToolkitItem, ToolkitKind } from "./types";
import { normalizeToolkitFolder } from "./toolkit-keys";

export const TOOLKIT_KINDS: readonly ToolkitKind[] = ["skill", "agent"];

export function isToolkitKind(value: unknown): value is ToolkitKind {
  return typeof value === "string" && (TOOLKIT_KINDS as readonly string[]).includes(value);
}

function normalizeSource(value: unknown): SkillSource | null {
  return value === "global" || value === "project" ? value : null;
}

export function serializeToolkitItem(row: ProjectToolkitItemRecord): ToolkitItem {
  return {
    id: row.id,
    projectId: row.projectId,
    kind: row.kind as ToolkitKind,
    name: row.name,
    source: normalizeSource(row.source),
    folder: row.folder ?? null,
    order: row.order,
    createdAt: row.createdAt,
  };
}

export function listToolkitItems(projectId: string): ProjectToolkitItemRecord[] {
  return db
    .select()
    .from(schema.projectToolkitItems)
    .where(eq(schema.projectToolkitItems.projectId, projectId))
    .orderBy(asc(schema.projectToolkitItems.order), asc(schema.projectToolkitItems.createdAt))
    .all();
}

/** Appends to the end of the list; pinning something already pinned is a no-op. */
export function pinToolkitItem(
  projectId: string,
  item: { kind: ToolkitKind; name: string; source?: unknown }
): void {
  const { maxOrder } = db
    .select({ maxOrder: sql<number>`coalesce(max(${schema.projectToolkitItems.order}), -1)` })
    .from(schema.projectToolkitItems)
    .where(eq(schema.projectToolkitItems.projectId, projectId))
    .get() ?? { maxOrder: -1 };

  db.insert(schema.projectToolkitItems)
    .values({
      id: uuidv4(),
      projectId,
      kind: item.kind,
      name: item.name,
      source: normalizeSource(item.source),
      order: maxOrder + 1,
      createdAt: new Date().toISOString(),
    })
    .onConflictDoNothing()
    .run();
}

function matchPin(projectId: string, kind: ToolkitKind, name: string) {
  return and(
    eq(schema.projectToolkitItems.projectId, projectId),
    eq(schema.projectToolkitItems.kind, kind),
    eq(schema.projectToolkitItems.name, name)
  );
}

/** Moves a pin into a folder, or back to the top level when `folder` is empty. */
export function setToolkitItemFolder(
  projectId: string,
  kind: ToolkitKind,
  name: string,
  folder: unknown
): void {
  db.update(schema.projectToolkitItems)
    .set({ folder: normalizeToolkitFolder(folder) })
    .where(matchPin(projectId, kind, name))
    .run();
}

/**
 * Renames a folder by rewriting every pin in it; an empty `to` dissolves the
 * folder and leaves its pins at the top level. Renaming onto an existing
 * folder merges the two.
 */
export function renameToolkitFolder(projectId: string, from: string, to: unknown): void {
  db.update(schema.projectToolkitItems)
    .set({ folder: normalizeToolkitFolder(to) })
    .where(
      and(
        eq(schema.projectToolkitItems.projectId, projectId),
        eq(schema.projectToolkitItems.folder, from)
      )
    )
    .run();
}

export function unpinToolkitItem(projectId: string, kind: ToolkitKind, name: string): void {
  db.delete(schema.projectToolkitItems).where(matchPin(projectId, kind, name)).run();
}
