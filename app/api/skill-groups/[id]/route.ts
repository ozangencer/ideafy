import { NextRequest, NextResponse } from "next/server";
import {
  deleteSkillGroupRecord,
  renameSkillGroupRecord,
} from "@/lib/skills/group-persistence";

type RouteContext = {
  params: {
    id: string;
  };
};

export async function PATCH(request: NextRequest, { params }: RouteContext) {
  try {
    const body = await request.json();
    const success = renameSkillGroupRecord(params.id, body.name || "");

    if (!success) {
      return NextResponse.json({ error: "Unable to rename skill group" }, { status: 400 });
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Failed to rename skill group:", error);
    return NextResponse.json(
      { error: "Failed to rename skill group" },
      { status: 500 }
    );
  }
}

export async function DELETE(_request: NextRequest, { params }: RouteContext) {
  try {
    const success = deleteSkillGroupRecord(params.id);

    if (!success) {
      return NextResponse.json({ error: "Skill group not found" }, { status: 404 });
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Failed to delete skill group:", error);
    return NextResponse.json(
      { error: "Failed to delete skill group" },
      { status: 500 }
    );
  }
}
