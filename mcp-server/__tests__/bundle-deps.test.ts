import test from "node:test";
import assert from "node:assert/strict";
import { isBuiltin } from "node:module";
import { relative } from "node:path";
import { build, type Metafile } from "esbuild";
import { buildOptions } from "../build.mjs";

// The MCP bundle reaches into the repo's lib/, so one careless import can pull
// the app's database stack into the plugin. That is not cosmetic: Claude Code
// installs the plugin with `npm ci --ignore-scripts`, better-sqlite3 never
// gets its native binary there, and the server dies on start — IDE-380, which
// is why the MCP moved to node:sqlite in the first place. Drizzle and Next
// have no business in a stdio server either.
//
// This builds with the real build options and reads esbuild's metafile, so it
// catches the leak however many imports deep it starts.

const FORBIDDEN = [
  "node_modules/better-sqlite3/",
  "node_modules/drizzle-orm/",
  "node_modules/next/",
  "lib/db/",
];

async function metafile(): Promise<Metafile> {
  const result = await build({ ...buildOptions, write: false, metafile: true, logLevel: "silent" });
  return result.metafile!;
}

/** The import chain from the entry point to `target`, for the failure message. */
function importChain(meta: Metafile, target: string): string[] {
  const parents = new Map<string, string>();
  // Metafile paths are relative to esbuild's working directory.
  const entry = relative(process.cwd(), buildOptions.entryPoints[0]);
  const queue = [entry];
  const seen = new Set(queue);
  while (queue.length) {
    const current = queue.shift()!;
    if (current === target) break;
    for (const { path } of meta.inputs[current]?.imports ?? []) {
      if (seen.has(path) || !(path in meta.inputs)) continue;
      seen.add(path);
      parents.set(path, current);
      queue.push(path);
    }
  }
  const chain = [target];
  while (parents.has(chain[0])) chain.unshift(parents.get(chain[0])!);
  return chain;
}

test("the MCP bundle carries none of the app's database stack", async () => {
  const meta = await metafile();
  const leaks = Object.keys(meta.inputs).filter((path) =>
    FORBIDDEN.some((forbidden) => path.includes(forbidden))
  );
  assert.deepEqual(
    leaks,
    [],
    leaks.length
      ? `The bundle pulls in ${leaks[0]} via:\n  ${importChain(meta, leaks[0]).join("\n  → ")}\n` +
          "Move what the MCP needs into a module that does not import lib/db, drizzle or Next."
      : undefined
  );
});

test("the MCP builds to a single dist/index.js", async () => {
  const meta = await metafile();
  const outputs = Object.keys(meta.outputs).filter((path) => !path.endsWith(".map"));
  assert.equal(outputs.length, 1, `Expected one output file, got: ${outputs.join(", ")}`);
  assert.match(outputs[0], /(^|\/)dist\/index\.js$/);
});

// The plugin ships dist/index.js and nothing else, so anything left external
// has to be something Node already has. node:sqlite is one of them: db.ts
// loads it at runtime with createRequire, so it never shows up as an import.
test("everything but Node's builtins is inside the bundle", async () => {
  const meta = await metafile();
  const external = Object.values(meta.inputs)
    .flatMap((input) => input.imports)
    .filter((imp) => imp.external)
    .map((imp) => imp.path);
  const nonBuiltin = [...new Set(external.filter((path) => !isBuiltin(path)))];
  assert.deepEqual(nonBuiltin, [], `Only Node builtins may stay outside the bundle, got: ${nonBuiltin.join(", ")}`);
});
