import { execSync } from "child_process";
import { existsSync } from "fs";
import { join } from "path";

/**
 * Look up a binary from a list of candidate paths, falling back to `which`.
 */
export function findBinary(binaryName: string, candidatePaths: string[]): string {
  for (const p of candidatePaths) {
    if (existsSync(p)) return p;
  }

  try {
    const result = execSync(`which ${binaryName}`, { encoding: "utf-8" }).trim();
    if (result && existsSync(result)) return result;
  } catch {
    // which command failed
  }

  throw new Error(
    `${binaryName} CLI not found. Checked: ${candidatePaths.join(", ")}`
  );
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
  };
}
