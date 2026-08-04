import { execFileSync } from "child_process";
import { existsSync } from "fs";
import { join } from "path";

export class MissingDependencyError extends Error {
  readonly dependency: string;
  readonly binaryName: string;
  readonly installUrl?: string;
  readonly checkedPaths: string[];

  constructor(binaryName: string, checkedPaths: string[]) {
    const meta = FRIENDLY_DEPENDENCIES[binaryName] ?? {
      name: binaryName,
      url: undefined,
    };
    const urlPart = meta.url ? ` Install it from ${meta.url}.` : "";
    super(`${meta.name} is not installed or not on your PATH.${urlPart}`);
    this.name = "MissingDependencyError";
    this.dependency = meta.name;
    this.binaryName = binaryName;
    this.installUrl = meta.url;
    this.checkedPaths = checkedPaths;
  }
}

const FRIENDLY_DEPENDENCIES: Record<string, { name: string; url?: string }> = {
  npm: { name: "Node.js (npm)", url: "https://nodejs.org/" },
  git: { name: "Git", url: "https://git-scm.com/downloads" },
  claude: { name: "Claude Code CLI", url: "https://docs.anthropic.com/en/docs/claude-code" },
  gemini: { name: "Gemini CLI", url: "https://github.com/google-gemini/gemini-cli" },
  codex: { name: "Codex CLI", url: "https://github.com/openai/codex" },
  opencode: { name: "OpenCode CLI", url: "https://opencode.ai" },
  cmux: { name: "cmux", url: "https://cmux.com" },
};

export function isMissingDependencyError(err: unknown): err is MissingDependencyError {
  return err instanceof MissingDependencyError ||
    (err instanceof Error && err.name === "MissingDependencyError");
}

/**
 * Look up a binary from a list of candidate paths, falling back to `which`.
 */
export function findBinary(binaryName: string, candidatePaths: string[]): string {
  for (const p of candidatePaths) {
    if (existsSync(p)) return p;
  }

  try {
    // execFileSync avoids the shell entirely — protects against future callers
    // passing a binaryName with whitespace/metacharacters.
    const result = execFileSync("which", [binaryName], { encoding: "utf-8" }).trim();
    if (result && existsSync(result)) return result;
  } catch {
    // which command failed
  }

  throw new MissingDependencyError(binaryName, candidatePaths);
}

/**
 * Build an extended PATH environment that includes common binary locations.
 */
export function buildEnv(): NodeJS.ProcessEnv {
  const home = process.env.HOME || process.env.USERPROFILE || "";
  const user = process.env.USER || process.env.USERNAME || "";
  const existingPath = process.env.PATH || "";

  const additionalPaths = [
    join(home, ".local", "bin"),
    join(home, ".claude", "bin"),
    "/usr/local/bin",
    "/opt/homebrew/bin",
  ];

  const newPath = [...additionalPaths, existingPath].join(":");

  return {
    ...process.env,
    HOME: home,
    USER: user,
    PATH: newPath,
  };
}

/**
 * Build CI environment (non-interactive).
 */
export function buildCIEnv(): NodeJS.ProcessEnv {
  return {
    ...buildEnv(),
    CI: "true",
    // Headless runs routinely shell out to builds, test suites and long greps.
    // At the 120s default those get auto-backgrounded, and when one finishes it
    // re-invokes the model, whose follow-up remark then replaces the run's real
    // output (IDE-280 — a 16k plan lost to a one-line footnote). Raising the
    // ceiling below the 10 minute run timeout keeps that from firing at all.
    // Trade-off: a genuinely hung command now blocks for longer, so an operator
    // (or a test reproducing the original failure) can still override it.
    BASH_DEFAULT_TIMEOUT_MS: process.env.BASH_DEFAULT_TIMEOUT_MS || "240000",
  };
}
