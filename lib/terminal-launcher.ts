import { spawn } from "child_process";
import { writeFileSync, unlinkSync, mkdirSync } from "fs";
import { homedir, tmpdir } from "os";
import { basename, join } from "path";
import { eq } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { openCmuxTerminal } from "@/lib/terminal/cmux";
import type { TerminalApp } from "@/lib/types";

export interface LaunchTerminalOptions {
  cwd: string;
  argv: string[];
  env?: Record<string, string>;
  terminal?: TerminalApp;
  /** Optional log tag used in stderr messages. */
  tag?: string;
  /**
   * Extra context for terminals that can place a run rather than just spawn a
   * window. Only cmux reads this; the others ignore it.
   */
  session?: {
    /** Sidebar label for the tab. Agents overwrite it once they start. */
    title?: string;
    /** Project root, matched against cmux workspace directories. */
    projectFolder?: string | null;
    /** Lets the run look up the project's workspace preference and pin. */
    projectId?: string | null;
  };
}

/**
 * Assemble the placement/label context from whatever the route already has.
 * Every field is optional: a caller with no card still gets useful placement,
 * and terminals that cannot place a run ignore the whole thing.
 *
 * `displayId` is only an override. When it is omitted the code is derived from
 * the card and project the caller already handed over — the same rule as
 * getDisplayId in lib/types. A route that forgets the third argument would
 * otherwise open a terminal labelled with the bare card title, which is
 * exactly what happened to the interactive ideation launch: the tab said
 * "OpenAI API Desteği" with nothing saying which card that was.
 */
export function buildTerminalSession(
  card: { title?: string | null; taskNumber?: number | null } | null | undefined,
  project:
    | { id?: string; folderPath?: string | null; idPrefix?: string | null }
    | null
    | undefined,
  displayId?: string | null,
): LaunchTerminalOptions["session"] {
  const cardTitle = card?.title || null;
  const code =
    displayId ||
    (project?.idPrefix && card?.taskNumber
      ? `${project.idPrefix}-${card.taskNumber}`
      : null);
  return {
    title: code && cardTitle
      ? `${code} · ${cardTitle}`
      : code || cardTitle || undefined,
    projectFolder: project?.folderPath ?? null,
    projectId: project?.id ?? null,
  };
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

function logChildExit(child: ReturnType<typeof spawn>, appName: string, tag: string): void {
  let stderrBuf = "";
  child.stderr?.on("data", (d) => { stderrBuf += d.toString(); });
  child.on("error", (err) => {
    console.error(`[${tag}] ${appName} launch failed: ${err.message}`);
  });
  child.on("exit", (code) => {
    if (code !== 0) {
      console.error(
        `[${tag}] ${appName} launch exited with code ${code}: ${stderrBuf.trim()}`,
      );
    }
  });
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
    logChildExit(child, "Ghostty", tag);
    return { success: true };
  }

  if (terminal === "warp") {
    // Warp does not expose AppleScript hooks like iTerm/Terminal, and `open
    // -a Warp.app --args` does not surface any "run this command" CLI flag.
    // The documented programmatic entry point is the `warp://launch/<name>`
    // URI scheme, which loads a YAML launch configuration from
    // ~/.warp/launch_configurations/<name>.yaml and runs its `commands` on
    // start. This avoids the GUI-keystroke approach (which required
    // Accessibility permission, raced with Warp's autocomplete overlay, and
    // opened a second window from the initial `open -a` launch).
    // See: https://docs.warp.dev/terminal/more-features/uri-scheme
    //      https://docs.warp.dev/terminal/windows/launch-configurations
    const configDir = join(homedir(), ".warp", "launch_configurations");
    try {
      mkdirSync(configDir, { recursive: true });
    } catch (err) {
      throw new Error(
        `Could not prepare Warp launch_configurations dir at ${configDir}: ${(err as Error).message}`,
      );
    }

    const configName = `ideafy-${timestamp}-${random}`;
    const configPath = join(configDir, `${configName}.yaml`);

    // Single-quoted YAML scalar: a literal quote is escaped by doubling it.
    // We control every interpolated value, but quoting defends against paths
    // with colons or special chars that would otherwise break YAML parsing.
    const yamlQuote = (s: string) => `'${s.replace(/'/g, "''")}'`;
    const yaml =
      "---\n" +
      `name: ${configName}\n` +
      "windows:\n" +
      "  - tabs:\n" +
      "      - layout:\n" +
      `          cwd: ${yamlQuote(opts.cwd)}\n` +
      "          commands:\n" +
      `            - exec: ${yamlQuote(`/bin/bash ${shellQuote(scriptPath)}`)}\n`;
    writeFileSync(configPath, yaml, { mode: 0o600 });

    const child = spawn("open", [`warp://launch/${configName}`], {
      stdio: ["ignore", "pipe", "pipe"],
    });
    logChildExit(child, "Warp", tag);

    // Warp reads the config when handling the URI; the file can be removed
    // shortly after. 8s is conservative even on a cold app start.
    setTimeout(() => {
      try { unlinkSync(configPath); } catch {}
    }, 8000);

    return { success: true };
  }

  if (terminal === "cmux") {
    // A tab's title otherwise defaults to the command it runs, which would put
    // the generated /tmp script path in the sidebar. The cwd basename is the
    // branch name for worktree runs and the project folder otherwise — the
    // name the user would have picked themselves.
    const name = opts.session?.title || basename(opts.cwd) || tag;

    // Placement and the workspace pin are decided inside cmux (see
    // lib/terminal/cmux.ts): the bootstrap asks /api/cmux/resolve and writes
    // the pin back through the project API, because this process is not
    // allowed to read cmux's workspace list in the first place.
    void openCmuxTerminal({
      cwd: opts.cwd,
      scriptPath,
      name,
      projectId: opts.session?.projectId ?? null,
      projectFolder: opts.session?.projectFolder ?? null,
      tag,
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
