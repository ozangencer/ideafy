import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { CardGroup } from "@/lib/types";

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const body = await request.json();

  const existing = db
    .select()
    .from(schema.cardGroups)
    .where(eq(schema.cardGroups.id, id))
    .get();

  if (!existing) {
    return NextResponse.json({ error: "Group not found" }, { status: 404 });
  }

  const nextCode = body.code !== undefined ? String(body.code).trim() : existing.code;
  const nextName = body.name !== undefined ? String(body.name).trim() : existing.name;
  if (!nextCode || !nextName) {
    return NextResponse.json(
      { error: "Code and name cannot be empty" },
      { status: 400 }
    );
  }

  const updated = {
    projectId: body.projectId !== undefined ? body.projectId : existing.projectId,
    code: nextCode,
    name: nextName,
    color: body.color !== undefined ? body.color : existing.color,
  };

  try {
    db.update(schema.cardGroups)
      .set(updated)
      .where(eq(schema.cardGroups.id, id))
      .run();
  } catch (err) {
    console.error("[card-groups] Failed to update group:", err);
    return NextResponse.json({ error: "Failed to update group" }, { status: 500 });
  }

  const result: CardGroup = {
    id: existing.id,
    projectId: updated.projectId,
    code: updated.code,
    name: updated.name,
    color: updated.color,
    createdAt: existing.createdAt,
  };

  return NextResponse.json(result);
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  const existing = db
    .select()
    .from(schema.cardGroups)
    .where(eq(schema.cardGroups.id, id))
    .get();

  if (!existing) {
    return NextResponse.json({ error: "Group not found" }, { status: 404 });
  }

  // Membership is a plain column, not a foreign key, so releasing the members
  // is our job — otherwise they keep pointing at a group that is gone and
  // silently stop rendering a group row without ever saying why.
  db.transaction((tx) => {
    tx.update(schema.cards)
      .set({ groupId: null })
      .where(eq(schema.cards.groupId, id))
      .run();
    tx.delete(schema.cardGroups).where(eq(schema.cardGroups.id, id)).run();
  });

  return NextResponse.json({ success: true });
}
