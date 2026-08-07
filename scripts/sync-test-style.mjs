// Copies the shared test-scenario style contract into mcp-server/ so the
// MCP `save_tests` tool description can inject the same text every other AI
// surface uses.
//
// Why a copy instead of an import: mcp-server is a separate npm package with
// its own tsconfig (`rootDir: "."`, `include: ["*.ts"]`). Importing from the
// repo's lib/ would force rootDir up a level, which turns dist/index.js into
// dist/mcp-server/index.js — breaking package.json `main` and the path the
// Claude plugin copies from. lib/prompts/test-style.ts has zero imports, so a
// verbatim copy compiles cleanly inside mcp-server as-is.
//
// Runs from mcp-server's `prebuild`, so `npm run build:mcp` can never ship a
// stale contract. The generated file is committed (not gitignored) so
// `npm run dev` / tsx work on a fresh clone without a build step first.

import fs from "node:fs";
import path from "node:path";

const repoRoot = path.resolve(import.meta.dirname, "..");
const source = path.join(repoRoot, "lib", "prompts", "test-style.ts");
const target = path.join(repoRoot, "mcp-server", "test-style.generated.ts");

const HEADER = `// ─────────────────────────────────────────────────────────────────────────
// GENERATED FILE — DO NOT EDIT.
//
// Verbatim copy of lib/prompts/test-style.ts, written by
// scripts/sync-test-style.mjs on every mcp-server build. Edit the source,
// not this file; anything you change here is overwritten on the next build.
// ─────────────────────────────────────────────────────────────────────────

`;

if (!fs.existsSync(source)) {
  console.error(`[sync-test-style] source missing: ${source}`);
  process.exit(1);
}

const body = fs.readFileSync(source, "utf8");
const next = HEADER + body;
const current = fs.existsSync(target) ? fs.readFileSync(target, "utf8") : null;

if (current === next) {
  console.log("[sync-test-style] up to date");
} else {
  fs.writeFileSync(target, next);
  console.log(`[sync-test-style] wrote ${path.relative(repoRoot, target)}`);
}
