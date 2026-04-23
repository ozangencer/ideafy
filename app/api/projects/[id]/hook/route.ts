import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { installIdeafyHook, removeIdeafyHook } from "@/lib/hooks";
import { getActiveProvider } from "@/lib/platform/active";
import * as fs from "fs";
import * as path from "path";

// Hook-less platforms (Codex, Gemini today) treat the hook as always
// satisfied: no file is written, no file is read. installed:true keeps the
// frontend AND-check on mcp/skills alone.
const HOOK_NOT_APPLICABLE = { installed: true, applicable: false } as const;

// Check if hook is installed
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;

    const project = db
      .select()
      .from(schema.projects)
      .where(eq(schema.projects.id, id))
      .get();

    if (!project) {
      return NextResponse.json({ error: "Project not found" }, { status: 404 });
    }

    if (!project.folderPath) {
      return NextResponse.json({ installed: false, reason: "no_folder" });
    }

    if (!getActiveProvider().capabilities.supportsHooks) {
      return NextResponse.json(HOOK_NOT_APPLICABLE);
    }

    const settingsPath = path.join(project.folderPath, ".claude", "settings.json");

    if (!fs.existsSync(settingsPath)) {
      return NextResponse.json({ installed: false, reason: "no_settings" });
    }

    try {
      const content = fs.readFileSync(settingsPath, "utf-8");
      const settings = JSON.parse(content);

      // Check UserPromptSubmit hooks for ideafy hook (nested hooks structure)
      const hasHook = settings.hooks?.UserPromptSubmit?.some(
        (hookGroup: unknown) => {
          if (typeof hookGroup !== "object" || hookGroup === null || !("hooks" in hookGroup)) {
            return false;
          }
          const innerHooks = (hookGroup as { hooks: unknown[] }).hooks;
          return innerHooks.some(
            (hook: unknown) =>
              typeof hook === "object" &&
              hook !== null &&
              "command" in hook &&
              typeof (hook as { command: string }).command === "string" &&
              (hook as { command: string }).command.includes("IDEAFY_CARD_ID")
          );
        }
      );

      return NextResponse.json({ installed: !!hasHook });
    } catch {
      return NextResponse.json({ installed: false, reason: "parse_error" });
    }
  } catch (error) {
    console.error("Failed to check hook status:", error);
    return NextResponse.json(
      { error: "Failed to check hook status" },
      { status: 500 }
    );
  }
}

// Install hook
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;

    const project = db
      .select()
      .from(schema.projects)
      .where(eq(schema.projects.id, id))
      .get();

    if (!project) {
      return NextResponse.json({ error: "Project not found" }, { status: 404 });
    }

    if (!project.folderPath) {
      return NextResponse.json(
        { error: "Project has no folder path" },
        { status: 400 }
      );
    }

    if (!getActiveProvider().capabilities.supportsHooks) {
      return NextResponse.json({ success: true, ...HOOK_NOT_APPLICABLE });
    }

    const result = installIdeafyHook(project.folderPath);

    if (result.success) {
      return NextResponse.json({ success: true, installed: true });
    } else {
      return NextResponse.json(
        { error: result.error || "Failed to install hook" },
        { status: 500 }
      );
    }
  } catch (error) {
    console.error("Failed to install hook:", error);
    return NextResponse.json(
      { error: "Failed to install hook" },
      { status: 500 }
    );
  }
}

// Remove hook
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;

    const project = db
      .select()
      .from(schema.projects)
      .where(eq(schema.projects.id, id))
      .get();

    if (!project) {
      return NextResponse.json({ error: "Project not found" }, { status: 404 });
    }

    if (!project.folderPath) {
      return NextResponse.json(
        { error: "Project has no folder path" },
        { status: 400 }
      );
    }

    if (!getActiveProvider().capabilities.supportsHooks) {
      return NextResponse.json({ success: true, ...HOOK_NOT_APPLICABLE });
    }

    const result = removeIdeafyHook(project.folderPath);

    if (result.success) {
      return NextResponse.json({ success: true, installed: false });
    } else {
      return NextResponse.json(
        { error: result.error || "Failed to remove hook" },
        { status: 500 }
      );
    }
  } catch (error) {
    console.error("Failed to remove hook:", error);
    return NextResponse.json(
      { error: "Failed to remove hook" },
      { status: 500 }
    );
  }
}
