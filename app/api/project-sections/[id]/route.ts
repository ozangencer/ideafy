import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import {
  listProjectSections,
  normalizeSectionName,
  sectionNameTaken,
  serializeProjectSection,
} from "@/lib/project-sections";

type RouteContext = { params: Promise<{ id: string }> };

// PATCH accepts any of: { name }, { collapsed }, { move: "up" | "down" }.
export async function PATCH(request: NextRequest, { params }: RouteContext) {
  try {
    const { id } = await params;
    const body = await request.json();

    const existing = db
      .select()
      .from(schema.projectSections)
      .where(eq(schema.projectSections.id, id))
      .get();

    if (!existing) {
      return NextResponse.json({ error: "Section not found" }, { status: 404 });
    }

    const now = new Date().toISOString();
    const updates: Partial<typeof existing> = {};

    if (body.name !== undefined) {
      const name = normalizeSectionName(body.name);
      if (!name) {
        return NextResponse.json({ error: "Section name is required" }, { status: 400 });
      }
      if (sectionNameTaken(name, id)) {
        return NextResponse.json({ error: "A section with this name already exists" }, { status: 409 });
      }
      updates.name = name;
    }

    if (typeof body.collapsed === "boolean") {
      updates.collapsed = body.collapsed;
    }

    if (Object.keys(updates).length > 0) {
      db.update(schema.projectSections)
        .set({ ...updates, updatedAt: now })
        .where(eq(schema.projectSections.id, id))
        .run();
    }

    if (body.move === "up" || body.move === "down") {
      // Swap order with the neighbour. The list is re-numbered as part of the
      // swap so two sections that ended up sharing an order value still move.
      const sections = listProjectSections();
      const index = sections.findIndex((section) => section.id === id);
      const target = body.move === "up" ? index - 1 : index + 1;
      if (index !== -1 && target >= 0 && target < sections.length) {
        const reordered = [...sections];
        [reordered[index], reordered[target]] = [reordered[target], reordered[index]];
        db.transaction((tx) => {
          reordered.forEach((section, order) => {
            if (section.order === order) return;
            tx.update(schema.projectSections)
              .set({ order, updatedAt: now })
              .where(eq(schema.projectSections.id, section.id))
              .run();
          });
        });
      }
    }

    return NextResponse.json(listProjectSections().map(serializeProjectSection));
  } catch (error) {
    console.error("Failed to update project section:", error);
    return NextResponse.json(
      { error: "Failed to update project section" },
      { status: 500 }
    );
  }
}

// Deleting a section never deletes projects: they fall back to "Other".
export async function DELETE(_request: NextRequest, { params }: RouteContext) {
  try {
    const { id } = await params;

    const existing = db
      .select({ id: schema.projectSections.id })
      .from(schema.projectSections)
      .where(eq(schema.projectSections.id, id))
      .get();

    if (!existing) {
      return NextResponse.json({ error: "Section not found" }, { status: 404 });
    }

    // The FK added by ALTER TABLE carries no ON DELETE action in SQLite, so
    // the projects are released by hand in the same transaction.
    db.transaction((tx) => {
      tx.update(schema.projects)
        .set({ sectionId: null })
        .where(eq(schema.projects.sectionId, id))
        .run();
      tx.delete(schema.projectSections)
        .where(eq(schema.projectSections.id, id))
        .run();
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Failed to delete project section:", error);
    return NextResponse.json(
      { error: "Failed to delete project section" },
      { status: 500 }
    );
  }
}
