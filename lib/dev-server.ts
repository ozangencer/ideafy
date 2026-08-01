import { spawn, execFile } from "child_process";
import { promisify } from "util";
import * as net from "net";
import * as fs from "fs";
import * as path from "path";
import { buildEnv } from "./platform/base-provider";
import { applyPort, tokenizeCommand } from "./run-target";

const execFileAsync = promisify(execFile);

/**
 * Check if a port is in use. We try binding to both the default host and
 * 127.0.0.1 explicitly — on macOS, a server bound only to 127.0.0.1 (which
 * is exactly what `next dev -H 127.0.0.1` does) doesn't conflict with an
 * IPv6/dual-stack bind, so the default probe falsely reports "free".
 */
export async function isPortInUse(port: number): Promise<boolean> {
  const probe = (host?: string) =>
    new Promise<boolean>((resolve) => {
      const server = net.createServer();
      server.once("error", () => resolve(true));
      server.once("listening", () => {
        server.close();
        resolve(false);
      });
      if (host) server.listen(port, host);
      else server.listen(port);
    });
  const [any, loopback] = await Promise.all([probe(), probe("127.0.0.1")]);
  return any || loopback;
}

/**
 * Find an available port starting from the given port
 * Main kanban app runs on 3030, so worktree servers start from 3031
 */
export async function findAvailablePort(startPort = 3031): Promise<number> {
  for (let port = startPort; port < startPort + 100; port++) {
    const inUse = await isPortInUse(port);
    if (!inUse) return port;
  }
  throw new Error("No available ports found in range");
}

/**
 * Check if a process with the given PID is running
 */
