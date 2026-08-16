import { NextRequest, NextResponse } from "next/server";
import { v4 as uuidv4 } from "uuid";
import { asc } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { CardGroup } from "@/lib/types";

const toCardGroup = (row: typeof schema.cardGroups.$inferSelect): CardGroup => ({
  id: row.id,
  projectId: row.projectId,
  code: row.code,
  name: row.name,
  color: row.color,
  createdAt: row.createdAt,
});

export async function GET() {
  const rows = db
    .select()
    .from(schema.cardGroups)
    .orderBy(asc(schema.cardGroups.code))
    .all();

  return NextResponse.json(rows.map(toCardGroup));
}

export async function POST(request: NextRequest) {
  const body = await request.json();

  const code = typeof body.code === "string" ? body.code.trim() : "";
  if (!code) {
    return NextResponse.json({ error: "Code is required" }, { status: 400 });
  }

  const group = {
    id: uuidv4(),
    projectId: body.projectId || null,
    code,
    // A group with no name reads as its code, which is what the backfill
    // writes too — the real name is filled in later.
    name: (typeof body.name === "string" && body.name.trim()) || code,
    color: body.color || null,
    createdAt: new Date().toISOString(),
  };

  try {
    db.insert(schema.cardGroups).values(group).run();
  } catch (err) {
    console.error("[card-groups] Failed to insert group:", err);
    return NextResponse.json({ error: "Failed to create group" }, { status: 500 });
  }

  return NextResponse.json(toCardGroup(group), { status: 201 });
}
