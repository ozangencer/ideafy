import { NextRequest, NextResponse } from "next/server";
import { v4 as uuidv4 } from "uuid";
import { db, schema } from "@/lib/db";
import {
  listProjectSections,
  normalizeSectionName,
  sectionNameTaken,
  serializeProjectSection,
} from "@/lib/project-sections";

export async function GET() {
  try {
    return NextResponse.json(listProjectSections().map(serializeProjectSection));
  } catch (error) {
    console.error("Failed to fetch project sections:", error);
    return NextResponse.json(
      { error: "Failed to fetch project sections" },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const name = normalizeSectionName(body.name);

    if (!name) {
      return NextResponse.json({ error: "Section name is required" }, { status: 400 });
    }
    if (sectionNameTaken(name)) {
      return NextResponse.json({ error: "A section with this name already exists" }, { status: 409 });
    }

    // New sections go to the bottom of the list.
    const sections = listProjectSections();
    const order = sections.length > 0 ? sections[sections.length - 1].order + 1 : 0;
    const now = new Date().toISOString();
    const section = {
      id: uuidv4(),
      name,
      order,
      collapsed: false,
      createdAt: now,
      updatedAt: now,
    };

    db.insert(schema.projectSections).values(section).run();

    return NextResponse.json(serializeProjectSection(section), { status: 201 });
  } catch (error) {
    console.error("Failed to create project section:", error);
    return NextResponse.json(
      { error: "Failed to create project section" },
      { status: 500 }
    );
  }
}
