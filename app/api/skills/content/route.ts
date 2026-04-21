import { NextRequest, NextResponse } from "next/server";
import { join } from "path";
import { homedir } from "os";
import fs from "node:fs";
import { eq } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { settings } from "@/lib/db/schema";
import { getActiveProvider } from "@/lib/platform/active";
import { listGlobalSkillItems, listProjectSkillItems } from "@/lib/skills/catalog";

function expandPath(filePath: string): string {
  if (filePath.startsWith("~")) {
    return join(homedir(), filePath.slice(1));
  }
  return filePath;
}

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const requestedPath = searchParams.get("path");

    if (!requestedPath) {
      return NextResponse.json({ error: "Path required" }, { status: 400 });
    }

    const provider = getActiveProvider();
    const setting = db
      .select()
      .from(settings)
      .where(eq(settings.key, "skills_path"))
      .get();

    const globalSkillsPath = expandPath(
      setting?.value || provider.getDefaultSkillsPath()
    );

    const globalItems = listGlobalSkillItems(globalSkillsPath);
    const projects = db.select().from(schema.projects).all();
    const projectItems = projects.flatMap((project) =>
      listProjectSkillItems(project.folderPath, provider.id)
    );

    const allowedItem = [...globalItems, ...projectItems].find(
      (item) => item.path === requestedPath
    );

    if (!allowedItem) {
      return NextResponse.json({ error: "Access denied" }, { status: 403 });
    }

    if (!fs.existsSync(allowedItem.path)) {
      return NextResponse.json({ error: "File not found" }, { status: 404 });
    }

    const content = fs.readFileSync(allowedItem.path, "utf-8");

    return NextResponse.json({
      content,
      path: allowedItem.path,
      name: allowedItem.name,
      title: allowedItem.title,
      group: allowedItem.group,
      description: allowedItem.description,
      source: allowedItem.source,
    });
  } catch (error) {
    console.error("Failed to read skill:", error);
    return NextResponse.json(
      { error: "Failed to read skill" },
      { status: 500 }
    );
  }
}
