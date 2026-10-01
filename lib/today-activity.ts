import { SECTION_LABEL } from "./process-labels";
import type { SectionType, TodayCard, TodayChip, TodayStep } from "./types";

// Client-safe: the grouping behind /api/today, kept apart from the queries in
// today-registry.ts so it can be tested without a database.

/** User turns in one card tab since the start of the day. */
export interface TodayChatRow {
  cardId: string;
  sectionType: string;
  count: number;
  lastAt: string;
}

/** A finished one-shot run (Evaluate, Start, Quick Fix). */
export interface TodayRunRow {
  cardId: string;
  runKind: string;
  at: string;
}

/** A terminal session bound to the card and used today. */
export interface TodayTerminalRow {
  cardId: string;
  at: string;
}

export interface TodayCompletionRow {
  cardId: string;
  at: string;
}

export interface TodayActivityInput {
  chats: TodayChatRow[];
  runs: TodayRunRow[];
  terminals: TodayTerminalRow[];
  completions: TodayCompletionRow[];
  /** Card id → project id. A row whose card is missing here is dropped. */
  projectOf: Map<string, string | null>;
}

// One map for every run label. A kind that is not here (a new run type that
// forgot to register) shows under its raw name rather than disappearing.
const RUN_LABEL: Record<string, string> = {
  evaluate: "Evaluate",
  planning: "Planning",
  implementation: "Implementation",
  retest: "Retest",
  verify: "Verify",
  "quick-fix": "Quick Fix",
  generate: "Generate",
  autonomous: "Autonomous",
};

// Where each run leaves its output, so opening the card from a run lands on it.
const RUN_SECTION: Record<string, SectionType> = {
  evaluate: "opinion",
  planning: "solution",
  implementation: "solution",
  retest: "tests",
  verify: "tests",
  "quick-fix": "solution",
  generate: "solution",
  autonomous: "solution",
};

const CHAT_ORDER: SectionType[] = ["detail", "opinion", "solution", "tests"];

export function runLabel(runKind: string): string {
  return RUN_LABEL[runKind] ?? runKind;
}

function chatLabel(sectionType: string): string {
  return SECTION_LABEL[sectionType as SectionType] ?? sectionType;
}

function isSection(value: string): value is SectionType {
  return (CHAT_ORDER as string[]).includes(value);
}

function messages(count: number): string {
  return `${count} message${count === 1 ? "" : "s"}`;
}

interface Touch {
  at: string;
  section: SectionType | null;
}

interface Bucket {
  cardId: string;
  projectId: string | null;
  last: Touch | null;
  completed: boolean;
  runs: Map<string, number>; // runKind → count, in first-seen order
  chats: TodayChatRow[];
  terminal: boolean;
  steps: TodayStep[];
}

/**
 * Folds the day's rows into one entry per card, newest touch first.
 *
 * Terminal sessions become a single "Terminal session" chip and never add to a
 * run count: the hook refreshes their timestamp on every turn, so counting
 * them would say a card was run thirty times when one session stayed open.
 */
export function groupTodayActivity(input: TodayActivityInput): TodayCard[] {
  const buckets = new Map<string, Bucket>();

  const bucketFor = (cardId: string): Bucket | null => {
    if (!input.projectOf.has(cardId)) return null;
    let bucket = buckets.get(cardId);
    if (!bucket) {
      bucket = {
        cardId,
        projectId: input.projectOf.get(cardId) ?? null,
        last: null,
        completed: false,
        runs: new Map(),
        chats: [],
        terminal: false,
        steps: [],
      };
      buckets.set(cardId, bucket);
    }
    return bucket;
  };

  const touch = (bucket: Bucket, at: string, section: SectionType | null) => {
    // Ties keep the first section seen; a later touch without a section (a
    // terminal session) does not erase which tab the card was last worked in.
    if (!bucket.last || at > bucket.last.at) {
      bucket.last = { at, section: section ?? bucket.last?.section ?? null };
    }
  };

  for (const row of input.chats) {
    const bucket = bucketFor(row.cardId);
    if (!bucket || row.count <= 0) continue;
    bucket.chats.push(row);
    bucket.steps.push({
      at: row.lastAt,
      label: `${chatLabel(row.sectionType)} chat · ${messages(row.count)}`,
    });
    touch(bucket, row.lastAt, isSection(row.sectionType) ? row.sectionType : null);
  }

  // Chronological, so a card's run chips read in the order the day went.
  const runs = [...input.runs].sort((a, b) => a.at.localeCompare(b.at));
  for (const row of runs) {
    const bucket = bucketFor(row.cardId);
    if (!bucket) continue;
    bucket.runs.set(row.runKind, (bucket.runs.get(row.runKind) ?? 0) + 1);
    bucket.steps.push({ at: row.at, label: `${runLabel(row.runKind)} run` });
    touch(bucket, row.at, RUN_SECTION[row.runKind] ?? null);
  }

  for (const row of input.terminals) {
    const bucket = bucketFor(row.cardId);
    if (!bucket) continue;
    bucket.terminal = true;
    bucket.steps.push({ at: row.at, label: "Terminal session" });
    touch(bucket, row.at, null);
  }

  for (const row of input.completions) {
    const bucket = bucketFor(row.cardId);
    if (!bucket) continue;
    bucket.completed = true;
    bucket.steps.push({ at: row.at, label: "Completed" });
    touch(bucket, row.at, null);
  }

  const result: TodayCard[] = [];
  for (const bucket of buckets.values()) {
    if (!bucket.last) continue;

    const chips: TodayChip[] = [];
    if (bucket.completed) chips.push({ kind: "completed", label: "Completed" });
    for (const [kind, count] of bucket.runs) {
      chips.push({
        kind: "run",
        label: count > 1 ? `${runLabel(kind)} × ${count}` : runLabel(kind),
      });
    }
    const chats = [...bucket.chats].sort(
      (a, b) => chatRank(a.sectionType) - chatRank(b.sectionType)
    );
    for (const chat of chats) {
      chips.push({
        kind: "chat",
        label: `${chatLabel(chat.sectionType)} · ${messages(chat.count)}`,
      });
    }
    if (bucket.terminal) chips.push({ kind: "terminal", label: "Terminal session" });

    result.push({
      cardId: bucket.cardId,
      projectId: bucket.projectId,
      lastTouchedAt: bucket.last.at,
      lastSection: bucket.last.section,
      chips,
      steps: [...bucket.steps].sort((a, b) => a.at.localeCompare(b.at)),
    });
  }

  return result.sort((a, b) => b.lastTouchedAt.localeCompare(a.lastTouchedAt));
}

function chatRank(sectionType: string): number {
  const index = CHAT_ORDER.indexOf(sectionType as SectionType);
  return index === -1 ? CHAT_ORDER.length : index;
}
