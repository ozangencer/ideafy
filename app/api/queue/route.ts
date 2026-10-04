import { NextRequest, NextResponse } from "next/server";
import {
  armIfIdle,
  clearQueue,
  dequeueCard,
  enqueueCard,
  getQueueSnapshot,
  overlapsForCard,
  pauseQueue,
  QueueError,
  restoreQueue,
  resumeQueue,
  worktreeWarningFor,
} from "@/lib/autonomous-run/run-queue";
import type { QueueClearResult, QueueRestoreResult } from "@/lib/card-queue";
import { isVerifyScope } from "@/lib/test-progress";

/** The queue in order, whether it is running, and what is running now. */
export async function GET() {
  return NextResponse.json(getQueueSnapshot());
}

/**
 * `{ cardId, afterCardId?, verifyScope? }` — queue a card, or move one already
 * queued. Omit `afterCardId` to append; `null` puts it first. `verifyScope`
 * (`"next"` | `"all"`) is what a queued pre-verify walks.
 *
 * Answers with the snapshot plus two warnings that never block: the files the
 * card shares with work ahead of it, and whether it runs without a worktree.
 */
export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => ({}));
  const cardId = typeof body.cardId === "string" ? body.cardId : null;
  if (!cardId) {
    return NextResponse.json({ error: "cardId is required" }, { status: 400 });
  }
  const afterCardId =
    body.afterCardId === undefined ? undefined : typeof body.afterCardId === "string" ? body.afterCardId : null;

  const verifyScope = isVerifyScope(body.verifyScope) ? body.verifyScope : undefined;

  try {
    enqueueCard(cardId, afterCardId, verifyScope);
  } catch (err) {
    if (err instanceof QueueError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    console.error("[queue] Failed to queue card:", err);
    return NextResponse.json({ error: "Failed to queue card" }, { status: 500 });
  }

  const overlaps = overlapsForCard(cardId);
  const worktreeWarning = worktreeWarningFor(cardId);
  armIfIdle();
  return NextResponse.json({ ...getQueueSnapshot(), overlaps, worktreeWarning });
}

/**
 * `{ cardId }` — take a card out of the queue. `{ all: true }` — empty it; the
 * answer lists what went, in order, for Undo (PATCH `restore`).
 */
export async function DELETE(request: NextRequest) {
  const body = await request.json().catch(() => ({}));
  if (body.all === true) {
    const { cleared, wasArmed } = clearQueue();
    const result: QueueClearResult = { ...getQueueSnapshot(), cleared, wasArmed };
    return NextResponse.json(result);
  }
  const cardId = typeof body.cardId === "string" ? body.cardId : null;
  if (!cardId) {
    return NextResponse.json({ error: "cardId is required" }, { status: 400 });
  }
  dequeueCard(cardId);
  return NextResponse.json(getQueueSnapshot());
}

/**
 * `{ action: "resume" | "pause" }`, or `{ action: "restore", cardIds, resume }`
 * to undo a clear: the cards go back in that order, ahead of anything queued
 * since, and `resume` re-arms the queue if it was running before.
 */
export async function PATCH(request: NextRequest) {
  const body = await request.json().catch(() => ({}));
  if (body.action === "restore") {
    const cardIds = Array.isArray(body.cardIds)
      ? body.cardIds.filter((id: unknown): id is string => typeof id === "string")
      : [];
    if (cardIds.length === 0) {
      return NextResponse.json({ error: "cardIds is required" }, { status: 400 });
    }
    const { skipped } = restoreQueue(cardIds, body.resume === true);
    const result: QueueRestoreResult = { ...getQueueSnapshot(), skipped };
    return NextResponse.json(result);
  }
  if (body.action === "resume") resumeQueue();
  else if (body.action === "pause") pauseQueue();
  else return NextResponse.json({ error: 'action must be "resume", "pause" or "restore"' }, { status: 400 });
  return NextResponse.json(getQueueSnapshot());
}
