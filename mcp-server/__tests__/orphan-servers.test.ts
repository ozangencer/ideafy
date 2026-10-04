import test from "node:test";
import assert from "node:assert/strict";

import * as orphanNs from "../../lib/orphan-servers";

// See run-output.test.ts: lib/ modules may come back through the CJS interop.
function interop<T extends object>(ns: T): T {
  return (ns as { default?: T }).default ?? ns;
}

const {
  classifyCandidates,
  matchesDevServer,
  parseEtime,
  parseFootprint,
  parseLsofCwd,
  parseLsofListen,
  parsePsOutput,
  folderHint,
} = interop(orphanNs);

const TMP = "/var/folders/9y/nzrh2m7x5gx63zs0rv2d4g1c0000gn/T";
const ROOTS = ["/tmp", "/private/tmp", TMP, `/private${TMP}`];

// Shaped after `ps -axww -o pid=,ppid=,pgid=,etime=,command=` on the machine
// where the two orphans of 2026-10-04 were found.
const PS = `
    1     0     1 03-11:57:12 /sbin/launchd
 3077 62980  3077    01:56:44 npm run electron
 3136  3077  3077    01:56:43 /bin/sh -c concurrently "next dev" "electron ."
 3159  3136  3077    01:56:43 npm exec next dev -H 127.0.0.1 -p 3030
 3194  3159  3077    01:56:42 node /Users/me/vibecode/ideafy/node_modules/.bin/next dev -H 127.0.0.1 -p 3030
 3195  3194  3077    01:56:42 next-server (v14.2.33)
19107  3195  3077       00:18 /Users/me/.local/bin/claude -p Ideafy: start the app with next dev and check
19300 19107  3077       00:10 node /private/tmp/ide431/app/node_modules/.bin/next dev -p 3040
19301 19300  3077       00:09 next-server (v14.2.33)
 5000  3195  5000       10:00 npm run dev
 5001  5000  5000       09:59 node /Users/me/proj/.worktrees/kanban/IDE-9-foo/node_modules/.bin/next dev -p 3033
 5002  5001  5000       09:58 next-server (v14.2.33)
 6100     1  6000 01-02:10:00 node ${TMP}/ide387/app/node_modules/.bin/next dev -H 127.0.0.1 -p 3034
 6101  6100  6000 01-02:09:58 next-server (v14.2.33)
 7000     1  7000 02-00:00:00 node /Users/me/projects/foo/node_modules/.bin/vite --port 5173
48543 48500 48543       14:58 claude
48559 48543 48543       14:58 npm exec mcp-knowledge-graph --memory-path /x/memory.jsonl
 8000     1 48543       12:00 npm exec next dev -p 3050
 8001  8000 48543       11:59 node /tmp/scratch/node_modules/.bin/next dev -p 3050
 8002  8001 48543       11:58 next-server (v14.2.33)
 9000     1  3077    01:00:00 node /private/tmp/ide393v/app/node_modules/.bin/next dev -p 3037
 9001  9000  3077    00:59:58 next-server (v14.2.33)
 9500     1  9500    03:00:00 next-server (v14.2.33)
`;

const CWDS = new Map<number, string>([
  [3159, "/Users/me/vibecode/ideafy"],
  [3194, "/Users/me/vibecode/ideafy"],
  [3195, "/Users/me/vibecode/ideafy"],
  [19300, "/private/tmp/ide431/app"],
  [19301, "/private/tmp/ide431/app"],
  [5000, "/Users/me/proj/.worktrees/kanban/IDE-9-foo"],
  [5001, "/Users/me/proj/.worktrees/kanban/IDE-9-foo"],
  [5002, "/Users/me/proj/.worktrees/kanban/IDE-9-foo"],
  [6100, `/private${TMP}/ide387/app`],
  [6101, `/private${TMP}/ide387/app`],
  [7000, "/Users/me/projects/foo"],
  [8000, "/private/tmp/scratch"],
  [8001, "/private/tmp/scratch"],
  [8002, "/private/tmp/scratch"],
  [9000, "/private/tmp/ide393v/app"],
  [9001, "/private/tmp/ide393v/app"],
  [9500, "/Users/me/elsewhere/app"],
]);

function classify(overrides: { registryPgids?: number[] } = {}) {
  return classifyCandidates(parsePsOutput(PS), {
    selfPid: 3195,
    selfPpid: 3194,
    runPids: new Set([5000]),
    cwds: CWDS,
    registryPgids: new Set(overrides.registryPgids ?? []),
    roots: ROOTS,
  });
}

