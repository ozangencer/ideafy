import type { BackgroundProcess, ProcessType, SectionType } from "@/lib/types";
import type { Phase } from "@/lib/prompts";

// Shared by the activity bell (server), the OS banner and the Background
// Processes popover (renderer) so the same run reads the same way in every
// place. Client-safe: no db imports.

export const SECTION_LABEL: Record<SectionType, string> = {
  detail: "Detail",
  opinion: "AI Opinion",
  solution: "Solution",
  tests: "Tests",
};

export const PROCESS_LABEL: Record<ProcessType, string> = {
  autonomous: "Autonomous task",
  "quick-fix": "Quick Fix",
  evaluate: "AI Opinion",
  generate: "Generate",
  chat: "Chat",
};

// An autonomous run is one of four phases, and "Autonomous task completed"
// does not say which. The phase is captured when the run starts — read at the
// end, a finished plan already looks like an implementation card.
export const PHASE_LABEL: Record<Phase, string> = {
  planning: "Plan",
  implementation: "Implementation",
  retest: "Fix & retest",
  verify: "Pre-verify",
};

/** Label for a phase stored in a payload or registry entry; null when absent or unknown. */
export function phaseLabel(phase: unknown): string | null {
  return typeof phase === "string" && phase in PHASE_LABEL ? PHASE_LABEL[phase as Phase] : null;
}

export type RunOutcome = "completed" | "warning" | "failed";

/**
 * Bell and banner title for an autonomous run, e.g. "Implementation completed
 * → Human Test". `targetColumn` is the column the run moved the card to, null
 * when it stayed put. Returns null without a phase (generate, older entries) so
 * the caller keeps its generic PROCESS_LABEL title.
 */
export function autonomousRunTitle(
  phase: unknown,
  outcome: RunOutcome,
  targetColumn: string | null | undefined
): string | null {
  const label = phaseLabel(phase);
  if (!label) return null;
  if (outcome === "failed") return `${label} failed`;
  const head =
    outcome === "warning"
      ? `${label} finished with a warning`
      : phase === "planning"
        ? "Plan ready"
        : `${label} completed`;
  return targetColumn ? `${head} → ${targetColumn}` : head;
}

/** Generic label for a run with no phase: "Chat (Tests)", "Quick Fix", "AI Opinion". */
export function runLabel(processType: ProcessType, sectionType: SectionType | null): string {
  if (processType === "chat") return `Chat (${SECTION_LABEL[sectionType ?? "detail"]})`;
  return PROCESS_LABEL[processType];
}

type ProcessLike = Pick<
  BackgroundProcess,
  "processType" | "sectionType" | "status" | "endReason" | "warning" | "phase" | "targetColumn"
>;

/** What the run is doing, without its outcome: "Pre-verify", "Chat (Tests)". */
export function processBaseLabel(process: ProcessLike): string {
  return phaseLabel(process.phase) ?? runLabel(process.processType, process.sectionType);
}

/**
 * One Background Processes row, e.g. "Implementation → Human Test" while it
 * runs and "Implementation completed → Human Test" once it is done. Two runs on
 * the same card otherwise both read "Autonomous". The phase comes from the
 * registry entry only — derived from the card, a finished plan would already
 * read as an implementation.
 */
export function processRowLabel(process: ProcessLike): string {
  const base = processBaseLabel(process);
  if (process.status === "running") {
    return phaseLabel(process.phase) && process.targetColumn ? `${base} → ${process.targetColumn}` : base;
  }
  if (process.endReason === "aborted") return `${base} · Interrupted on reload`;
  if (process.endReason === "failed") {
    return autonomousRunTitle(process.phase, "failed", null) ?? `${base} failed`;
  }
  if (process.warning) {
    return (
      autonomousRunTitle(process.phase, "warning", process.targetColumn) ??
      `${base} finished with a warning`
    );
  }
  return autonomousRunTitle(process.phase, "completed", process.targetColumn) ?? `${base} completed`;
}

// Copy of activity-registry's formatDuration: that module imports the db, so
// the renderer cannot reach it.
export function formatDuration(ms: number): string {
  const totalSec = Math.max(0, Math.floor(ms / 1000));
  const min = Math.floor(totalSec / 60);
  const sec = totalSec % 60;
  if (min === 0) return `${sec}s`;
  return `${min}m ${sec.toString().padStart(2, "0")}s`;
}

/**
 * Elapsed time to the minute, "14m" or "1h 05m": seconds that tick by are
 * noise on a line you only glance at.
 */
export function formatElapsedShort(ms: number): string {
  const min = Math.floor(Math.max(0, ms) / 60000);
  if (min < 60) return `${min}m`;
  return `${Math.floor(min / 60)}h ${(min % 60).toString().padStart(2, "0")}m`;
}

/** "4m ago" for a finished row, so two rows of one card tell apart in time. */
export function formatAgo(ms: number): string {
  const min = Math.floor(Math.max(0, ms) / 60000);
  if (min === 0) return "just now";
  if (min < 60) return `${min}m ago`;
  const hours = Math.floor(min / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

/** Time hint next to a row: elapsed while running, how long ago once finished. */
export function processTimeHint(
  process: Pick<BackgroundProcess, "status" | "startedAt" | "completedAt">,
  now: number
): string | null {
  if (process.status === "running") {
    const started = Date.parse(process.startedAt);
    return Number.isNaN(started) ? null : formatDuration(now - started);
  }
  const completed = process.completedAt ? Date.parse(process.completedAt) : NaN;
  return Number.isNaN(completed) ? null : formatAgo(now - completed);
}