export function isProcessRunning(pid: number): boolean {
  try {
    // Sending signal 0 doesn't kill the process, just checks if it exists
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

/**
 * Start a long-running process for a card's worktree.
 *
 * The command comes from the project's run target, so this covers a Next dev
 * server, an Electron app, or anything else the project defines. A port is
 * only allocated when the command (or the mode) asks for one; `{port}` is
 * substituted into the command and exported as PORT for frameworks that read
 * the env instead of a flag.
 */
export async function startRunCommand(
  worktreePath: string,
  command: string,
  port: number | null
): Promise<{ pid: number; port: number | null }> {
  const resolved = port === null ? command : applyPort(command, port);
  const argv = tokenizeCommand(resolved);
  if (argv.length === 0) {
    throw new Error("Run command is empty");
  }
  const [bin, ...args] = argv;

  return new Promise((resolve, reject) => {
    const child = spawn(bin, args, {
      cwd: worktreePath,
      detached: true,
      stdio: ["ignore", "ignore", "pipe"],
      // buildEnv() widens PATH to the usual Homebrew/local bins. Without it a
      // packaged build launched from Finder inherits a minimal PATH and cannot
      // even find npm.
      env: port === null ? buildEnv() : { ...buildEnv(), PORT: String(port) },
    });

    let stderrTail = "";
    child.stderr?.on("data", (chunk: Buffer) => {
      stderrTail += chunk.toString();
      if (stderrTail.length > 4096) stderrTail = stderrTail.slice(-4096);
    });

    // A missing binary emits 'error' asynchronously. Without a listener the
    // EventEmitter rethrows it and takes the Next server down with it.
    let spawnError: Error | null = null;
    child.on("error", (err) => {
      spawnError = err;
    });

    child.unref();

    if (!child.pid) {
      reject(new Error(`Failed to start "${bin}" — command not found or not executable`));
      return;
    }

    setTimeout(() => {
      if (isProcessRunning(child.pid!)) {
        // Drain future stderr into the void so the pipe buffer never fills
        child.stderr?.removeAllListeners("data");
        child.stderr?.resume();
        resolve({ pid: child.pid!, port });
      } else {
        const detail =
          (spawnError as Error | null)?.message ||
          stderrTail.trim().split("\n").slice(-5).join("\n");
        reject(
          new Error(
            detail
              ? `\`${resolved}\` exited immediately: ${detail}`
              : `\`${resolved}\` exited immediately`
          )
        );
      }
    }, 1000);
  });
}

/**
 * Run a command that is expected to finish rather than stay up — the custom
 * counterpart to opening Xcode. Nothing is supervised afterwards, so a slow
 * command is capped instead of hanging the request.
 */
export async function runOneShotCommand(
  worktreePath: string,
  command: string
): Promise<void> {
  const argv = tokenizeCommand(command);
  if (argv.length === 0) throw new Error("Run command is empty");
  const [bin, ...args] = argv;

  await execFileAsync(bin, args, {
    cwd: worktreePath,
    env: buildEnv(),
    timeout: 120_000,
  });
}

/**
 * Open a worktree in Xcode.
 *
 * Nothing is built here on purpose. A Debug build from a worktree gets a fresh
 * code identity, so macOS drops any TCC grants (microphone, accessibility) the
 * app depends on — and a menu-bar app running twice fights itself over global
 * hotkeys. Handing the worktree to Xcode leaves ⌘R, the scheme, and the
 * signing identity where the developer already manages them.
 *
 * XcodeGen projects keep `.xcodeproj` out of git, so the worktree usually has
 * `project.yml` and no project file — generate it first when that is the case.
 */
export async function openInXcode(
  worktreePath: string
): Promise<{ opened: string; generated: boolean }> {
  const entries = fs.readdirSync(worktreePath);
  let generated = false;

  const findProject = () => {
    const current = fs.readdirSync(worktreePath);
    // A workspace supersedes the bare project when both exist (CocoaPods, SPM).
    return (
      current.find((name) => name.endsWith(".xcworkspace")) ??
      current.find((name) => name.endsWith(".xcodeproj")) ??
      null
    );
  };

  if (!findProject() && entries.includes("project.yml")) {
    console.log(`[Run] No project file in worktree — running xcodegen generate`);
    await execFileAsync("xcodegen", ["generate"], {
      cwd: worktreePath,
      env: buildEnv(),
    });
    generated = true;
  }

  const target = findProject();
  if (!target) {
    // Package.swift is openable by Xcode directly; otherwise there is nothing.
    if (entries.includes("Package.swift")) {
      await execFileAsync("open", ["-a", "Xcode", worktreePath], { env: buildEnv() });
      return { opened: worktreePath, generated };
    }
    throw new Error(
      "No .xcodeproj, .xcworkspace, or Package.swift found in the worktree"
    );
  }

  const targetPath = path.join(worktreePath, target);
  await execFileAsync("open", [targetPath], { env: buildEnv() });
  return { opened: targetPath, generated };
}

/**
 * Stop a dev server by its PID
 * Returns true if successfully stopped, false otherwise
 */
export function stopDevServer(pid: number): boolean {
  try {
    // Try SIGTERM first (graceful)
    process.kill(pid, "SIGTERM");

    // Check if it's still running after a brief moment
    setTimeout(() => {
      if (isProcessRunning(pid)) {
        // Force kill if still running
        try {
          process.kill(pid, "SIGKILL");
        } catch {
          // Process might have exited by now
        }
      }
    }, 500);

    return true;
  } catch {
    // Process might not exist
    return false;
  }
}

/**
 * Open a URL in the default browser
 */
export async function openInBrowser(url: string): Promise<void> {
  try {
    // execFile avoids the shell — url is passed as argv so any
    // metacharacters (&, ;, $(…)) are inert.
    await execFileAsync("open", [url]);
  } catch (error) {
    console.error("Failed to open browser:", error);
  }
}

/**
 * Symlink repo-relative paths from the main checkout into the worktree, so a
 * run inside the worktree sees the same local state as the main app.
 *
 * This used to hardcode `data/kanban.db` — which only ever meant anything for
 * Ideafy's own repo and was a silent no-op everywhere else. The paths now come
 * from project settings (with that DB as the auto-detected default).
 */
export function linkSharedPaths(
  mainProjectPath: string,
  worktreePath: string,
  relativePaths: string[]
): void {
  for (const relative of relativePaths) {
    // Keep every link inside the worktree: a path like ../../.ssh would
    // otherwise plant a symlink outside it.
    const source = path.resolve(mainProjectPath, relative);
    const target = path.resolve(worktreePath, relative);
    if (
      !source.startsWith(path.resolve(mainProjectPath) + path.sep) ||
      !target.startsWith(path.resolve(worktreePath) + path.sep)
    ) {
      console.warn(`[Run] Skipping shared path outside the project: ${relative}`);
      continue;
    }

    if (!fs.existsSync(source)) {
      console.warn(`[Run] Shared path not found in main checkout: ${source}`);
      continue;
    }

    const targetDir = path.dirname(target);
    if (!fs.existsSync(targetDir)) {
      fs.mkdirSync(targetDir, { recursive: true });
    }

    if (fs.existsSync(target) || fs.lstatSync(target, { throwIfNoEntry: false })) {
      const stats = fs.lstatSync(target);
      if (stats.isSymbolicLink() && fs.readlinkSync(target) === source) continue;
      // A real file here is the worktree's own copy from git — replacing it
      // with a link to main is the whole point of a shared path.
      fs.rmSync(target, { recursive: true, force: true });
    }

    fs.symlinkSync(source, target, fs.statSync(source).isDirectory() ? "dir" : "file");
    console.log(`[Run] Linked shared path ${relative} -> ${source}`);
  }
}

/**
 * Ensure the worktree has a node_modules directory so `npm run dev` can resolve
 * `next` and other deps. Git worktrees share the same package.json as the main
 * checkout, so symlinking node_modules is safe and avoids a multi-minute install.
 *
 * If the worktree already has a real node_modules dir (e.g. someone ran
 * `npm install` inside it), leave it untouched.
 */
export function ensureWorktreeDependencies(
  mainProjectPath: string,
  worktreePath: string
): void {
  const mainModulesPath = path.join(mainProjectPath, "node_modules");
  const worktreeModulesPath = path.join(worktreePath, "node_modules");

  if (!fs.existsSync(mainModulesPath)) {
    console.warn(
      `[DevServer] Main node_modules missing at ${mainModulesPath} — skipping symlink`
    );
    return;
  }

  if (fs.existsSync(worktreeModulesPath)) {
    const stats = fs.lstatSync(worktreeModulesPath);
    if (stats.isSymbolicLink()) {
      const target = fs.readlinkSync(worktreeModulesPath);
      if (target === mainModulesPath) return;
      fs.unlinkSync(worktreeModulesPath);
      console.log(`[DevServer] Replaced stale node_modules symlink`);
    } else {
      // Real directory — respect it
      return;
    }
  }

  fs.symlinkSync(mainModulesPath, worktreeModulesPath, "dir");
  console.log(`[DevServer] Linked worktree node_modules -> ${mainModulesPath}`);
}
