import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { existsSync } from "fs";
import { getActiveProvider } from "@/lib/platform/active";
import { launchTerminal, getTerminalPreference } from "@/lib/terminal-launcher";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  const project = db
    .select()
    .from(schema.projects)
    .where(eq(schema.projects.id, id))
    .get();

  if (!project) {
    return NextResponse.json({ error: "Project not found" }, { status: 404 });
  }

  // Validate folder exists
  if (!existsSync(project.folderPath)) {
    return NextResponse.json(
      { error: "Project folder does not exist on disk" },
      { status: 400 }
    );
  }

  const provider = getActiveProvider();

  // Check platform supports skills
  if (!provider.capabilities.supportsSkills) {
    return NextResponse.json(
      { error: `${provider.displayName} does not support interactive skills` },
      { status: 400 }
    );
  }

  // Ensure skills are installed
  provider.installIdeafySkills(project.folderPath);

  // Build the interactive command: cd to project folder and run /product-narrative skill
  // Pass the project's narrative path as argument so the skill writes to the correct location
  const narrativePath = project.narrativePath || "docs/product-narrative.md";
  const command = provider.buildInteractiveCommand(
    { prompt: `/product-narrative ${narrativePath}`, cardId: "", permissionMode: null },
    project.folderPath
  );

  const terminal = getTerminalPreference();

  console.log(`[Narrative Skill] Launching terminal for project: ${project.name}`);
  console.log(`[Narrative Skill] Terminal: ${terminal}`);
  console.log(`[Narrative Skill] Working dir: ${project.folderPath}`);

  const result = launchTerminal({ command, terminal });

  return NextResponse.json({
    success: true,
    terminal,
    workingDir: project.folderPath,
    message: result.message || "Terminal opened with /product-narrative skill.",
  });
}
