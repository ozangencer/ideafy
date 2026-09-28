import type { ConversationActivityEntry } from "./types";

/**
 * Pure reducer for the Live Activity strip shown while a chat / section
 * stream is running.
 *
 * Claude runs with `--include-partial-messages`, so the parser emits every
 * `thinking_delta` as its own `thinking` event, exactly like `text` deltas.
 * The text side concatenates them into one message; the activity side used to
 * push each delta as a separate row, so a single sentence such as
 * "~30 saniye sürecek." rendered as four unrelated "thoughts" ("u",
 * "~30 saniye s", "ürec", "ek."). This module keeps consecutive thinking
 * deltas in one growing entry and lets the caller close it once the model
 * moves on to visible text.
 *
 * No store or React dependency on purpose: the Zustand slice and the section
 * chat hook both import it, and `mcp-server/__tests__` can exercise it.
 */

/** Rows kept in the card-chat strip. Older entries scroll off the top. */
export const DEFAULT_ACTIVITY_CAP = 5;

/** Characters of a thinking block shown in the strip (its tail). */
export const THINKING_TAIL_LENGTH = 240;

function cap(log: ConversationActivityEntry[], max: number): ConversationActivityEntry[] {
  if (!Number.isFinite(max) || log.length <= max) return log;
  return log.slice(-max);
}

/**
 * Append a stream event to the activity log.
 *
 * - A `thinking` delta lands in the last entry when that entry is an *open*
 *   thinking block; otherwise it opens a new one. Deltas are appended
 *   verbatim so the whitespace between tokens ("saniye " + "sürecek")
 *   survives.
 * - An empty delta is a no-op. A whitespace-only delta only counts when it
 *   extends an open block; on its own it would just render as a blank row.
 * - `tool_use` / `tool_result` close whatever thinking block was open and
 *   become the new tail, so the next delta starts a fresh row.
 *
 * Returns the input array untouched when nothing changed, so callers can
 * skip a re-render with an identity check.
 */
export function appendActivity(
  log: ConversationActivityEntry[] | undefined,
  entry: ConversationActivityEntry,
  max: number = DEFAULT_ACTIVITY_CAP,
): ConversationActivityEntry[] {
  const existing = log ?? [];

  if (entry.type !== "thinking") {
    return cap([...sealActivity(existing), entry], max);
  }

  const delta = entry.content;
  if (!delta) return existing;

  const last = existing[existing.length - 1];
  if (last && last.type === "thinking" && last.open) {
    const merged = existing.slice(0, -1);
    merged.push({ ...last, content: last.content + delta });
    return merged;
  }

  if (!delta.trim()) return existing;
  return cap([...existing, { type: "thinking", content: delta, open: true }], max);
}

/**
 * Close the trailing thinking block, if one is open. Called when the model
 * starts emitting visible text: the thought is finished, and a later
 * `thinking` delta belongs to a new row rather than this one.
 *
 * Returns the same array when there is nothing to seal.
 */
export function sealActivity(log: ConversationActivityEntry[]): ConversationActivityEntry[] {
  const last = log[log.length - 1];
  if (!last || last.type !== "thinking" || !last.open) return log;
  const sealed = log.slice(0, -1);
  sealed.push({ type: last.type, content: last.content });
  return sealed;
}

/**
 * Display helper: the last `max` characters of a thinking block, prefixed
 * with an ellipsis when something was cut. The strip answers "what is it
 * thinking *now*", so the tail is the part worth showing, and it keeps
 * moving as the block grows.
 */
export function thinkingTail(content: string, max: number = THINKING_TAIL_LENGTH): string {
  const text = content.trim();
  if (text.length <= max) return text;
  return `…${text.slice(-max)}`;
}
