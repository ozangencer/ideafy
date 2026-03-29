import { exec, execSync, spawn } from "child_process";
import { writeFileSync, unlinkSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { eq } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import type { TerminalApp } from "@/lib/types";

export interface LaunchTerminalOptions {
  command: string;
  terminal?: TerminalApp;
}

/**
 * Get the user's preferred terminal app from settings
 */
export function getTerminalPreference(): TerminalApp {
  const terminalSetting = db
    .select()
    .from(schema.settings)
    .where(eq(schema.settings.key, "terminal_app"))
    .get();

  return (terminalSetting?.value || "iterm2") as TerminalApp;
}

/**
 * Launch a command in the user's preferred terminal app.
 * Returns a message for Ghostty (clipboard-based) or null for AppleScript terminals.
 */
export function launchTerminal(opts: LaunchTerminalOptions): { success: true; message?: string } {
  const terminal = opts.terminal || getTerminalPreference();
  const { command } = opts;

  if (terminal === "ghostty") {
    // Ghostty doesn't support AppleScript — copy command to clipboard and open
    // Use spawn to avoid shell injection via command content
    const pbcopy = require("child_process").spawnSync("pbcopy", { input: command });
    exec("open -a Ghostty", (error) => {
      if (error) {
        console.error(`[Terminal Launcher] Error opening Ghostty: ${error.message}`);
      }
    });
    return {
      success: true,
      message: "Ghostty opened. Command copied to clipboard - press Cmd+V to paste.",
    };
  }

  // iTerm2 or Terminal.app — write command to temp script, launch via AppleScript
  const timestamp = Date.now();
  const scriptPath = join(tmpdir(), `ideafy-${timestamp}.sh`);
  writeFileSync(scriptPath, `#!/bin/bash\n${command}\n`, { mode: 0o755 });

  const appName = terminal === "iterm2" ? "iTerm" : "Terminal";

  const appleScript =
    terminal === "iterm2"
      ? `tell application "${appName}"
    create window with default profile
    tell current session of current window
        write text "${scriptPath}"
    end tell
end tell`
      : `tell application "${appName}"
    do script "${scriptPath}"
    activate
end tell`;

  const osascriptProcess = spawn("osascript", []);
  osascriptProcess.stdin.write(appleScript);
  osascriptProcess.stdin.end();
  osascriptProcess.on("error", (error) => {
    console.error(`[Terminal Launcher] Error: ${error.message}`);
    try {
      unlinkSync(scriptPath);
    } catch {}
  });

  return { success: true };
}
