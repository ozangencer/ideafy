import { spawn } from "child_process";
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
 */
export function launchTerminal(opts: LaunchTerminalOptions): { success: true; message?: string } {
  const terminal = opts.terminal || getTerminalPreference();
  const { command } = opts;

  const timestamp = Date.now();
  const scriptPath = join(tmpdir(), `ideafy-${timestamp}.sh`);
  writeFileSync(scriptPath, `#!/bin/bash\n${command}\n`, { mode: 0o755 });

  if (terminal === "ghostty") {
    // Ghostty: open new instance with -e flag to run the script
    spawn("open", ["-na", "Ghostty.app", "--args", "-e", scriptPath]);
    return { success: true };
  }

  // iTerm2 or Terminal.app — launch via AppleScript
  const appleScript =
    terminal === "iterm2"
      ? `tell application "iTerm"
    create window with default profile
    tell current session of current window
        write text "${scriptPath}"
    end tell
end tell`
      : `tell application "Terminal"
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
