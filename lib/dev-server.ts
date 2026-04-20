import { spawn, execFile } from "child_process";
import { promisify } from "util";
import * as net from "net";
import * as fs from "fs";
import * as path from "path";

const execFileAsync = promisify(execFile);

/**
 * Check if a port is in use
 */
export async function isPortInUse(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.once("error", () => resolve(true));
    server.once("listening", () => {
      server.close();
      resolve(false);
    });
    server.listen(port);
  });
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
    // Start npm run dev with the specified port
    // Using detached: true to let the process continue after parent exits
    // Using stdio: 'ignore' to prevent the process from being tied to the parent
    const child = spawn("npm", ["run", "dev", "--", "-p", port.toString()], {
      cwd: worktreePath,
      detached: true,
      stdio: "ignore",
    });

    // Unref to allow the parent to exit independently
    child.unref();

    if (!child.pid) {
      reject(new Error("Failed to start dev server - no PID"));
      return;
    }

    // Give the server a moment to start
    setTimeout(() => {
      if (isProcessRunning(child.pid!)) {
        resolve({ pid: child.pid!, port });
      } else {
        reject(new Error("Dev server process exited immediately"));
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
