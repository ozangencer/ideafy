import { asc } from "drizzle-orm";
import { db, schema } from "./db";
import type { ProjectSectionRecord } from "./db/schema";
import type { ProjectSection } from "./types";

export function normalizeSectionName(name: unknown): string {
  return typeof name === "string" ? name.trim().replace(/\s+/g, " ") : "";
}

export function serializeProjectSection(row: ProjectSectionRecord): ProjectSection {
  return {
    id: row.id,
    name: row.name,
    order: row.order,
    collapsed: row.collapsed,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export function listProjectSections(): ProjectSectionRecord[] {
  return db
    .select()
    .from(schema.projectSections)
    .orderBy(asc(schema.projectSections.order), asc(schema.projectSections.createdAt))
    .all();
}

/** Case-insensitive, like skill groups: "Business" and "business" are one section. */
export function sectionNameTaken(name: string, exceptId?: string): boolean {
  const lower = name.toLocaleLowerCase();
  return listProjectSections().some(
    (section) => section.id !== exceptId && section.name.toLocaleLowerCase() === lower
  );
}
