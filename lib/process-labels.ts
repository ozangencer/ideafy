import type { ProcessType, SectionType } from "@/lib/types";
import type { Phase } from "@/lib/prompts";

// Shared by the activity bell (server) and the OS banner (renderer) so the
// same run reads the same way in both places. Client-safe: no db imports.

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
