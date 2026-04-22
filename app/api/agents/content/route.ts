import { NextRequest, NextResponse } from "next/server";
import { join } from "path";
import { homedir } from "os";
import fs from "node:fs";
import { eq } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { settings } from "@/lib/db/schema";
import { getActiveProvider } from "@/lib/platform/active";
import { listGlobalAgentItems, listProjectAgentItems } from "@/lib/agents/catalog";
import { parseAgentDocument } from "@/lib/agents/preview";

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
      .where(eq(settings.key, "agents_path"))
      .get();

    const globalAgentsPath = expandPath(
      setting?.value || provider.getDefaultAgentsPath()
    );

    const globalItems = listGlobalAgentItems(globalAgentsPath);
    const projects = db.select().from(schema.projects).all();
    const projectItems = projects.flatMap((project) =>
      listProjectAgentItems(project.folderPath, provider.id)
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

    const rawContent = fs.readFileSync(allowedItem.path, "utf-8");
    const parsed = parseAgentDocument(rawContent, allowedItem.name, allowedItem.format);

    return NextResponse.json({
      rawContent: parsed.rawContent,
      bodyContent: parsed.bodyContent,
      frontmatter: parsed.frontmatter,
      path: allowedItem.path,
      name: allowedItem.name,
      title: parsed.displayTitle,
      description: parsed.description ?? allowedItem.description,
      source: allowedItem.source,
      format: allowedItem.format,
      firstHeading: parsed.firstHeading,
    });
  } catch (error) {
    console.error("Failed to read agent:", error);
    return NextResponse.json(
      { error: "Failed to read agent" },
      { status: 500 }
    );
  }
}
