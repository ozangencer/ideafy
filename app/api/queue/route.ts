import { NextRequest, NextResponse } from "next/server";
import {
  armIfIdle,
  dequeueCard,
  enqueueCard,
  getQueueSnapshot,
  overlapsForCard,
  pauseQueue,
  QueueError,
  resumeQueue,
  worktreeWarningFor,
} from "@/lib/autonomous-run/run-queue";

/** The queue in order, whether it is running, and what is running now. */
export async function GET() {
  return NextResponse.json(getQueueSnapshot());
}

/**
 * `{ cardId, afterCardId? }` — queue a card, or move one already queued.
 * Omit `afterCardId` to append; `null` puts it first.
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

  try {
    enqueueCard(cardId, afterCardId);
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

/** `{ cardId }` — take a card out of the queue. */
export async function DELETE(request: NextRequest) {
  const body = await request.json().catch(() => ({}));
  const cardId = typeof body.cardId === "string" ? body.cardId : null;
  if (!cardId) {
    return NextResponse.json({ error: "cardId is required" }, { status: 400 });
  }
  dequeueCard(cardId);
  return NextResponse.json(getQueueSnapshot());
}

/** `{ action: "resume" | "pause" }`. */
export async function PATCH(request: NextRequest) {
  const body = await request.json().catch(() => ({}));
  if (body.action === "resume") resumeQueue();
  else if (body.action === "pause") pauseQueue();
  else return NextResponse.json({ error: 'action must be "resume" or "pause"' }, { status: 400 });
  return NextResponse.json(getQueueSnapshot());
}
