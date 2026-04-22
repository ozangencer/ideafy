import { NextRequest, NextResponse } from "next/server";
import {
  assignSkillToGroupRecord,
  createSkillGroupRecord,
  listSkillGroups,
} from "@/lib/skills/group-persistence";

export async function GET() {
  try {
    return NextResponse.json(listSkillGroups());
  } catch (error) {
    console.error("Failed to fetch skill groups:", error);
    return NextResponse.json(
      {
        globalGroups: [],
        projectGroups: {},
        error: "Failed to fetch skill groups",
      },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const created = createSkillGroupRecord(body.name || "", body.source, body.projectId);

    if (!created) {
      return NextResponse.json({ error: "Invalid skill group payload" }, { status: 400 });
    }

    return NextResponse.json(created, { status: created.created ? 201 : 200 });
  } catch (error) {
    console.error("Failed to create skill group:", error);
    return NextResponse.json(
      { error: "Failed to create skill group" },
      { status: 500 }
    );
  }
}

export async function PUT(request: NextRequest) {
  try {
    const body = await request.json();
    const success = assignSkillToGroupRecord(
      body.skillName || "",
      body.groupId ?? null,
      body.source,
      body.projectId
    );

    if (!success) {
      return NextResponse.json({ error: "Invalid skill move payload" }, { status: 400 });
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Failed to move skill to group:", error);
    return NextResponse.json(
      { error: "Failed to move skill to group" },
      { status: 500 }
    );
  }
}
