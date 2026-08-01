import * as fs from "fs";
import * as path from "path";
import { RunMode, RUN_MODES } from "./types";

/**
 * What the run button actually does for a given project.
 *
 * Ideafy used to assume every project answered `npm run dev` on an HTTP port.
 * That holds for Next/Vite web apps and silently lies everywhere else: an
 * Electron project starts but has no port to open, and an Xcode project has
 * no package.json at all so npm exits immediately. A run target names the
 * shape of "run this" per project instead.
 */
export interface RunTarget {
  mode: RunMode;
  /** argv for the child process. Empty for modes handled natively (xcode/none). */
  command: string | null;
  /** Whether a port is allocated and substituted into the command/URL. */
  needsPort: boolean;
  /** URL to open once the process is up, with {port} substituted. Server mode only. */
  previewUrl: string | null;
  /**
   * One-shot targets hand off to another app and leave no process for us to
   * supervise — there is nothing to stop, and no PID worth storing.
   */
  oneShot: boolean;
}

/** Dependencies that mean "this project serves HTTP in development". */
const SERVER_FRAMEWORKS = [
  "next",
  "vite",
  "nuxt",
  "astro",
  "gatsby",
  "react-scripts",
  "@remix-run/dev",
  "@sveltejs/kit",
  "@angular/cli",
  "@nestjs/core",
  "express",
  "fastify",
];

function readdirSafe(dir: string): string[] {
  try {
    return fs.readdirSync(dir);
  } catch {
    return [];
  }
}

function readPackageJson(
  projectPath: string
): { scripts: Record<string, string>; deps: Set<string> } | null {
  const pkgPath = path.join(projectPath, "package.json");
  if (!fs.existsSync(pkgPath)) return null;
  try {
    const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf-8")) as {
      scripts?: Record<string, string>;
      dependencies?: Record<string, string>;
      devDependencies?: Record<string, string>;
    };
    return {
      scripts: pkg.scripts ?? {},
      deps: new Set([
        ...Object.keys(pkg.dependencies ?? {}),
        ...Object.keys(pkg.devDependencies ?? {}),
      ]),
    };
  } catch {
    return null;
  }
}

/**
 * Infer how a project wants to be run from what is on disk.
 *
 * Order matters. Ideafy itself has both `next` and `electron` in its
 * devDependencies — the web framework wins, because `npm run dev` is what
 * actually boots it. A project with only `electron` is a desktop app.
 */
export function detectRunMode(projectPath: string): RunMode {
  if (!projectPath || !fs.existsSync(projectPath)) return "none";

  const entries = readdirSafe(projectPath);
  const pkg = readPackageJson(projectPath);

  const hasXcodeProject = entries.some(
    (name) => name.endsWith(".xcodeproj") || name.endsWith(".xcworkspace")
  );
  // `project.yml` is XcodeGen's manifest, but the name is generic enough that
  // a Node repo could own one — only trust it when there is no package.json.
  const hasSwiftManifest =
    entries.includes("Package.swift") || (entries.includes("project.yml") && !pkg);

  if (hasXcodeProject || hasSwiftManifest) return "xcode";

  if (pkg) {
    if (SERVER_FRAMEWORKS.some((dep) => pkg.deps.has(dep))) return "server";
    if (pkg.deps.has("electron")) return "app";
    if (pkg.scripts.dev) return "server";
    if (pkg.scripts.start) return "app";
  }

  return "none";
}

const DEFAULT_COMMANDS: Record<RunMode, string | null> = {
  server: "npm run dev -- -p {port}",
  app: "npm run dev",
  xcode: null,
  none: null,
};

export const DEFAULT_PREVIEW_URL = "http://localhost:{port}";

function isRunMode(value: unknown): value is RunMode {
  return typeof value === "string" && (RUN_MODES as readonly string[]).includes(value);
}

/** Resolve the stored override (or auto-detection) into a concrete run target. */
export function resolveRunTarget(input: {
  projectPath: string;
  runMode?: string | null;
  runCommand?: string | null;
  previewUrl?: string | null;
}): RunTarget {
  const mode = isRunMode(input.runMode)
    ? input.runMode
    : detectRunMode(input.projectPath);

  if (mode === "none") {
    return { mode, command: null, needsPort: false, previewUrl: null, oneShot: false };
  }

  if (mode === "xcode") {
    // Opening Xcode is handled natively (generate project, then `open`), but a
    // custom command still wins — some projects drive a script instead.
    const command = input.runCommand?.trim() || null;
    return { mode, command, needsPort: false, previewUrl: null, oneShot: true };
  }

  const command = input.runCommand?.trim() || DEFAULT_COMMANDS[mode]!;
  const isServer = mode === "server";

  return {
    mode,
    command,
    // A custom app-mode command may still want a port; honour the placeholder
    // wherever it appears rather than tying ports to server mode alone.
    needsPort: isServer || command.includes("{port}"),
    previewUrl: isServer ? input.previewUrl?.trim() || DEFAULT_PREVIEW_URL : null,
    oneShot: false,
  };
}

/**
 * Split a command string into argv, honouring single and double quotes.
 *
 * Deliberately no shell: the command comes from project settings, and running
 * it through `sh -c` would turn a stray `;` or `$(…)` in a project name or
 * path into execution. Chaining with && is therefore not supported — multi-step
 * flows (like xcodegen then open) are modelled in code instead.
 */
export function tokenizeCommand(command: string): string[] {
  const tokens: string[] = [];
  let current = "";
  let quote: '"' | "'" | null = null;
  let started = false;

  for (const char of command) {
    if (quote) {
      if (char === quote) quote = null;
      else current += char;
      continue;
    }
    if (char === '"' || char === "'") {
      quote = char;
      started = true;
      continue;
    }
    if (/\s/.test(char)) {
      if (started) {
        tokens.push(current);
        current = "";
        started = false;
      }
      continue;
    }
    current += char;
    started = true;
  }

  if (started) tokens.push(current);
  return tokens;
}

/** Substitute {port} in a command or URL template. */
export function applyPort(template: string, port: number): string {
  return template.replace(/\{port\}/g, String(port));
}

/**
 * Repo-relative paths to symlink from the main checkout into a worktree.
 *
 * `null` means auto: keep the historical behaviour of linking the local SQLite
 * DB when the project has one, so a worktree dev server reads the same data as
 * the main app. Anything else is taken literally from project settings.
 */
export function resolveSharedPaths(
  sharedPaths: string | null | undefined,
  mainProjectPath: string
): string[] {
  if (sharedPaths) {
    try {
      const parsed = JSON.parse(sharedPaths) as unknown;
      if (Array.isArray(parsed)) {
        return parsed.filter((p): p is string => typeof p === "string" && p.trim() !== "");
      }
    } catch {
      // Fall through to auto-detection on malformed JSON
    }
  }

  const legacyDb = path.join("data", "kanban.db");
  return fs.existsSync(path.join(mainProjectPath, legacyDb)) ? [legacyDb] : [];
}
