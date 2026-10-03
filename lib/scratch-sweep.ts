import { lstatSync, readdirSync, realpathSync, rmSync } from "fs";
import path from "path";
import { SCRATCH_DIR } from "./artifact-links";

// Card folders are named after the card's UUID; anything else under images/
// (drafts, stray files) is not ours to judge.
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// A folder can exist a moment before its card row does; leave fresh ones be.
const ORPHAN_MIN_AGE_MS = 24 * 60 * 60 * 1000;

export interface SweepCard {
  id: string;
  status: string;
  completedAt: string | null;
  updatedAt: string;
}

export interface SweepInput {
  /** `~/.ideafy/images` — every card folder sits directly under it. */
  imagesRoot: string;
  cards: SweepCard[];
  /** Card ids still in card_trash; their folders wait for a restore. */
  trashedCardIds: Iterable<string>;
  /** How long a completed card keeps its scratch/ (the trash retention). */
  retentionMs: number;
  now?: number;
}

export interface SweepResult {
  scratchRemoved: string[];
  orphansRemoved: string[];
}

function isInside(child: string, parent: string): boolean {
  return child.startsWith(parent + path.sep);
}

// Resolve the parent before deleting and refuse anything that lands outside
// images/ — a card folder that is itself a symlink out is left alone. rmSync
// does not follow symlinks, so a link pointing out only loses itself.
function removeUnder(target: string, realRoot: string): boolean {
  let location: string;
  try {
    location = path.join(realpathSync(path.dirname(target)), path.basename(target));
    lstatSync(location);
  } catch {
    return false;
  }
  if (!isInside(location, realRoot)) return false;
  rmSync(location, { recursive: true, force: true });
  return true;
}

/**
 * Idempotent cleanup of `~/.ideafy/images` (IDE-394):
 * - a card completed for longer than `retentionMs` loses its `scratch/`
 *   folder; the card root, where applied artifacts live, is never touched;
 * - a UUID folder with no row in cards or card_trash is removed whole — the
 *   card is gone for good.
 * Status is checked as well as completedAt: before IDE-406, MCP's move_card
 * did not clear completedAt, so a card moved back out of Completed from a
 * terminal can still carry an old one.
 */
export function sweepScratch(input: SweepInput): SweepResult {
  const now = input.now ?? Date.now();
  const result: SweepResult = { scratchRemoved: [], orphansRemoved: [] };

  let realRoot: string;
  try {
    realRoot = realpathSync(input.imagesRoot);
  } catch {
    return result;
  }

  const known = new Set<string>(input.trashedCardIds);
  for (const card of input.cards) {
    known.add(card.id);
    if (card.status !== "completed") continue;
    const doneAt = Date.parse(card.completedAt || card.updatedAt);
    if (!Number.isFinite(doneAt) || now - doneAt < input.retentionMs) continue;
    const scratch = path.join(realRoot, card.id, SCRATCH_DIR);
    if (removeUnder(scratch, realRoot)) result.scratchRemoved.push(card.id);
  }

  let entries: string[];
  try {
    entries = readdirSync(realRoot);
  } catch {
    return result;
  }
  for (const name of entries) {
    if (!UUID_RE.test(name) || known.has(name)) continue;
    const folder = path.join(realRoot, name);
    try {
      if (now - lstatSync(folder).mtimeMs < ORPHAN_MIN_AGE_MS) continue;
    } catch {
      continue;
    }
    if (removeUnder(folder, realRoot)) result.orphansRemoved.push(name);
  }

  return result;
}
