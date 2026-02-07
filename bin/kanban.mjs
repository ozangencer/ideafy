#!/usr/bin/env node

import { spawn, execSync } from "node:child_process";
import { existsSync, mkdirSync } from "node:fs";
import { resolve, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = fileURLToPath(new URL(".", import.meta.url));
const PROJECT_ROOT = resolve(__dirname, "..");

// --setup-mcp: Output MCP config JSON with correct absolute path and exit
if (process.argv.includes("--setup-mcp")) {
  const mcpServerPath = join(PROJECT_ROOT, "mcp-server", "index.ts");
  const config = {
    mcpServers: {
      kanban: {
        command: "npx",
        args: ["tsx", mcpServerPath],
      },
    },
  };
  console.log(JSON.stringify(config, null, 2));
  process.exit(0);
}

const PORT = process.env.PORT || "3030";

// 1. Ensure data/ directory exists for SQLite
const dataDir = join(PROJECT_ROOT, "data");
if (!existsSync(dataDir)) {
  mkdirSync(dataDir, { recursive: true });
  console.log("Created data/ directory");
}

// 2. Run drizzle-kit push (idempotent - safe to run every time)
console.log("Setting up database...");
try {
  execSync("npx drizzle-kit push", {
    cwd: PROJECT_ROOT,
    stdio: "inherit",
  });
  console.log("Database ready.");
} catch (err) {
  console.error("Warning: Database setup failed. Continuing anyway...");
}

// 3. Start Next.js dev server
console.log(`\nStarting ideafy on port ${PORT}...`);
const nextProcess = spawn("npx", ["next", "dev", "-p", PORT], {
  cwd: PROJECT_ROOT,
  stdio: "inherit",
  env: { ...process.env, PORT },
});

// 4. Open browser after a short delay
setTimeout(() => {
  const url = `http://localhost:${PORT}`;
  try {
    // macOS
    spawn("open", [url], { stdio: "ignore" });
  } catch {
    // Silently ignore if open command fails (non-macOS)
  }
}, 3000);

// 5. Graceful shutdown
function shutdown() {
  console.log("\nShutting down ideafy...");
  nextProcess.kill("SIGTERM");
  process.exit(0);
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

nextProcess.on("close", (code) => {
  process.exit(code ?? 0);
});
