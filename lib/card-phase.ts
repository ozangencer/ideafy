/**
 * What a card's run buttons mean, and when they exist at all.
 *
 * These derivations used to live inside `components/board/card.tsx`, where the
 * board was their only reader. Focus view now offers the same three runs on its
 * Human Test rows, and two copies of "may this card be pre-verified" is exactly
 * the kind of pair that drifts: the board would keep hiding a button the focus
 * row still offered, and the click would fail with no explanation.
 *
 * Everything here is a pure function of the card plus text already stripped by
 * the caller — no store, no DOM — so both surfaces can share it without either
 * one importing the other's component tree.
 *
 * Not to be confused with `detectPhase` in `lib/prompts.ts`, which answers the
 * same question for the *server*. The two disagree on purpose: the server reads
 * any Human Test card as `verify`, while the board additionally requires a
 * checklist, because it is the board that has to decide whether to draw a
 * button. Unifying them is a backend change, not a UI one.
 */

import { TestProgress } from "./test-progress";
import { Card } from "./types";

export type Phase = "planning" | "implementation" | "retest" | "verify";

export function detectBoardPhase(
  card: Card,
  solutionText: string,
  testText: string
): Phase {
  // In Progress sütunundaki kartlar için direkt implementation
  if (card.status === "progress") {
    const hasTests = !!testText;
    return hasTests ? "retest" : "implementation";
  }

  // Human Test'te iş sırası insanda; oradaki otonom koşu çeklisti yeniden
  // yazmak yerine temel akışı yürüyüp geçenleri işaretler.
  if (card.status === "test" && !!testText) return "verify";

  // Diğer sütunlar için mevcut mantık
  const hasSolution = !!solutionText;
  const hasTests = !!testText;

  if (!hasSolution) return "planning";
  if (!hasTests) return "implementation";
  return "retest";
}

export function getPhaseLabels(phase: Phase): { play: string; terminal: string } {
  switch (phase) {
    case "planning":
      return {
        play: "Plan Task (Autonomous)",
        terminal: "Plan Task (Interactive)",
      };
    case "implementation":
      return {
        play: "Implement (Autonomous)",
        terminal: "Implement (Interactive)",
      };
    case "retest":
      return {
        play: "Re-test (Autonomous)",
        terminal: "Fix Issues (Interactive)",
      };
    case "verify":
      return {
        play: "Pre-verify core flow (Autonomous)",
        // Human Test'te terminal, çeklisti yürüten değil çeklistin dışına çıkan
        // oturumdur: gündemi kullanıcı getirir, kartta yazmayan bir şeydir.
        terminal: "Report an Issue (Interactive)",
      };
  }
}

/**
 * Human Test'te otonom koşu yalnızca temel akışı doğrular. Bu grubu ilan
 * etmeyen bir çeklistte agent hangi maddenin temel olduğunu bilemez, o yüzden
 * orada buton hiç çıkmaz — çıkarsa hiçbir şey işaretlemeyen bir koşu vaat eder.
 */
export function canPreVerify(card: Card, testProgress: TestProgress | null): boolean {
  return card.status === "test" && !!testProgress?.core;
}

export function canStartCard(card: Card): boolean {
  return !!(
    card.description &&
    (card.projectId || card.projectFolder) &&
    card.status !== "completed" &&
    card.status !== "ideation"
  );
}

/**
 * Otonom koşu Human Test'te yalnızca temel akışı doğrular, o yüzden core
 * grubuna bağlı. Interaktif oturum ise çeklistten bağımsızdır: çeklisti
 * olmayan bir kartta da kullanıcının anlatacak bir sorunu olabilir.
 */
export function canRunAutonomousFor(
  card: Card,
  testProgress: TestProgress | null
): boolean {
  return canStartCard(card) && (card.status !== "test" || canPreVerify(card, testProgress));
}

export function canTestTogetherFor(card: Card, testScenariosText: string): boolean {
  return (
    card.status === "test" &&
    !!(
      card.testScenarios &&
      testScenariosText !== "" &&
      (card.projectId || card.projectFolder)
    )
  );
}

/**
 * The body of the confirm dialog behind the Pre-verify button.
 *
 * A constant rather than two literals because the promise it makes — that your
 * own ticks survive the run — is the whole reason someone presses the button,
 * and a focus row promising something the board does not would make both
 * untrustworthy.
 */
export const VERIFY_RUN_BLURB =
  "The agent runs the core flow only and ticks the steps that pass. Later groups and your own ticks stay untouched.";
