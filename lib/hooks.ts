import * as fs from "fs";
import * as path from "path";

// Note: This module's functions are also called by claude-provider via require().
// The exported functions remain the canonical hook implementation for Claude.

const KANBAN_HOOK = {
  hooks: {
    UserPromptSubmit: [
      {
        hooks: [
          {
            type: "command",
            command: `if [ -n "$KANBAN_CARD_ID" ]; then echo "\\n<system-reminder>\\nKanban Card: $KANBAN_CARD_ID\\nBefore finishing, update the card:\\n- After planning: save_plan (moves to In Progress)\\n- After implementation: save_tests (moves to Human Test)\\n- After idea discussion: save_opinion\\n</system-reminder>"; fi`,
          },
        ],
      },
    ],
  },
};

/**
 * Install kanban hook to a project's .claude/settings.json
 * Merges with existing settings if present
 */
export function installKanbanHook(folderPath: string): { success: boolean; error?: string } {
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

    // Check if kanban hook already exists (look inside nested hooks array)
    const hasKanbanHook = existingUserPromptSubmit.some((hookGroup: unknown) => {
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
          (hook as { command: string }).command.includes("KANBAN_CARD_ID")
      );
    });

    if (hasKanbanHook) {
      return { success: true }; // Already installed
    }

    // Add kanban hook
    const mergedSettings = {
      ...existingSettings,
      hooks: {
        ...existingHooks,
        UserPromptSubmit: [...existingUserPromptSubmit, ...KANBAN_HOOK.hooks.UserPromptSubmit],
      },
    };

    fs.writeFileSync(settingsPath, JSON.stringify(mergedSettings, null, 2));

    return { success: true };
  } catch (error) {
    console.error("Failed to install kanban hook:", error);
    return {
      success: false,
      error: error instanceof Error ? error.message : "Unknown error",
    };
  }
}

/**
 * Remove kanban hook from a project's .claude/settings.json
 */
export function removeKanbanHook(folderPath: string): { success: boolean; error?: string } {
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

    // Filter out kanban hook (look inside nested hooks array)
    settings.hooks.UserPromptSubmit = settings.hooks.UserPromptSubmit.filter(
      (hookGroup: unknown) => {
        if (typeof hookGroup !== "object" || hookGroup === null || !("hooks" in hookGroup)) {
          return true; // Keep non-standard entries
        }
        const innerHooks = (hookGroup as { hooks: unknown[] }).hooks;
        const hasKanbanHook = innerHooks.some(
          (hook: unknown) =>
            typeof hook === "object" &&
            hook !== null &&
            "command" in hook &&
            typeof (hook as { command: string }).command === "string" &&
            (hook as { command: string }).command.includes("KANBAN_CARD_ID")
        );
        return !hasKanbanHook;
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
    console.error("Failed to remove kanban hook:", error);
    return {
      success: false,
      error: error instanceof Error ? error.message : "Unknown error",
    };
  }
}
