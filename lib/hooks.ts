import * as fs from "fs";
import * as path from "path";

// Note: This module's functions are also called by claude-provider via require().
// The exported functions remain the canonical hook implementation for Claude.

// Dedup anchor kept stable across hook revisions. installIdeafyHook and
// removeIdeafyHook look for this marker (and the legacy IDEAFY_CARD_ID /
// KANBAN_CARD_ID substrings) to identify prior Ideafy hook entries.
const IDEAFY_HOOK_MARKER = "# ideafy-hook";

const IDEAFY_HOOK = {
  hooks: {
    UserPromptSubmit: [
      {
        hooks: [
          {
            type: "command",
            command: `${IDEAFY_HOOK_MARKER}\ncurl -sf -X POST -H "Content-Type: application/json" --data-binary @- "http://localhost:\${IDEAFY_PORT:-3030}/api/hook-context?card_hint=\${IDEAFY_CARD_ID:-}" 2>/dev/null`,
          },
        ],
      },
    ],
  },
};

function isIdeafyHookCommand(cmd: string): boolean {
  return (
    cmd.includes("# ideafy-hook") ||
    cmd.includes("IDEAFY_CARD_ID") ||
    cmd.includes("KANBAN_CARD_ID")
  );
}

/**
 * Install ideafy hook to a project's .claude/settings.json
 * Merges with existing settings if present
 */
export function installIdeafyHook(folderPath: string): { success: boolean; error?: string } {
  try {
    const claudeDir = path.join(folderPath, ".claude");
    const settingsPath = path.join(claudeDir, "settings.json");

    // Create .claude directory if it doesn't exist
    if (!fs.existsSync(claudeDir)) {
      fs.mkdirSync(claudeDir, { recursive: true });
    }

    let existingSettings: Record<string, unknown> = {};

    // Read existing settings if present
    if (fs.existsSync(settingsPath)) {
      try {
        const content = fs.readFileSync(settingsPath, "utf-8");
        existingSettings = JSON.parse(content);
      } catch {
        // If parse fails, start fresh
        existingSettings = {};
      }
    }

    // Merge hooks
    const existingHooks = (existingSettings.hooks as Record<string, unknown[]>) || {};
    const existingUserPromptSubmit = existingHooks.UserPromptSubmit || [];

    // Strip any previous Ideafy hook entries so reinstall always writes the
    // current canonical body. Matches the current "# ideafy-hook" marker,
    // plus legacy IDEAFY_CARD_ID / KANBAN_CARD_ID substrings from older
    // hook revisions.
    const filteredUserPromptSubmit = existingUserPromptSubmit.filter((hookGroup: unknown) => {
      if (typeof hookGroup !== "object" || hookGroup === null || !("hooks" in hookGroup)) {
        return true;
      }
      const innerHooks = (hookGroup as { hooks: unknown[] }).hooks;
      const containsIdeafyHook = innerHooks.some((hook: unknown) => {
        if (
          typeof hook !== "object" ||
          hook === null ||
          !("command" in hook) ||
          typeof (hook as { command: string }).command !== "string"
        ) {
          return false;
        }
        return isIdeafyHookCommand((hook as { command: string }).command);
      });
      return !containsIdeafyHook;
    });

    const mergedSettings = {
      ...existingSettings,
      hooks: {
        ...existingHooks,
        UserPromptSubmit: [...filteredUserPromptSubmit, ...IDEAFY_HOOK.hooks.UserPromptSubmit],
      },
    };

    fs.writeFileSync(settingsPath, JSON.stringify(mergedSettings, null, 2));

    return { success: true };
  } catch (error) {
    console.error("Failed to install ideafy hook:", error);
    return {
      success: false,
      error: error instanceof Error ? error.message : "Unknown error",
    };
  }
}

/**
 * Remove ideafy hook from a project's .claude/settings.json
 */
export function removeIdeafyHook(folderPath: string): { success: boolean; error?: string } {
  try {
    const settingsPath = path.join(folderPath, ".claude", "settings.json");

    if (!fs.existsSync(settingsPath)) {
      return { success: true }; // Nothing to remove
    }

    const content = fs.readFileSync(settingsPath, "utf-8");
    const settings = JSON.parse(content);

    if (!settings.hooks?.UserPromptSubmit) {
      return { success: true }; // No hooks to remove
    }

    // Filter out any ideafy hook — current marker or legacy anchors.
    settings.hooks.UserPromptSubmit = settings.hooks.UserPromptSubmit.filter(
      (hookGroup: unknown) => {
        if (typeof hookGroup !== "object" || hookGroup === null || !("hooks" in hookGroup)) {
          return true;
        }
        const innerHooks = (hookGroup as { hooks: unknown[] }).hooks;
        const hasIdeafyHook = innerHooks.some((hook: unknown) => {
          if (
            typeof hook !== "object" ||
            hook === null ||
            !("command" in hook) ||
            typeof (hook as { command: string }).command !== "string"
          ) {
            return false;
          }
          return isIdeafyHookCommand((hook as { command: string }).command);
        });
        return !hasIdeafyHook;
      }
    );

    // Clean up empty arrays
    if (settings.hooks.UserPromptSubmit.length === 0) {
      delete settings.hooks.UserPromptSubmit;
    }
    if (Object.keys(settings.hooks).length === 0) {
      delete settings.hooks;
    }

    // Write back or delete file if empty
    if (Object.keys(settings).length === 0) {
      fs.unlinkSync(settingsPath);
    } else {
      fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2));
    }

    return { success: true };
  } catch (error) {
    console.error("Failed to remove ideafy hook:", error);
    return {
      success: false,
      error: error instanceof Error ? error.message : "Unknown error",
    };
  }
}
