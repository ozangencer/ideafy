import { NextRequest, NextResponse } from "next/server";
import { sqlite } from "@/lib/db";
import { deleteGroup, updateGroup } from "@/lib/card-ops";
import { CardGroup } from "@/lib/types";
import { cardGroupErrorResponse } from "../error-response";

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const body = await request.json();

  try {
    const group = updateGroup(sqlite(), id, {
      code: body.code,
      name: body.name,
      color: body.color,
      projectId: body.projectId,
    });
    const result: CardGroup = {
      id: group.id,
      projectId: group.projectId,
      code: group.code,
      name: group.name,
      color: group.color,
      createdAt: group.createdAt,
    };
    return NextResponse.json(result);
  } catch (err) {
    return cardGroupErrorResponse(err, "Failed to update group");
  }
}

// The members are released, not deleted — the same deleteGroup the MCP's
// delete_group calls, in one transaction.
export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  try {
    const { releasedCards } = deleteGroup(sqlite(), id);
    return NextResponse.json({ success: true, releasedCards });
  } catch (err) {
    return cardGroupErrorResponse(err, "Failed to delete group");
  }
}
