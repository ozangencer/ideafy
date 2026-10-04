import { stripHtml } from "./utils";

// Import-free on purpose, past ./utils: lib/card-ops/queue.ts reads the phase
// for the run queue's rules, and the MCP bundle pulls that file in.

export type Phase = "planning" | "implementation" | "retest" | "verify";

/** Detect which phase the card is in based on existing content. */
export function detectPhase(card: {
  solutionSummary: string | null;
  testScenarios: string | null;
  status?: string | null;
}): Phase {
  const hasSolution = card.solutionSummary && stripHtml(card.solutionSummary) !== "";
  const hasTests = card.testScenarios && stripHtml(card.testScenarios) !== "";

  // Human Test is a queue waiting on a person, and it is the column that grows
  // fastest because the agent finishes in minutes and verification takes days.
  // There the autonomous run walks the core flow rather than rewriting the
  // list, so what reaches the human is the handful of steps a machine could
  // not settle. Elsewhere a re-run still means "it broke, fix it".
  //
  // This test comes first on purpose: a Human Test card with no plan written
  // to it is still a card awaiting verification, and reading it as "planning"
  // would move it off the column the person is watching.
  if (card.status === "test") return "verify";

  if (!hasSolution) return "planning";
  if (!hasTests) return "implementation";
  return "retest";
}
