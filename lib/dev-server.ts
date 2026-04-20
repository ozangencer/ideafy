import { spawn, execFile } from "child_process";
import { promisify } from "util";
import * as net from "net";
import * as fs from "fs";
import * as path from "path";

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
 * Start a dev server in the given worktree path
 * Returns the PID and port of the started server
 */
export async function startDevServer(
  worktreePath: string,
  port: number
): Promise<{ pid: number; port: number }> {
  return new Promise((resolve, reject) => {
    const child = spawn("npm", ["run", "dev", "--", "-p", port.toString()], {
      cwd: worktreePath,
      detached: true,
      stdio: ["ignore", "ignore", "pipe"],
    });

    let stderrTail = "";
    child.stderr?.on("data", (chunk: Buffer) => {
      stderrTail += chunk.toString();
      if (stderrTail.length > 4096) stderrTail = stderrTail.slice(-4096);
    });

    child.unref();

    if (!child.pid) {
      reject(new Error("Failed to start dev server - no PID"));
      return;
    }

    setTimeout(() => {
      if (isProcessRunning(child.pid!)) {
        // Drain future stderr into the void so the pipe buffer never fills
        child.stderr?.removeAllListeners("data");
        child.stderr?.resume();
        resolve({ pid: child.pid!, port });
      } else {
        const detail = stderrTail.trim().split("\n").slice(-5).join("\n");
        reject(
          new Error(
            detail
              ? `Dev server exited immediately: ${detail}`
              : "Dev server exited immediately"
          )
        );
      }
    }, 1000);
  });
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
 * Symlink the main project's database to the worktree
 * This allows the worktree to use the same database as the main app
 */
export function symlinkDatabase(mainProjectPath: string, worktreePath: string): void {
  const mainDbPath = path.join(mainProjectPath, "data", "kanban.db");
  const worktreeDataDir = path.join(worktreePath, "data");
  const worktreeDbPath = path.join(worktreeDataDir, "kanban.db");

  console.log(`[DevServer] Symlinking database from ${mainDbPath} to ${worktreeDbPath}`);

  // Check if main database exists
  if (!fs.existsSync(mainDbPath)) {
    console.warn(`[DevServer] Main database not found at ${mainDbPath}`);
    return;
  }

  // Create data directory in worktree if it doesn't exist
  if (!fs.existsSync(worktreeDataDir)) {
    fs.mkdirSync(worktreeDataDir, { recursive: true });
    console.log(`[DevServer] Created data directory: ${worktreeDataDir}`);
  }

  // Remove existing file/symlink in worktree
  if (fs.existsSync(worktreeDbPath)) {
    const stats = fs.lstatSync(worktreeDbPath);
    if (stats.isSymbolicLink()) {
      // Check if symlink already points to main db
      const target = fs.readlinkSync(worktreeDbPath);
      if (target === mainDbPath) {
        console.log(`[DevServer] Symlink already exists and points to main database`);
        return;
      }
    }
    fs.unlinkSync(worktreeDbPath);
    console.log(`[DevServer] Removed existing database file`);
  }

  // Create symlink
  fs.symlinkSync(mainDbPath, worktreeDbPath);
  console.log(`[DevServer] Database symlink created successfully`);
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
