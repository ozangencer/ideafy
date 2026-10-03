import test from "node:test";
import assert from "node:assert/strict";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  realpathSync,
  rmSync,
  lutimesSync,
  symlinkSync,
  utimesSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import * as sweepNs from "../../lib/scratch-sweep";

// See run-output.test.ts: lib/ modules come back through the CJS interop.
function interop<T extends object>(ns: T): T {
  return (ns as { default?: T }).default ?? ns;
}

const { sweepScratch } = interop(sweepNs);

// IDE-394: chat writes throwaway files to <images>/<card>/scratch. The sweep
// clears that folder a week after the card completes, never the card root,
// and removes the folders of cards gone from both cards and card_trash.

const DAY = 24 * 60 * 60 * 1000;
const WEEK = 7 * DAY;
const NOW = Date.parse("2026-10-03T12:00:00.000Z");
const iso = (ms: number) => new Date(ms).toISOString();

const DONE = "11111111-1111-4111-8111-111111111111";
const RECENT = "22222222-2222-4222-8222-222222222222";
const OPEN = "33333333-3333-4333-8333-333333333333";
const TRASHED = "44444444-4444-4444-8444-444444444444";
const ORPHAN = "55555555-5555-4555-8555-555555555555";

function makeRoot() {
  const base = realpathSync(mkdtempSync(join(tmpdir(), "ideafy-sweep-")));
  const images = join(base, "images");
  mkdirSync(images);
  return { base, images, cleanup: () => rmSync(base, { recursive: true, force: true }) };
}

function cardFolder(images: string, id: string, ageMs = 2 * DAY) {
  const dir = join(images, id);
  mkdirSync(join(dir, "scratch"), { recursive: true });
  writeFileSync(join(dir, "approved.html"), "kept");
  writeFileSync(join(dir, "scratch", "voices.out"), "temp");
  const t = (NOW - ageMs) / 1000;
  utimesSync(dir, t, t);
  return dir;
}

test("a card completed over a week ago loses scratch/ and keeps its approved files", () => {
  const r = makeRoot();
  try {
    const dir = cardFolder(r.images, DONE);
    const result = sweepScratch({
      imagesRoot: r.images,
      cards: [{ id: DONE, status: "completed", completedAt: iso(NOW - WEEK - DAY), updatedAt: iso(NOW) }],
      trashedCardIds: [],
      retentionMs: WEEK,
      now: NOW,
    });

    assert.deepEqual(result.scratchRemoved, [DONE]);
    assert.equal(existsSync(join(dir, "scratch")), false);
    assert.deepEqual(readdirSync(dir), ["approved.html"]);
  } finally {
    r.cleanup();
  }
});

test("recently completed, reopened, or moved by MCP without completedAt: scratch/ stays or falls by status", () => {
  const r = makeRoot();
  try {
    cardFolder(r.images, RECENT);
    cardFolder(r.images, OPEN);
    const mcpMoved = "66666666-6666-4666-8666-666666666666";
    cardFolder(r.images, mcpMoved);

    const result = sweepScratch({
      imagesRoot: r.images,
      cards: [
        { id: RECENT, status: "completed", completedAt: iso(NOW - DAY), updatedAt: iso(NOW - DAY) },
        // Pulled back out of Completed by move_card: completedAt is stale.
        { id: OPEN, status: "progress", completedAt: iso(NOW - 30 * DAY), updatedAt: iso(NOW - 30 * DAY) },
        // Completed through move_card: no completedAt, updatedAt decides.
        { id: mcpMoved, status: "completed", completedAt: null, updatedAt: iso(NOW - WEEK - DAY) },
      ],
      trashedCardIds: [],
      retentionMs: WEEK,
      now: NOW,
    });

    assert.deepEqual(result.scratchRemoved, [mcpMoved]);
    assert.ok(existsSync(join(r.images, RECENT, "scratch", "voices.out")));
    assert.ok(existsSync(join(r.images, OPEN, "scratch", "voices.out")));
    assert.deepEqual(result.orphansRemoved, []);
  } finally {
    r.cleanup();
  }
});

test("a trashed card's folder waits for restore; an orphan UUID folder goes; other names are not touched", () => {
  const r = makeRoot();
  try {
    cardFolder(r.images, TRASHED);
    cardFolder(r.images, ORPHAN);
    const fresh = "77777777-7777-4777-8777-777777777777";
    cardFolder(r.images, fresh, 60 * 1000);
    mkdirSync(join(r.images, "draft-abc"));
    writeFileSync(join(r.images, "notes.txt"), "x");

    const result = sweepScratch({
      imagesRoot: r.images,
      cards: [],
      trashedCardIds: [TRASHED],
      retentionMs: WEEK,
      now: NOW,
    });

    assert.deepEqual(result.orphansRemoved, [ORPHAN]);
    assert.deepEqual(readdirSync(r.images).sort(), [fresh, TRASHED, "draft-abc", "notes.txt"].sort());
    assert.ok(existsSync(join(r.images, TRASHED, "scratch", "voices.out")));
  } finally {
    r.cleanup();
  }
});

test("a symlink pointing outside images/ loses only itself", () => {
  const r = makeRoot();
  try {
    const outside = join(r.base, "outside");
    mkdirSync(outside);
    writeFileSync(join(outside, "precious.txt"), "do not delete");

    // A card's scratch/ that is a link out, and an orphan UUID that is a link out.
    const dir = join(r.images, DONE);
    mkdirSync(dir);
    symlinkSync(outside, join(dir, "scratch"));
    symlinkSync(outside, join(r.images, ORPHAN));
    const t = (NOW - 2 * DAY) / 1000;
    utimesSync(dir, t, t);
    lutimesSync(join(r.images, ORPHAN), t, t);

    const result = sweepScratch({
      imagesRoot: r.images,
      cards: [{ id: DONE, status: "completed", completedAt: iso(NOW - 30 * DAY), updatedAt: iso(NOW) }],
      trashedCardIds: [],
      retentionMs: WEEK,
      now: NOW,
    });

    assert.equal(existsSync(join(dir, "scratch")), false);
    assert.deepEqual(result.orphansRemoved, [ORPHAN]);
    assert.deepEqual(readdirSync(r.images), [DONE]);
    assert.equal(readdirSync(outside).length, 1);
    assert.ok(existsSync(join(outside, "precious.txt")));
  } finally {
    r.cleanup();
  }
});

test("running twice is a no-op the second time", () => {
  const r = makeRoot();
  try {
    cardFolder(r.images, DONE);
    cardFolder(r.images, ORPHAN);
    const input = {
      imagesRoot: r.images,
      cards: [{ id: DONE, status: "completed", completedAt: iso(NOW - 2 * WEEK), updatedAt: iso(NOW) }],
      trashedCardIds: [] as string[],
      retentionMs: WEEK,
      now: NOW,
    };
    sweepScratch(input);
    const second = sweepScratch(input);
    assert.deepEqual(second.orphansRemoved, []);
    assert.deepEqual(readdirSync(r.images), [DONE]);
  } finally {
    r.cleanup();
  }
});
