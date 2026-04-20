#!/usr/bin/env node
// Rebuild native modules against the packaged Electron's Node ABI.
//
// Why this script exists:
//   - electron-builder's install-app-deps only rebuilds the ROOT
//     node_modules. It won't descend into .next/standalone/ or mcp-server/.
//   - .next/standalone/node_modules/better-sqlite3 is a STRIPPED copy
//     produced by Next's file tracing — no binding.gyp, so we can't
//     run `node-gyp rebuild` there. The only way to get an
//     Electron-ABI .node into that directory is to copy one.
//   - mcp-server/node_modules/better-sqlite3 is a full copy we
//     CAN rebuild in place, but copying the root binary is simpler
//     and guarantees ABI parity.
//
// Strategy:
//   1. Rebuild root/node_modules/better-sqlite3 against Electron ABI.
//   2. Copy the resulting .node binary into .next/standalone and mcp-server.

import { rebuild } from "@electron/rebuild";
import { readFileSync, existsSync, mkdirSync, copyFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "..");

const pkg = JSON.parse(readFileSync(path.join(repoRoot, "package.json"), "utf-8"));
const rawElectronVersion = pkg.devDependencies?.electron;
if (!rawElectronVersion) {
  console.error("[rebuild] no devDependencies.electron — aborting");
  process.exit(1);
}

// Pick the concrete installed version, not the semver range.
const installedElectronPkgPath = path.join(repoRoot, "node_modules", "electron", "package.json");
let electronVersion = rawElectronVersion.replace(/^[\^~]/, "");
if (existsSync(installedElectronPkgPath)) {
  electronVersion = JSON.parse(readFileSync(installedElectronPkgPath, "utf-8")).version;
}

console.log(`[rebuild] rebuilding ROOT better-sqlite3 for electron@${electronVersion}`);
await rebuild({
  buildPath: repoRoot,
  electronVersion,
  onlyModules: ["better-sqlite3"],
  force: true,
});

const srcBinary = path.join(
  repoRoot,
  "node_modules",
  "better-sqlite3",
  "build",
  "Release",
  "better_sqlite3.node"
);
if (!existsSync(srcBinary)) {
  console.error(`[rebuild] rebuilt binary not found at ${srcBinary}`);
  process.exit(1);
}

const destinations = [
  path.join(repoRoot, ".next", "standalone", "node_modules", "better-sqlite3", "build", "Release", "better_sqlite3.node"),
  path.join(repoRoot, "mcp-server", "node_modules", "better-sqlite3", "build", "Release", "better_sqlite3.node"),
];

for (const dst of destinations) {
  mkdirSync(path.dirname(dst), { recursive: true });
  copyFileSync(srcBinary, dst);
  console.log(`[rebuild] copied → ${dst}`);
}

console.log("[rebuild] done");
