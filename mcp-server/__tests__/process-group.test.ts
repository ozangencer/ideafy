import test from "node:test";
import assert from "node:assert/strict";
import { spawn, execFileSync } from "node:child_process";

import * as groupNs from "../../lib/process-group";

// See run-output.test.ts: lib/ modules may come back through the CJS interop.
function interop<T extends object>(ns: T): T {
  return (ns as { default?: T }).default ?? ns;
}

const { stopProcessGroup, stopProcessGroupById, stopProcess, isProcessGroupLeader } = interop(groupNs);

function alive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function groupMembers(pgid: number): number[] {
  try {
    return execFileSync("pgrep", ["-g", String(pgid)], { encoding: "utf8" })
      .trim()
      .split("\n")
      .filter(Boolean)
      .map(Number);
  } catch {
    return [];
  }
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

// Same shape as `npm run dev`: a detached leader with children below it.
async function spawnGroup(script: string): Promise<{ leader: number; members: number[] }> {
  const child = spawn("sh", ["-c", script], { detached: true, stdio: "ignore" });
  child.unref();
  const leader = child.pid!;
  for (let i = 0; i < 20; i++) {
    const members = groupMembers(leader);
    if (members.length >= 3) return { leader, members };
    await sleep(50);
  }
  throw new Error("group never came up");
}

test("process group: SIGTERM takes the leader and its children down", async () => {
  const { leader, members } = await spawnGroup("sleep 60 & sleep 60 & wait");
  assert.equal(isProcessGroupLeader(leader), true);

  const stopped = await stopProcessGroup(leader);

  assert.equal(stopped, true);
  for (const pid of members) assert.equal(alive(pid), false, `pid ${pid} survived`);
});

test("process group: a child ignoring SIGTERM is killed after the grace period", async () => {
  const { leader, members } = await spawnGroup(
    "trap '' TERM; sh -c \"trap '' TERM; sleep 60\" & wait"
  );

  const started = Date.now();
  const stopped = await stopProcessGroup(leader, { graceMs: 300 });

  assert.equal(stopped, true);
  assert.ok(Date.now() - started >= 300, "SIGKILL fired before the grace period");
  for (const pid of members) assert.equal(alive(pid), false, `pid ${pid} survived`);
});

test("process group: a PID that is gone reports false", async () => {
  const { leader } = await spawnGroup("sleep 60 & sleep 60 & wait");
  await stopProcessGroup(leader);
  assert.equal(await stopProcessGroup(leader), false);
});

test("process group: a non-leader PID is signalled alone", async () => {
  // This test process is not a group leader under the runner; its child is.
  const child = spawn("sleep", ["60"], { stdio: "ignore" });
  const pid = child.pid!;
  assert.equal(isProcessGroupLeader(pid), false);

  assert.equal(await stopProcessGroup(pid), true);
  assert.equal(alive(pid), false);
  assert.equal(alive(process.pid), true);
});

// The shape the old Stop left behind: npm (the leader) dead, its children
// still running in npm's group.
async function spawnHeadlessGroup(): Promise<{ pgid: number; members: number[] }> {
  const child = spawn("sh", ["-c", "sleep 60 & sleep 60 & exit 0"], { detached: true, stdio: "ignore" });
  child.unref();
  const pgid = child.pid!;
  for (let i = 0; i < 40; i++) {
    const members = groupMembers(pgid);
    if (members.length >= 2 && !alive(pgid)) return { pgid, members };
    await sleep(50);
  }
  throw new Error("headless group never came up");
}

test("process group: a group whose leader died is stopped by id", async () => {
  const { pgid, members } = await spawnHeadlessGroup();
  // The leader-checked path refuses it: the leader PID is gone.
  assert.equal(await stopProcessGroup(pgid), false);
  assert.ok(members.every(alive), "children died with the leader");

  assert.equal(await stopProcessGroupById(pgid), true);
  for (const pid of members) assert.equal(alive(pid), false, `pid ${pid} survived`);
  assert.equal(await stopProcessGroupById(pgid), false);
});

test("process group: stopProcess leaves the rest of a group alone", async () => {
  const { leader, members } = await spawnGroup("sleep 60 & sleep 60 & wait");
  const [victim] = members.filter((pid) => pid !== leader);

  assert.equal(await stopProcess(victim), true);
  assert.equal(alive(victim), false);
  assert.equal(alive(leader), true);

  await stopProcessGroup(leader);
});
