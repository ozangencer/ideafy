import { execSync } from "child_process";
import { existsSync } from "fs";
import { join } from "path";

// Cache the Claude CLI path
let cachedClaudePath: string | null = null;

/**
 * Find the Claude CLI executable path
 * Checks common installation locations and falls back to PATH lookup
 */
export function getClaudePath(): string {
  if (cachedClaudePath) {
    return cachedClaudePath;
  }

  const home = process.env.HOME || process.env.USERPROFILE || "";

  // Common installation paths to check
  const commonPaths = [
    join(home, ".local", "bin", "claude"),
    join(home, ".claude", "bin", "claude"),
    "/usr/local/bin/claude",
    "/usr/bin/claude",
    "/opt/homebrew/bin/claude",
  ];

  // Check common paths first
  for (const path of commonPaths) {
    if (existsSync(path)) {
      cachedClaudePath = path;
      return path;
    }
  }

  // Fall back to `which claude` lookup
  try {
    const result = execSync("which claude", { encoding: "utf-8" }).trim();
    if (result && existsSync(result)) {
      cachedClaudePath = result;
      return result;
    }
  } catch {
    // which command failed, continue to error
  }

  // If still not found, throw a helpful error
  throw new Error(
    "Claude CLI not found. Please install it: npm install -g @anthropic-ai/claude-code"
  );
}

/**
 * Get environment variables for spawning Claude CLI
 * Extends current process env with necessary paths
 */
export function getClaudeEnv(): NodeJS.ProcessEnv {
  const home = process.env.HOME || process.env.USERPROFILE || "";
  const user = process.env.USER || process.env.USERNAME || "";

  // Build PATH with common binary locations
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
 * Get environment variables for CI mode (non-interactive)
 */
export function getClaudeCIEnv(): NodeJS.ProcessEnv {
  return {
    ...getClaudeEnv(),
    CI: "true",
  };
}
