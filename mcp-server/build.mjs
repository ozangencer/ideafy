// Bundles the MCP server into one dist/index.js with esbuild.
//
// A bundle instead of tsc output so the server can import the repo's lib/
// directly — the shared prompt text and the card operations in lib/card-ops/
// that the app's routes call too. tsc pinned rootDir to mcp-server/ and
// dist/ was copied file by file into the Claude plugin, where lib/ does not
// exist; that is what forced the old copy script. One file also means the
// plugin cannot ship with a module missing.
//
// Everything is bundled, npm dependencies included, so the plugin needs no
// `npm ci`. The one thing that must never get in is the app's database stack
// (better-sqlite3, drizzle, Next) — __tests__/bundle-deps.test.ts builds with
// these same options and fails on it. node:sqlite stays external on its own:
// esbuild leaves every node: builtin out of a node-platform bundle.

import { build } from "esbuild";
import path from "node:path";

const here = import.meta.dirname;

/** @type {import("esbuild").BuildOptions & { entryPoints: string[]; outfile: string }} */
export const buildOptions = {
  entryPoints: [path.join(here, "index.ts")],
  outfile: path.join(here, "dist", "index.js"),
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node22",
  // Bundled CommonJS dependencies call require() for builtins, which an ES
  // module does not have.
  banner: {
    js: "import { createRequire as __ideafyCreateRequire } from 'node:module'; const require = __ideafyCreateRequire(import.meta.url);",
  },
  logLevel: "warning",
};

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(import.meta.filename)) {
  await build(buildOptions);
  console.log(`[build] wrote ${path.relative(process.cwd(), buildOptions.outfile)}`);
}
