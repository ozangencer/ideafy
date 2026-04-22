import path from "node:path";
import fs from "node:fs";

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

// User-writable data dir. Packaged DMG: app.getPath("userData") → exported
// via IDEAFY_USER_DATA from electron/main.js. Dev: falls back to repo/data/
// so `npm run dev` keeps reading the same kanban.db a developer has been
// iterating against.
export function resolveUserDataDir(): string {
  const fromEnv = process.env.IDEAFY_USER_DATA;
  if (fromEnv) {
    fs.mkdirSync(fromEnv, { recursive: true });
    return fromEnv;
  }
  const devDir = path.join(process.cwd(), "data");
  fs.mkdirSync(devDir, { recursive: true });
  return devDir;
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
