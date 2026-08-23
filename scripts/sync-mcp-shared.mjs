// Copies the repo's import-free shared prompt/policy modules into mcp-server/
// so the MCP tool descriptions and results can serve the exact text every
// other AI surface uses.
//
// Why a copy instead of an import: mcp-server is a separate npm package with
// its own tsconfig (`rootDir: "."`, `include: ["*.ts"]`). Importing from the
// repo's lib/ would force rootDir up a level, which turns dist/index.js into
// dist/mcp-server/index.js — breaking package.json `main` and the path the
// Claude plugin copies from. On top of that, dist/ is copied verbatim into the
// plugin repo, where lib/ does not exist at all.
//
// Every source listed below must therefore have ZERO imports, so a verbatim
// copy compiles cleanly inside mcp-server as-is. mcp-server's phase-policy
// test asserts each copy is byte-identical to its source, so a stale or
// hand-edited generated file fails the suite rather than shipping.
//
// Runs from mcp-server's `prebuild`, so `npm run build:mcp` can never ship a
// stale copy. The generated files are committed (not gitignored) so
// `npm run dev` / tsx work on a fresh clone without a build step first.

import fs from "node:fs";
import path from "node:path";

const repoRoot = path.resolve(import.meta.dirname, "..");

const COPIES = [
  { source: "lib/prompts/test-style.ts", target: "mcp-server/test-style.generated.ts" },
  { source: "lib/prompts/phase-policy.ts", target: "mcp-server/phase-policy.generated.ts" },
];

export function generatedHeader(sourceRelPath) {
  return `// ─────────────────────────────────────────────────────────────────────────
// GENERATED FILE — DO NOT EDIT.
//
// Verbatim copy of ${sourceRelPath}, written by
// scripts/sync-mcp-shared.mjs on every mcp-server build. Edit the source,
// not this file; anything you change here is overwritten on the next build.
// ─────────────────────────────────────────────────────────────────────────

`;
}

function sync({ source, target }) {
  const sourcePath = path.join(repoRoot, source);
  const targetPath = path.join(repoRoot, target);

  if (!fs.existsSync(sourcePath)) {
    console.error(`[sync-mcp-shared] source missing: ${sourcePath}`);
    process.exit(1);
  }

  const next = generatedHeader(source) + fs.readFileSync(sourcePath, "utf8");
  const current = fs.existsSync(targetPath) ? fs.readFileSync(targetPath, "utf8") : null;

  if (current === next) {
    console.log(`[sync-mcp-shared] up to date: ${target}`);
  } else {
    fs.writeFileSync(targetPath, next);
    console.log(`[sync-mcp-shared] wrote ${target}`);
  }
}

// Importable by the test suite (which needs generatedHeader to strip it back
// off) without re-running the copy as a side effect.
if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(import.meta.filename)) {
  COPIES.forEach(sync);
}
