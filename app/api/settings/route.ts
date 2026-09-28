import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { settings } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { homedir } from "os";
import { join } from "path";
import { PROJECT_MODES, type AppSettings, type AiPlatform, type TerminalApp } from "@/lib/types";
import { normalizeProjectMode } from "@/lib/project-serialize";
import { getPlatformProvider } from "@/lib/platform";

// Reads the settings rows at request time; the catch below would otherwise
// swallow the build-phase DB bailout and freeze DEFAULT_SETTINGS into the
// bundle.
export const dynamic = "force-dynamic";

// Expand ~ to home directory
function expandPath(path: string): string {
  if (path.startsWith("~")) {
    return join(homedir(), path.slice(1));
  }
  return path;
}

// Contract home directory to ~
function contractPath(path: string): string {
  const home = homedir();
  if (path.startsWith(home)) {
    return "~" + path.slice(home.length);
  }
  return path;
}

const DEFAULT_SETTINGS: AppSettings = {
  aiPlatform: "claude",
  skillsPath: "~/.claude/skills",
  mcpConfigPath: "~/.claude.json",
  terminalApp: "iterm2",
  detectedTerminal: null,
  systemNotifications: true,
  activeWorkspace: "development",
  showPluginItems: false,
};

// Detect terminal from TERM_PROGRAM env variable
function detectTerminal(): TerminalApp | null {
  // cmux embeds Ghostty and reports TERM_PROGRAM=ghostty, so TERM_PROGRAM alone
  // would misdetect it. Its own markers have to be checked first.
  if (process.env.CMUX_BUNDLE_ID || process.env.CMUX_WORKSPACE_ID) return "cmux";

  const termProgram = process.env.TERM_PROGRAM?.toLowerCase();
  if (!termProgram) return null;

  if (termProgram === "ghostty") return "ghostty";
  if (termProgram === "iterm.app") return "iterm2";
  if (termProgram === "apple_terminal") return "terminal";
  if (termProgram.includes("warp")) return "warp";

  return null;
}

// GET /api/settings - Returns all settings
export async function GET() {
  try {
    const rows = db.select().from(settings).all();

    // Convert rows to settings object
    const result: AppSettings = { ...DEFAULT_SETTINGS };

    for (const row of rows) {
      if (row.key === "ai_platform") result.aiPlatform = row.value as AiPlatform;
      if (row.key === "skills_path") result.skillsPath = row.value;
      if (row.key === "mcp_config_path") result.mcpConfigPath = row.value;
      if (row.key === "terminal_app") result.terminalApp = row.value as TerminalApp;
      if (row.key === "system_notifications") result.systemNotifications = row.value !== "false";
      if (row.key === "active_workspace") result.activeWorkspace = normalizeProjectMode(row.value);
      if (row.key === "show_plugin_items") result.showPluginItems = row.value === "true";
    }

    // Add detected terminal from environment
    result.detectedTerminal = detectTerminal();

    // Include platform capabilities in the response
    const provider = getPlatformProvider(result.aiPlatform);
    return NextResponse.json({ ...result, platformCapabilities: provider.capabilities });
  } catch (error) {
    console.error("Failed to fetch settings:", error);
    return NextResponse.json({ ...DEFAULT_SETTINGS, detectedTerminal: detectTerminal() });
  }
}

// PUT /api/settings - Updates settings
export async function PUT(request: Request) {
  try {
    const body = await request.json();
    const now = new Date().toISOString();

    // Map of incoming field names to database keys
    const keyMap: Record<string, string> = {
      aiPlatform: "ai_platform",
      skillsPath: "skills_path",
      mcpConfigPath: "mcp_config_path",
      terminalApp: "terminal_app",
      systemNotifications: "system_notifications",
      activeWorkspace: "active_workspace",
      showPluginItems: "show_plugin_items",
    };

    for (const [field, rawValue] of Object.entries(body)) {
      const dbKey = keyMap[field];
      // Booleans ride in the same key/value table as strings.
      const value = typeof rawValue === "boolean" ? String(rawValue) : rawValue;
      // Anything but a known mode would leave both windows on a workspace
      // that lists no projects.
      if (
        dbKey === "active_workspace" &&
        !(PROJECT_MODES as readonly unknown[]).includes(value)
      ) {
        continue;
      }
      if (dbKey && typeof value === "string") {
        // Check if setting exists
        const existing = db
          .select()
          .from(settings)
          .where(eq(settings.key, dbKey))
          .get();

        if (existing) {
          // Update existing
          db.update(settings)
            .set({ value, updatedAt: now })
            .where(eq(settings.key, dbKey))
            .run();
        } else {
          // Insert new
          db.insert(settings)
            .values({ key: dbKey, value, updatedAt: now })
            .run();
        }
      }
    }

    // Return updated settings
    return GET();
  } catch (error) {
    console.error("Failed to update settings:", error);
    return NextResponse.json(
      { error: "Failed to update settings" },
      { status: 500 }
    );
  }
}
