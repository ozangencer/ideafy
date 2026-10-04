import { NextRequest, NextResponse } from "next/server";
import { asc } from "drizzle-orm";
import { db, schema, sqlite } from "@/lib/db";
import { createGroup, type CardGroupRow } from "@/lib/card-ops";
import { CardGroup } from "@/lib/types";
import { cardGroupErrorResponse } from "./error-response";

const toCardGroup = (
  row: typeof schema.cardGroups.$inferSelect | CardGroupRow
): CardGroup => ({
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

// The same createGroup the MCP's create_group calls: the code is normalised,
// a code already offered in the project is a 409, and an unpicked color gets
// the picker's default.
export async function POST(request: NextRequest) {
  const body = await request.json();

  try {
    const group = createGroup(sqlite(), {
      code: typeof body.code === "string" ? body.code : "",
      name: typeof body.name === "string" ? body.name : undefined,
      color: body.color,
      projectId: body.projectId || null,
    });
    return NextResponse.json(toCardGroup(group), { status: 201 });
  } catch (err) {
    return cardGroupErrorResponse(err, "Failed to create group");
  }
}
