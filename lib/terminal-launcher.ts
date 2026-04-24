import { spawn } from "child_process";
import { writeFileSync, unlinkSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { eq } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import type { TerminalApp } from "@/lib/types";

export interface LaunchTerminalOptions {
  cwd: string;
  argv: string[];
  env?: Record<string, string>;
  terminal?: TerminalApp;
  /** Optional log tag used in stderr messages. */
  tag?: string;
}

// POSIX shell single-quote: safe for any string (no null byte). Embedded
// single quotes are closed, escaped, and reopened — the classic 'foo'\''bar'.
function shellQuote(s: string): string {
  return `'${s.replace(/'/g, `'\\''`)}'`;
}

// Env var names are ASCII identifiers. Reject anything weird so a caller
// can't smuggle shell syntax through an env key.
function assertValidEnvName(name: string): void {
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) {
    throw new Error(`Invalid env var name: ${name}`);
  }
}

export function getTerminalPreference(): TerminalApp {
  const row = db
    .select()
    .from(schema.settings)
    .where(eq(schema.settings.key, "terminal_app"))
    .get();
  return (row?.value || "iterm2") as TerminalApp;
}

export function launchTerminal(opts: LaunchTerminalOptions): { success: true } {
  // macOS-only: iTerm/Terminal/Ghostty + osascript have no analogues on
  // Linux/Windows. Fail loudly rather than silently on a dev machine
  // building the app for macOS distribution.
  if (process.platform !== "darwin") {
    throw new Error("launchTerminal is only supported on macOS");
  }

  const terminal = opts.terminal || getTerminalPreference();
  const tag = opts.tag || "Terminal Launcher";

  const lines = ["#!/bin/bash", "set -e"];
  lines.push(`cd ${shellQuote(opts.cwd)}`);
  if (opts.env) {
    for (const [k, v] of Object.entries(opts.env)) {
      assertValidEnvName(k);
      lines.push(`export ${k}=${shellQuote(v)}`);
    }
  }
  if (opts.argv.length === 0) {
    throw new Error("argv must not be empty");
  }
  lines.push(`exec ${opts.argv.map(shellQuote).join(" ")}`);
  const scriptBody = lines.join("\n") + "\n";

  const timestamp = Date.now();
  const random = Math.random().toString(36).slice(2, 8);
  const scriptPath = join(tmpdir(), `ideafy-${timestamp}-${random}.sh`);
  // 0o700 — only the current user can read/execute. The script may contain
  // the prompt, which we treat as confidential.
  writeFileSync(scriptPath, scriptBody, { mode: 0o700 });

  if (terminal === "ghostty") {
    // Launch Ghostty via LaunchServices (`open -na`) so a proper GUI window is
    // created, but pass the script through Ghostty's config flag
    // `--command=<path>` instead of the shorthand `-e <path>`. The shorthand
    // stopped being honored when forwarded through `open --args` against an
    // already-running Ghostty instance, leaving the user in a plain login
    // shell. `--command=` is parsed during applicationDidFinishLaunching and
    // survives the round-trip reliably.
    const child = spawn(
      "open",
      ["-na", "Ghostty.app", "--args", `--command=${scriptPath}`],
      { stdio: ["ignore", "pipe", "pipe"] },
    );
    let stderrBuf = "";
    child.stderr?.on("data", (d) => { stderrBuf += d.toString(); });
    child.on("error", (err) => {
      console.error(`[${tag}] Ghostty launch failed: ${err.message}`);
    });
    child.on("exit", (code) => {
      if (code !== 0) {
        console.error(
          `[${tag}] Ghostty launch exited with code ${code}: ${stderrBuf.trim()}`,
        );
      }
    });
    return { success: true };
  }

  // scriptPath is under our control (tmpdir + timestamp/random), but guard
  // defensively: anything that would break the AppleScript string literal
  // is rejected rather than embedded.
  if (/[\r\n"\\]/.test(scriptPath)) {
    throw new Error(`Unsafe script path: ${scriptPath}`);
  }

  const quotedPath = `"${scriptPath}"`;
  const appleScript =
    terminal === "iterm2"
      ? `tell application "iTerm"
    create window with default profile
    tell current session of current window
        write text ${quotedPath}
    end tell
end tell`
      : `tell application "Terminal"
    do script ${quotedPath}
    activate
end tell`;

  const osascriptProcess = spawn("osascript", []);
  osascriptProcess.stdin.write(appleScript);
  osascriptProcess.stdin.end();
  osascriptProcess.on("error", (error) => {
    console.error(`[${tag}] osascript error: ${error.message}`);
    try {
      unlinkSync(scriptPath);
    } catch {}
  });

  return { success: true };
}