test("orphans: only the scratch-folder servers nobody owns are listed", () => {
  const ids = classify().map((c) => c.id).sort();
  // Not 3077 (Ideafy itself), 19300 (under a live AI run), 5000 (a Run
  // server with a Stop button), 7000 (nohup'd in a real project), 9500 (not
  // in a scratch folder and not registered).
  assert.deepEqual(ids, ["3077:9000", "48543:8000", "6000"]);
});

test("orphans: a group whose npm leader died is one row with every member", () => {
  const row = classify().find((c) => c.id === "6000")!;
  assert.equal(row.sharedGroup, false);
  assert.deepEqual(row.pids, [6100, 6101]);
  assert.equal(row.rootPid, 6100);
  assert.equal(row.cwd, `/private${TMP}/ide387/app`);
  assert.equal(row.ageSec, 26 * 3600 + 10 * 60);
});

test("orphans: a server in Ideafy's own group is never stopped as a group", () => {
  const row = classify().find((c) => c.id === "3077:9000")!;
  assert.equal(row.sharedGroup, true);
  assert.deepEqual(row.pids, [9000, 9001]);
});

test("orphans: a server in a terminal session's group leaves the session out", () => {
  const row = classify().find((c) => c.id === "48543:8000")!;
  assert.equal(row.sharedGroup, true);
  assert.deepEqual(row.pids, [8000, 8001, 8002]);
});

test("orphans: a verify-server registry entry is listed wherever it runs", () => {
  const ids = classify({ registryPgids: [9500] }).map((c) => c.id);
  assert.ok(ids.includes("9500"));
});

test("orphans: signatures match the executable, not the arguments", () => {
  for (const cmd of [
    "npm run dev",
    "npm exec next dev -H 127.0.0.1 -p 3030",
    "npx next dev",
    "node /a/node_modules/.bin/next dev -p 3034",
    "/usr/local/bin/node /a/node_modules/next/dist/bin/next dev",
    "next-server (v14.2.33)",
    "node /a/node_modules/.bin/vite --port 5173",
    "node /a/node_modules/vite/bin/vite.js",
  ]) {
    assert.equal(matchesDevServer(cmd), true, cmd);
  }
  for (const cmd of [
    "/Users/me/.local/bin/claude -p run next dev in /tmp and npm run dev",
    "npm exec mcp-knowledge-graph --memory-path /x",
    "npm start",
    "node /a/node_modules/.bin/next build",
    "npm run electron",
  ]) {
    assert.equal(matchesDevServer(cmd), false, cmd);
  }
});

test("orphans: etime forms convert to seconds", () => {
  assert.equal(parseEtime("00:18"), 18);
  assert.equal(parseEtime("01:56:44"), 1 * 3600 + 56 * 60 + 44);
  assert.equal(parseEtime("03-11:57:12"), 3 * 86400 + 11 * 3600 + 57 * 60 + 12);
});

test("orphans: footprint output gives phys_footprint per pid", () => {
  const text = `footprint: Unable to find pid for process matching '99999'
======================================================================
node [3195]: 64-bit    Footprint: 2261317784 B (16384 bytes per page)
======================================================================

Auxiliary data:
    phys_footprint: 2261317784 B

======================================================================
node [3194]: 64-bit    Footprint: 35935104 B (16384 bytes per page)
======================================================================
`;
  const map = parseFootprint(text);
  assert.equal(map.get(3195), 2261317784);
  assert.equal(map.get(3194), 35935104);
  assert.equal(map.size, 2);
});

test("orphans: lsof output gives cwd and listening ports", () => {
  const cwd = parseLsofCwd("p3194\nfcwd\nn/Users/me/ideafy\np3195\nfcwd\nn/tmp/x\n");
  assert.equal(cwd.get(3194), "/Users/me/ideafy");
  assert.equal(cwd.get(3195), "/tmp/x");

  const ports = parseLsofListen("p3195\nf17\nn127.0.0.1:3030\nf18\nn*:3031\np3196\nf3\nn[::1]:5173\n");
  assert.deepEqual(ports.get(3195), [3030, 3031]);
  assert.deepEqual(ports.get(3196), [5173]);
});

test("orphans: folder hints name the scratch folder", () => {
  assert.equal(folderHint(`/private${TMP}/ide387/app`, ROOTS), "ide387");
  assert.equal(folderHint(`${TMP}/ideafy-verify/IDE-430-20261004/app`, ROOTS), "IDE-430-20261004");
  assert.equal(folderHint("/Users/me/proj/.worktrees/kanban/IDE-12-foo", ROOTS), "IDE-12-foo");
  assert.equal(folderHint("/private/tmp/ide393v/app", ROOTS), "ide393v");
});
