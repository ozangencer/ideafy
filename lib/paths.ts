import path from "node:path";
import fs from "node:fs";
import os from "node:os";

// Packaged DMG: resources like skills/, mcp-server/, drizzle/ live under
// process.resourcesPath (set by Electron as IDEAFY_APP_RESOURCES before
// spawning the Next server). Dev: just repo root.
export function appResourcesRoot(): string {
  return (
    process.env.IDEAFY_APP_RESOURCES ??
    process.env.IDEAFY_ROOT ??
    process.cwd()
  );
}

// User-writable data dir. Default is the macOS Electron userData location so
// every consumer (Electron personal app, standalone Next.js dev, MCP server)
// converges on one kanban.db without per-user absolute paths. Override with
// IDEAFY_USER_DATA when a session needs to point at an alternate DB.
export function resolveUserDataDir(): string {
  const fromEnv = process.env.IDEAFY_USER_DATA;
  if (fromEnv) {
    fs.mkdirSync(fromEnv, { recursive: true });
    return fromEnv;
  }
  const defaultDir = path.join(
    os.homedir(),
    "Library",
    "Application Support",
    "ideafy"
  );
  fs.mkdirSync(defaultDir, { recursive: true });
  return defaultDir;
}

// Per-user writable skills dir. Packaged builds mirror the bundled skills/
// here on first boot so users can add/edit their own without touching the
// read-only Resources copy.
export function resolveUserSkillsDir(): string {
  if (process.env.IDEAFY_USER_DATA) {
    const dir = path.join(process.env.IDEAFY_USER_DATA, "skills");
    fs.mkdirSync(dir, { recursive: true });
    return dir;
  }
  // Dev: use the repo skills/ directly (no mirror needed).
  return path.join(appResourcesRoot(), "skills");
}
