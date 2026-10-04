"use client";

import { Fragment, useMemo, useState } from "react";
import {
  Brain,
  Check,
  ChevronDown,
  FileOutput,
  FlaskConical,
  ListPlus,
  ListVideo,
  Loader2,
  MessagesSquare,
  Minus,
  Play,
  Terminal,
  Unlock,
  X,
  Zap,
} from "lucide-react";
import { Card, DEFAULT_WORK_TEMPLATES, getDisplayId } from "@/lib/types";
import { openPredecessors } from "@/lib/card-group";
import { worktreeOverrideFor } from "@/lib/workspace";
import { toast } from "@/hooks/use-toast";
import { stripHtml } from "@/lib/prompts/utils";
import {
  canVerifyAllGroups,
  nextVerifyGroup,
  parseTestProgress,
  testGroupLabel,
  verifyTargets,
  type VerifyScope,
} from "@/lib/test-progress";
import {
  BOARD_PHASE_ACTIONS,
  getPhaseActionFlags,
  isAutonomousAction,
  isPhaseActionShown,
  PhaseAction,
  verifyRunBlurb,
} from "@/lib/card-phase";
import { resolveWorkTemplate } from "@/lib/work-templates";
import { useKanbanStore } from "@/lib/store";
import { Button } from "@/components/ui/button";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { Switch } from "@/components/ui/switch";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useCardQueueActions } from "./use-card-queue-actions";
import {
  getPasteTipTerminalLabel,
  getEffectiveTerminal,
  needsPasteTip,
  PasteTipDialog,
} from "./paste-tip-dialog";

/**
 * The buttons that move a card to its next phase, with the dialogs behind them.
 *
 * The board card was their only home, then Focus view grew a second copy for
 * its Human Test rows, and the two had already drifted by the time the card
 * modal needed a third. One component now owns the run logic — lock and
 * spinner signals, the worktree switch, the paste tip — and each surface only
 * says how it wants the buttons drawn.
 *
 * - `icon`: the board footer's row of small tinted icons.
 * - `labeled`: the card modal's footer, where the next step is the decision the
 *   screen exists for, so the primary action is spelled out ("Implement
 *   (Autonomous)") and the rest sit beside it as icons.
 */

// Which button leads when there is room for only one label. The autonomous run
// of the current phase comes first; an interactive one leads only where no
// autonomous run exists (re-test, Human Test without a core flow).
const PRIMARY_ORDER: PhaseAction[] = [
  "evaluate",
  "quick-fix",
  "generate",
  "play",
  "test-together",
  "terminal",
  "discuss",
];

const ICON_TINT: Record<PhaseAction, string> = {
  discuss: "bg-cyan-500/10 text-cyan-500/70 hover:bg-cyan-500/20 hover:text-cyan-500",
  evaluate: "bg-ink/10 text-ink/70 hover:bg-ink/20 hover:text-ink",
  "quick-fix": "bg-yellow-500/10 text-yellow-500/70 hover:bg-yellow-500/20 hover:text-yellow-500",
  terminal: "bg-orange-500/10 text-orange-500/70 hover:bg-orange-500/20 hover:text-orange-500",
  play: "bg-ink/10 text-ink/70 hover:bg-ink/20 hover:text-ink",
  "test-together":
    "bg-emerald-500/10 text-emerald-500/70 hover:bg-emerald-500/20 hover:text-emerald-500",
  generate: "bg-violet-500/10 text-violet-500/70 hover:bg-violet-500/20 hover:text-violet-500",
};

// Labeled buttons keep the colour of the icon they stand in for. The icon and
// text inherit currentColor, so hover never leaves them on a muted tone.
const PRIMARY_CLASS: Record<PhaseAction, string> = {
  discuss: "bg-cyan-500 text-white hover:bg-cyan-600",
  evaluate: "",
  "quick-fix": "bg-yellow-500 text-black hover:bg-yellow-600",
  terminal: "bg-orange-500 text-white hover:bg-orange-600",
  play: "",
  "test-together": "bg-emerald-500 text-white hover:bg-emerald-600",
  generate: "bg-violet-500 text-white hover:bg-violet-600",
};

// Only emptiness matters here, and an editor-cleared field can be a lone
// &nbsp; — the board's own stripper counts that as empty, so this must too.
const plainText = (html: string) => stripHtml((html || "").replace(/&nbsp;/g, " "));

const ACTION_ICON: Record<PhaseAction, typeof Play> = {
  discuss: MessagesSquare,
  evaluate: Brain,
  "quick-fix": Zap,
  terminal: Terminal,
  play: Play,
  "test-together": FlaskConical,
  generate: FileOutput,
};

const CHAT_RUNNING_TOOLTIP = "Chat is running on this card";
const QUEUED_TOOLTIP = "Queued, will run automatically";

/**
 * Whether an in-app chat is streaming on this card. Kept apart from the lock:
 * a locked card offers Unlock, and Unlock would not stop a chat. The local
 * stream covers this tab at once; the registry covers chats started from
 * another tab or over MCP, a poll later.
 */
export function useCardChatRunning(cardId: string) {
  const streamingHere = useKanbanStore((s) =>
    Object.values(s.streamingMessages).some((m) => m.cardId === cardId)
  );
  const chatInBg = useKanbanStore((s) =>
    s.backgroundProcesses.some(
      (p) => p.cardId === cardId && p.processType === "chat" && p.status === "running"
    )
  );
  return streamingHere || chatInBg;
}

interface CardPhaseActionsProps {
  card: Card;
  variant?: "icon" | "labeled";
  /** Which actions this surface offers, in the order it draws them. */
  actions?: PhaseAction[];
  /**
   * Runs before any action starts. The modal passes its auto-save flush here,
   * so a plan edited a moment ago is on disk before the agent reads it.
   * Returning false cancels the action.
   */
  beforeRun?: () => Promise<boolean>;
  /**
   * Called once an action has passed the flush and its dialog and is on its
   * way out — to a terminal or a background run. `run` settles when the store
   * action does. The modal uses it to close itself; surfaces that stay put
   * leave it unset.
   */
  onHandOff?: (handOff: PhaseHandOff) => void;
  softLock?: boolean;
  /**
   * Drawn in Play's place while the card waits in the run queue. The board
   * card passes its queue chip: a dimmed Play only says "not now", the chip
   * says when. Surfaces that pass nothing keep the dimmed icon.
   */
  queuedSlot?: React.ReactNode;
}

// `stopped` marks a run you killed: not a success, but nothing to report either.
export type RunResult = { success: boolean; error?: string; stopped?: boolean };

export interface PhaseHandOff {
  action: PhaseAction;
  /** The button's label, without the "(Autonomous)" suffix. */
  label: string;
  run: Promise<RunResult>;
}

/**
 * The failure toast for a run that did not start. Shared by every surface:
 * the modal calls it from its onHandOff, and the board card and Focus view,
 * which pass none, get it from handOff itself — before, their failures only
 * reached the console.
 */
export function reportRunFailure(cardId: string, label: string, error?: string) {
  // A 409 for untrusted content is a question, not a failure: the app-level
  // dialog is already asking it.
  if (useKanbanStore.getState().pendingRunConfirmation?.cardId === cardId) return;
  toast({
    variant: "destructive",
    title: `${label} failed`,
    description: error || "Nothing was changed on the card.",
  });
}

// The brain icon's corner badge: green = do it, amber = let's talk, red = don't.
// An opinion whose verdict could not be read gets a plain grey dot, not a tick.
const VERDICT_BADGE = {
  positive: { bg: "bg-green-500", Icon: Check, label: "Yes" },
  maybe: { bg: "bg-amber-500", Icon: Minus, label: "Maybe" },
  negative: { bg: "bg-red-500", Icon: X, label: "No" },
} as const;

export function CardPhaseActions({
  card,
  variant = "icon",
  actions = BOARD_PHASE_ACTIONS,
  beforeRun,
  onHandOff,
  softLock,
  queuedSlot,
}: CardPhaseActionsProps) {
  // Narrow selectors: boolean membership checks re-render only when THIS
  // card's flag flips, not on every fetchCards poll replacing the array.
  const projects = useKanbanStore((s) => s.projects);
  const settings = useKanbanStore((s) => s.settings);
  const startTask = useKanbanStore((s) => s.startTask);
  const openTerminal = useKanbanStore((s) => s.openTerminal);
  const openIdeationTerminal = useKanbanStore((s) => s.openIdeationTerminal);
  const openTestTerminal = useKanbanStore((s) => s.openTestTerminal);
  const quickFixTask = useKanbanStore((s) => s.quickFixTask);
  const evaluateIdea = useKanbanStore((s) => s.evaluateIdea);
  const generateTask = useKanbanStore((s) => s.generateTask);
  const settingsTemplates = useKanbanStore((s) => s.settings?.workTemplates);
  const updateCard = useKanbanStore((s) => s.updateCard);
  const unlockCard = useKanbanStore((s) => s.unlockCard);
  const startingLocal = useKanbanStore((s) => s.startingCardIds.includes(card.id));
  const quickFixingLocal = useKanbanStore((s) => s.quickFixingCardIds.includes(card.id));
  const evaluatingLocal = useKanbanStore((s) => s.evaluatingCardIds.includes(card.id));
  const generatingLocal = useKanbanStore((s) => s.generatingCardIds.includes(card.id));
  const lockedLocal = useKanbanStore((s) => s.lockedCardIds.includes(card.id));
  // Third signal: the server-side backgroundProcesses list. Covers the edge
  // case where neither local trigger state nor persisted processingType
  // reflects an in-flight run (e.g. spawn from MCP / another session).
  const autonomousInBg = useKanbanStore((s) =>
    s.backgroundProcesses.some(
      (p) => p.cardId === card.id && p.processType === "autonomous" && p.status === "running"
    )
  );
  const quickFixInBg = useKanbanStore((s) =>
    s.backgroundProcesses.some(
      (p) => p.cardId === card.id && p.processType === "quick-fix" && p.status === "running"
    )
  );
  const evaluateInBg = useKanbanStore((s) =>
    s.backgroundProcesses.some(
      (p) => p.cardId === card.id && p.processType === "evaluate" && p.status === "running"
    )
  );
  const generateInBg = useKanbanStore((s) =>
    s.backgroundProcesses.some(
      (p) => p.cardId === card.id && p.processType === "generate" && p.status === "running"
    )
  );

  const isChatting = useCardChatRunning(card.id);

  const [showQuickFixConfirm, setShowQuickFixConfirm] = useState(false);
  const [showTerminalConfirm, setShowTerminalConfirm] = useState(false);
  const [showIdeationConfirm, setShowIdeationConfirm] = useState(false);
  const [showAutonomousConfirm, setShowAutonomousConfirm] = useState(false);
  const [showTestTogetherConfirm, setShowTestTogetherConfirm] = useState(false);
  const [showGenerateConfirm, setShowGenerateConfirm] = useState(false);
  const [dialogUseWorktree, setDialogUseWorktree] = useState(true);
  // Pre-verify's reach for this press. Back to the next group on every open:
  // walking everything is a choice made each time, never a sticky default.
  const [dialogVerifyScope, setDialogVerifyScope] = useState<VerifyScope>("next");
  // Covers the flush in beforeRun, so a double click cannot start two runs.
  const [isPreparing, setIsPreparing] = useState(false);

  const solutionText = useMemo(() => plainText(card.solutionSummary), [card.solutionSummary]);
  const testText = useMemo(() => plainText(card.testScenarios), [card.testScenarios]);
  const testProgress = useMemo(() => parseTestProgress(card.testScenarios), [card.testScenarios]);
  const hasAiOpinion = useMemo(() => !!plainText(card.aiOpinion), [card.aiOpinion]);

  const project = projects.find((p) => p.id === card.projectId);
  const projectMode = project?.mode ?? "development";
  const flags = getPhaseActionFlags(card, solutionText, testText, testProgress, projectMode);
  const { phase, labels: phaseLabels } = flags;
  // Same rules as the board card's context menu, from the same hook.
  const queue = useCardQueueActions({ card, flags, project, testProgress });
  // The group Pre-verify starts with, and the ones "all remaining groups" adds.
  const verifyGroup = phase === "verify" ? nextVerifyGroup(testProgress) : null;
  const canVerifyAll = phase === "verify" && canVerifyAllGroups(testProgress);
  const remainingVerifyGroups = canVerifyAll ? verifyTargets(testProgress, "all") : [];

  // Three independent signals converge so the spinner is robust: local
  // trigger state (instant), persisted processingType (DB), and the
  // server-side backgroundProcesses list (catches cross-session spawns).
  const isStarting = startingLocal || card.processingType === "autonomous" || autonomousInBg;
  const isQuickFixing = quickFixingLocal || card.processingType === "quick-fix" || quickFixInBg;
  const isEvaluating = evaluatingLocal || card.processingType === "evaluate" || evaluateInBg;
  const isGenerating = generatingLocal || card.processingType === "generate" || generateInBg;
  const isLocked = lockedLocal || !!card.processingType || !!softLock;
  // Background processing = auto unlock when done, no manual unlock needed
  const isBackgroundProcessing = isStarting || isQuickFixing || isEvaluating || isGenerating;
  const workTemplate = resolveWorkTemplate(
    settingsTemplates ?? DEFAULT_WORK_TEMPLATES,
    card.workTemplateId
  );
  // A running chat blocks the same buttons a lock does, without offering Unlock.
  const isBlocked = isLocked || isChatting;
  // The queue starts this card's run itself; a manual Play (Pre-verify on a
  // Human Test card) would only be refused with a 409. Once the run is live
  // the spinner takes over, even if the poll still lists the card.
  const isQueued = queue.rank > 0 && !isStarting;

  const projectPath = project?.folderPath || card.projectFolder;
  const projectDefaultWorktree = project?.useWorktrees ?? true;
  const { effectiveUseWorktree } = queue;

  // Calculate expected worktree path for implementation phase
  const getExpectedWorktreePath = () => {
    if (!projectPath) return null;
    // Use existing worktree path if available
    if (card.gitWorktreePath) return card.gitWorktreePath;
    // Calculate expected path based on task number
    if (card.taskNumber && project) {
      const branchName = `${project.idPrefix}-${card.taskNumber}`;
      return `${projectPath}/.worktrees/kanban/${branchName}`;
    }
    return null;
  };
  const expectedWorktreePath = getExpectedWorktreePath();
  // cmux embeds Ghostty but does not inherit its paste confirmation (verified
  // in real use), so it stays out of this gate.
  const needsPasteConfirm = needsPasteTip(settings);
  const pasteTipTerminalLabel = getPasteTipTerminalLabel(getEffectiveTerminal(settings));

  const prepare = async () => {
    if (!beforeRun) return true;
    setIsPreparing(true);
    try {
      return await beforeRun();
    } finally {
      setIsPreparing(false);
    }
  };

  // Queueing starts no run, so nothing is handed off and the modal stays
  // open. The flush still comes first: the server reads the saved card to
  // decide the phase, and a plan pasted a moment ago must already count.
  const handleAddToQueue = async (useWorktree?: boolean, verifyScope?: VerifyScope) => {
    if (isPreparing || !(await prepare())) return;
    await queue.add(useWorktree, undefined, verifyScope);
  };

  // Every handler reaches here only after prepare() and its dialog agreed, so
  // a failed flush never tells the surface the card is gone.
  const handOff = <T extends RunResult>(action: PhaseAction, run: Promise<T>) => {
    const label = shortLabel(action);
    if (onHandOff) {
      onHandOff({ action, label, run });
    } else {
      void run.then((result) => {
        if (!result.success && !result.stopped) reportRunFailure(card.id, label, result.error);
      });
    }
    return run;
  };

  // A click that cannot go anywhere says why instead of doing nothing. The
  // board hides interactive buttons while blocked, but a lock can land between
  // render and click, and the modal's buttons stay drawn through a flush.
  const explainBlocked = (): boolean => {
    if (isChatting) {
      toast({ title: "Chat is running", description: "Wait for the chat on this card to finish." });
      return true;
    }
    if (isLocked) {
      toast({
        title: "Card is locked",
        description: softLock
          ? "Someone else is working on this card."
          : "A session is open on this card. Unlock it once that session is done.",
      });
      return true;
    }
    if (isPreparing) {
      toast({ title: "Still saving", description: "Try again once the card is saved." });
      return true;
    }
    return false;
  };

  // prepare() and the store action both resolve on the happy path; a throw in
  // either used to vanish behind the click handlers' `void`.
  const runInteractive = async (action: PhaseAction, start: () => Promise<RunResult>) => {
    try {
      if (!(await prepare())) return;
      const result = await handOff(action, start());
      if (!result.success) {
        console.error(`Failed to open ${action} terminal:`, result.error);
      }
    } catch (error) {
      console.error(`Failed to open ${action} terminal:`, error);
      reportRunFailure(card.id, shortLabel(action), error instanceof Error ? error.message : undefined);
    }
  };

  // Starting a card out of chain order is allowed — a hard gate would lock a
  // whole chain behind one card parked in Human Test — but it should be a
  // decision, so the start dialog names what is being skipped. Computed on
  // click from the store rather than subscribed to: the board card renders
  // this component, and a cards selector here would re-render every card on
  // every poll for a line that only exists inside a dialog.
  //
  // Implementation only. Planning a whole chain in one sitting is the normal
  // way to work, and there every card after the first would warn.
  //
  // The warning is advice, so it never gets to block the start: a throw in
  // here — a stale dev-server module after a merge (IDE-373), a bad groupOrder
  // — drops the line and the run goes ahead.
  const [chainWarning, setChainWarning] = useState<string | null>(null);
  const computeChainWarning = (): string | null => {
    if (phase !== "implementation" || !card.groupId) return null;
    try {
      const { cards } = useKanbanStore.getState();
      const ahead = openPredecessors(
        cards.filter((c) => c.groupId === card.groupId),
        card
      );
      if (ahead.length === 0) return null;
      const ids = ahead.map(
        (c) => getDisplayId(c, projects.find((p) => p.id === c.projectId)) ?? c.title
      );
      const shown = ids.slice(0, 3).join(", ") + (ids.length > 3 ? ` +${ids.length - 3}` : "");
      return `${ahead.length} open card${ahead.length === 1 ? "" : "s"} ahead in the chain: ${shown}`;
    } catch (error) {
      console.warn("Chain warning skipped:", error);
      return null;
    }
  };

  // The board card opens the modal on click; a button inside it must not.
  const stop = (e?: React.MouseEvent) => e?.stopPropagation();
  const stopEvent = (e: React.SyntheticEvent) => e.stopPropagation();

  const handleStartClick = async (e?: React.MouseEvent) => {
    stop(e);
    if (isBlocked || isStarting || isQueued || isPreparing || !flags.canRunAutonomous) return;
    if (!(await prepare())) return;
    setDialogUseWorktree(effectiveUseWorktree);
    setDialogVerifyScope("next");
    setChainWarning(computeChainWarning());
    setShowAutonomousConfirm(true);
  };

  const handleStart = async () => {
    setShowAutonomousConfirm(false);
    if (isStarting || !flags.canRunAutonomous) return;

    // Persist per-card override only when it diverges from project default.
    // Matching the project default clears the override (back to "follow project").
    if (phase === "implementation") {
      const desiredOverride = worktreeOverrideFor(dialogUseWorktree, projectDefaultWorktree);
      if (desiredOverride !== (card.useWorktree ?? null)) {
        await updateCard(card.id, { useWorktree: desiredOverride });
      }
    }

    const verifyScope = phase === "verify" && canVerifyAll ? dialogVerifyScope : undefined;
    const result = await handOff("play", startTask(card.id, false, verifyScope));
    if (!result.success) {
      console.error("Failed to start task:", result.error);
    }
  };

  const handleQuickFixClick = async (e?: React.MouseEvent) => {
    stop(e);
    if (isBlocked || isPreparing || !flags.canQuickFix) return;
    if (!(await prepare())) return;
    setDialogUseWorktree(effectiveUseWorktree);
    setShowQuickFixConfirm(true);
  };

  const handleQuickFix = async () => {
    setShowQuickFixConfirm(false);
    if (isQuickFixing || !flags.canQuickFix) return;

    // Persist per-card override only when it diverges from project default.
    const desiredOverride = worktreeOverrideFor(dialogUseWorktree, projectDefaultWorktree);
    if (desiredOverride !== (card.useWorktree ?? null)) {
      await updateCard(card.id, { useWorktree: desiredOverride });
    }

    const result = await handOff("quick-fix", quickFixTask(card.id));
    if (!result.success) {
      console.error("Failed to quick fix:", result.error);
    }
  };

  const handleEvaluate = async (e?: React.MouseEvent) => {
    stop(e);
    if (isBlocked || isEvaluating || isPreparing || !flags.canEvaluate) return;
    if (!(await prepare())) return;

    const result = await handOff("evaluate", evaluateIdea(card.id));
    if (!result.success) {
      console.error("Failed to evaluate idea:", result.error);
    }
  };

  const handleGenerateClick = async (e?: React.MouseEvent) => {
    stop(e);
    if (isBlocked || isGenerating || isPreparing || !flags.canGenerate) return;
    if (!(await prepare())) return;
    setShowGenerateConfirm(true);
  };

  const handleGenerate = async () => {
    setShowGenerateConfirm(false);
    if (isGenerating || !flags.canGenerate) return;
    const result = await handOff("generate", generateTask(card.id));
    if (!result.success) {
      console.error("Failed to generate:", result.error);
    }
  };

  // Interactive sessions flush right before the terminal opens — after the
  // paste tip, so a tip left open for a minute cannot outlive a later edit.
  const handleOpenTerminal = async () => {
    setShowTerminalConfirm(false);
    await runInteractive("terminal", () => openTerminal(card.id));
  };

  const handleOpenIdeationTerminal = async () => {
    setShowIdeationConfirm(false);
    await runInteractive("discuss", () => openIdeationTerminal(card.id));
  };

  const handleOpenTestTerminal = async () => {
    setShowTestTogetherConfirm(false);
    await runInteractive("test-together", () => openTestTerminal(card.id));
  };

  const handleOpenTerminalClick = (e?: React.MouseEvent) => {
    stop(e);
    if (explainBlocked() || !flags.canStart) return;
    const warning = computeChainWarning();
    setChainWarning(warning);
    if (needsPasteConfirm) {
      setShowTerminalConfirm(true);
      return;
    }
    // No dialog to carry the line on this path, so it rides a toast instead —
    // after the fact, but still before any work lands.
    if (warning) toast({ title: "Out of chain order", description: warning });
    void handleOpenTerminal();
  };

  const handleOpenIdeationTerminalClick = (e?: React.MouseEvent) => {
    stop(e);
    if (explainBlocked() || !flags.canEvaluate) return;
    if (needsPasteConfirm) setShowIdeationConfirm(true);
    else void handleOpenIdeationTerminal();
  };

  const handleTestTogetherClick = (e?: React.MouseEvent) => {
    stop(e);
    if (explainBlocked() || !flags.canTestTogether) return;
    if (needsPasteConfirm) setShowTestTogetherConfirm(true);
    else void handleOpenTestTerminal();
  };

  const onAction: Record<PhaseAction, (e?: React.MouseEvent) => void> = {
    discuss: handleOpenIdeationTerminalClick,
    evaluate: handleEvaluate,
    "quick-fix": handleQuickFixClick,
    terminal: handleOpenTerminalClick,
    play: handleStartClick,
    "test-together": handleTestTogetherClick,
    generate: handleGenerateClick,
  };

  const verdictBadge = card.aiVerdict ? VERDICT_BADGE[card.aiVerdict] : null;

  const tooltipFor = (action: PhaseAction): string => {
    switch (action) {
      case "discuss":
        return "Discuss Idea (Interactive)";
      case "evaluate":
        if (isEvaluating) return "Evaluating...";
        if (!hasAiOpinion) return "Evaluate Idea";
        if (!verdictBadge) return "Re-evaluate Idea";
        // The score only labels the verdict; the badge colour stays the word's.
        return `Re-evaluate Idea · Verdict: ${verdictBadge.label}${card.aiScore !== null && card.aiScore !== undefined ? ` · ${card.aiScore}/10` : ""}`;
      case "quick-fix":
        return isQuickFixing ? "Quick fixing..." : "Quick Fix (No Plan)";
      case "terminal":
        return phaseLabels.terminal;
      case "play":
        return isStarting ? "Running..." : phaseLabels.play;
      case "test-together":
        return "Test Together (Interactive)";
      case "generate":
        return isGenerating ? "Generating..." : `Generate (${workTemplate.name})`;
    }
  };

  const labelFor = (action: PhaseAction): string => {
    switch (action) {
      case "discuss":
        return "Discuss Idea";
      case "evaluate":
        return hasAiOpinion ? "Re-evaluate Idea" : "Evaluate Idea";
      case "quick-fix":
        return "Quick Fix";
      case "terminal":
        return phaseLabels.terminal;
      case "play":
        return phaseLabels.play;
      case "test-together":
        return "Test Together";
      case "generate":
        return "Generate";
    }
  };

  // Toast titles read "Implement failed", not "Implement (Interactive) failed".
  const shortLabel = (action: PhaseAction) =>
    labelFor(action).replace(/ \((Autonomous|Interactive)\)$/, "");

  // --- Board-sized icon, identical to the footer row it came from ---
  const renderIcon = (action: PhaseAction) => {
    const running =
      (action === "play" && isStarting) ||
      (action === "quick-fix" && isQuickFixing) ||
      (action === "evaluate" && isEvaluating) ||
      (action === "generate" && isGenerating);
    // Autonomous buttons stay drawn while locked, as a spinner or a dimmed
    // icon; interactive ones are not shown at all then.
    const autonomous = isAutonomousAction(action);
    const queued = action === "play" && isQueued;
    const dimmed = (autonomous && isBlocked && !running) || queued;

    let className = ICON_TINT[action];
    if (running) {
      className =
        action === "quick-fix" ? "bg-yellow-500/20 text-yellow-500 cursor-wait" : "bg-ink/20 text-ink cursor-wait";
    } else if (dimmed) {
      className =
        action === "quick-fix"
          ? "bg-yellow-500/10 text-yellow-500/30 cursor-not-allowed"
          : "bg-ink/10 text-ink/30 cursor-not-allowed";
    }

    const Icon = ACTION_ICON[action];
    return (
      <Tooltip key={action}>
        <TooltipTrigger asChild>
          <button
            type="button"
            onClick={onAction[action]}
            disabled={autonomous ? running || isBlocked || queued : undefined}
            className={`p-1 rounded transition-colors ${className}`}
          >
            {running ? (
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
            ) : action === "evaluate" ? (
              <div className="relative">
                <Brain className="w-3.5 h-3.5" />
                {hasAiOpinion && (
                  <span
                    className={`absolute -bottom-1 -right-1 flex items-center justify-center w-2.5 h-2.5 rounded-full ${
                      verdictBadge?.bg ?? "bg-muted-foreground/60"
                    }`}
                  >
                    {verdictBadge && (
                      <verdictBadge.Icon className="w-1.5 h-1.5 text-white" strokeWidth={4} />
                    )}
                  </span>
                )}
              </div>
            ) : (
              <Icon className="w-3.5 h-3.5" />
            )}
          </button>
        </TooltipTrigger>
        <TooltipContent side="top">
          {dimmed && isChatting
            ? CHAT_RUNNING_TOOLTIP
            : queued
              ? QUEUED_TOOLTIP
              : tooltipFor(action)}
        </TooltipContent>
      </Tooltip>
    );
  };

  const renderIcons = () => {
    const shown = actions.filter((action) => isPhaseActionShown(action, flags, isBlocked));
    if (!queuedSlot) return shown.map(renderIcon);
    const icons = shown.map((action) =>
      action === "play" ? <Fragment key="play">{queuedSlot}</Fragment> : renderIcon(action)
    );
    // A queued card whose phase draws no Play still has to say it is queued.
    return shown.includes("play") ? icons : [...icons, <Fragment key="play">{queuedSlot}</Fragment>];
  };

  // --- Modal footer: one spelled-out primary, the rest as icons ---
  const renderLabeled = () => {
    if (isBackgroundProcessing) {
      return (
        <Button size="sm" disabled className="disabled:opacity-100 cursor-wait">
          <Loader2 className="animate-spin" />
          {isEvaluating
            ? "Evaluating..."
            : isQuickFixing
              ? "Quick fixing..."
              : isGenerating
                ? "Generating..."
                : "Running..."}
        </Button>
      );
    }

    // After a background run (it keeps its own "Running..."), before the lock:
    // once the chat ends, an open terminal session shows its Unlock again.
    if (isChatting) {
      return (
        <Tooltip>
          <TooltipTrigger asChild>
            {/* A disabled button swallows hover, so the span carries the tooltip. */}
            <span tabIndex={0} className="cursor-wait">
              <Button size="sm" disabled className="disabled:opacity-100 pointer-events-none">
                <Loader2 className="animate-spin" />
                Chat running...
              </Button>
            </span>
          </TooltipTrigger>
          <TooltipContent side="top">{CHAT_RUNNING_TOOLTIP}</TooltipContent>
        </Tooltip>
      );
    }

    if (isLocked) {
      // A soft lock belongs to someone else — nothing here can release it.
      if (softLock) return null;
      return (
        <div className="flex items-center gap-2">
          <span className="text-xs text-muted-foreground">Session open</span>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                size="sm"
                variant="outline"
                onClick={() => unlockCard(card.id)}
                className="border-orange-500/40 text-orange-500 hover:bg-orange-500/10 hover:text-orange-600"
              >
                <Unlock />
                Unlock
              </Button>
            </TooltipTrigger>
            <TooltipContent side="top">
              Release the card once the terminal session is done
            </TooltipContent>
          </Tooltip>
        </div>
      );
    }

    const shown = actions.filter((action) => isPhaseActionShown(action, flags, false));
    const primary = PRIMARY_ORDER.find((action) => shown.includes(action));
    if (!primary) return null;
    const secondary = shown.filter((action) => action !== primary);
    const PrimaryIcon = ACTION_ICON[primary];

    return (
      <div className="flex items-center gap-1.5">
        {secondary.map((action) => {
          const Icon = ACTION_ICON[action];
          const queued = action === "play" && isQueued;
          const tooltip = queued ? QUEUED_TOOLTIP : tooltipFor(action);
          return (
            <Tooltip key={action}>
              <TooltipTrigger asChild>
                {/* A disabled button swallows hover, so the span carries the tooltip. */}
                <span tabIndex={queued ? 0 : undefined} className={queued ? "cursor-not-allowed" : undefined}>
                  <button
                    type="button"
                    onClick={onAction[action]}
                    disabled={isPreparing || queued}
                    aria-label={tooltip}
                    className={`h-8 w-8 grid place-items-center rounded-md transition-colors disabled:opacity-50 ${ICON_TINT[action]} ${queued ? "pointer-events-none" : ""}`}
                  >
                    <Icon className="w-4 h-4" />
                  </button>
                </span>
              </TooltipTrigger>
              <TooltipContent side="top">{tooltip}</TooltipContent>
            </Tooltip>
          );
        })}
        {primary === "play" && isQueued ? (
          <Tooltip>
            <TooltipTrigger asChild>
              <span tabIndex={0} className="cursor-not-allowed">
                <Button size="sm" disabled className="pointer-events-none">
                  <ListVideo />
                  Queued
                </Button>
              </span>
            </TooltipTrigger>
            <TooltipContent side="top">{QUEUED_TOOLTIP}</TooltipContent>
          </Tooltip>
        ) : primary === "play" && (queue.canQueueImplementation || queue.canQueueVerify) ? (
          // A chevron on the primary, not another button: the footer already
          // holds Delete, Withdraw and the icons. The main half still runs now.
          <div className="flex items-center">
            <Button
              size="sm"
              onClick={onAction[primary]}
              disabled={isPreparing}
              className={`rounded-r-none ${PRIMARY_CLASS[primary]}`}
            >
              {isPreparing ? <Loader2 className="animate-spin" /> : <PrimaryIcon />}
              {/* A group heading can be long; the full label is in the title. */}
              <span className="truncate max-w-[18rem]" title={labelFor(primary)}>
                {labelFor(primary)}
              </span>
            </Button>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  size="sm"
                  disabled={isPreparing}
                  aria-label="More ways to run"
                  className={`rounded-l-none border-l border-primary-foreground/20 px-1.5 ${PRIMARY_CLASS[primary]}`}
                >
                  <ChevronDown />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" side="top" className="w-56">
                {queue.canQueueVerifyAll && queue.verifyGroup ? (
                  <>
                    <DropdownMenuItem onSelect={() => void handleAddToQueue(undefined, "next")}>
                      <ListPlus />
                      <span className="line-clamp-2">Add to queue: {testGroupLabel(queue.verifyGroup)}</span>
                    </DropdownMenuItem>
                    <DropdownMenuItem onSelect={() => void handleAddToQueue(undefined, "all")}>
                      <ListPlus />
                      Add to queue: all remaining groups
                    </DropdownMenuItem>
                  </>
                ) : queue.canQueueVerify ? (
                  <DropdownMenuItem onSelect={() => void handleAddToQueue()}>
                    <ListPlus />
                    <span className="line-clamp-2">
                      {queue.verifyGroup ? `Add to queue: ${testGroupLabel(queue.verifyGroup)}` : "Add to queue (pre-verify)"}
                    </span>
                  </DropdownMenuItem>
                ) : (
                  <DropdownMenuSub>
                    <DropdownMenuSubTrigger>
                      <ListPlus />
                      Add to queue
                    </DropdownMenuSubTrigger>
                    <DropdownMenuSubContent className="w-56">
                      {queue.branchChoices.map((choice) => (
                        <DropdownMenuItem
                          key={choice.label}
                          onSelect={() => void handleAddToQueue(choice.useWorktree)}
                        >
                          <Check
                            className={`text-current ${
                              choice.useWorktree === effectiveUseWorktree ? "" : "invisible"
                            }`}
                          />
                          {choice.label}
                        </DropdownMenuItem>
                      ))}
                    </DropdownMenuSubContent>
                  </DropdownMenuSub>
                )}
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        ) : (
          <Button
            size="sm"
            onClick={onAction[primary]}
            disabled={isPreparing}
            className={PRIMARY_CLASS[primary]}
          >
            {isPreparing ? <Loader2 className="animate-spin" /> : <PrimaryIcon />}
            {labelFor(primary)}
          </Button>
        )}
      </div>
    );
  };

  return (
    <>
      {variant === "labeled"
        ? renderLabeled()
        : renderIcons()}

      {/* Dialogs portal out of the DOM but not out of the React tree, so
          their events would still bubble into the board card — opening the
          modal on Cancel, or starting a drag. `contents` keeps the wrapper
          out of the footer's flex layout. */}
      <span
        className="contents"
        onClick={stop}
        onPointerDown={stopEvent}
        onKeyDown={stopEvent}
        onContextMenu={stopEvent}
      >
      <AlertDialog open={showQuickFixConfirm} onOpenChange={setShowQuickFixConfirm}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Quick Fix Mode</AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-2">
                <p>Are you sure you want to start this card in quick-fix mode?</p>
                <p>
                  <strong className="text-amber-500">Warning:</strong> No plan will be written. This runs in autonomous mode with full file access.
                  After the bug fix is completed, the card will automatically be moved to the Human Test column.
                </p>
                <p className="text-muted-foreground text-sm">
                  Note: Test scenarios are auto-generated with basic placeholder checks; they are not manually authored for this card.
                </p>
                {dialogUseWorktree && expectedWorktreePath && (
                  <p className="text-cyan-500 text-xs font-mono">
                    {expectedWorktreePath.split('/').slice(-3).join('/')}
                  </p>
                )}
                {!dialogUseWorktree && (
                  <p className="text-gray-400 text-xs font-mono">
                    Working directly on main branch
                  </p>
                )}
                <div className="flex items-center justify-between pt-2 border-t border-border">
                  <div className="space-y-0.5">
                    <label className="text-sm font-medium">Use git worktree</label>
                    <p className="text-xs text-muted-foreground">
                      {dialogUseWorktree
                        ? "Isolated branch for this fix"
                        : "Work directly on main (flow mode)"}
                    </p>
                  </div>
                  <Switch
                    checked={dialogUseWorktree}
                    onCheckedChange={setDialogUseWorktree}
                  />
                </div>
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleQuickFix}
              className="bg-yellow-500 hover:bg-yellow-600 text-black"
            >
              Start Quick Fix
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={showGenerateConfirm} onOpenChange={setShowGenerateConfirm}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Generate with &ldquo;{workTemplate.name}&rdquo;?</AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-2">
                <p>
                  Runs autonomously with full file access and saves one {workTemplate.outputExt} file
                  in the project folder{workTemplate.skill ? <> using the <span className="font-mono">{workTemplate.skill}</span> skill</> : null}.
                </p>
                <p className="text-muted-foreground">
                  Once the file is saved the card moves to In Review with a review checklist. If no file is
                  saved, the card stays where it is and says why. Mail is only drafted, never sent.
                </p>
                <p className="text-muted-foreground text-xs">
                  Change the template on the card&apos;s Detail tab; edit templates in Settings.
                </p>
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleGenerate} className="bg-violet-500 hover:bg-violet-600 text-white">
              Generate
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <PasteTipDialog
        open={showTerminalConfirm}
        onOpenChange={setShowTerminalConfirm}
        title="Open Interactive Terminal"
        terminalLabel={pasteTipTerminalLabel}
        confirmLabel="Open Terminal"
        confirmClassName="bg-orange-500 hover:bg-orange-600"
        onConfirm={handleOpenTerminal}
      >
        {chainWarning && <p className="text-amber-500 text-xs">{chainWarning}</p>}
        {phase === "implementation" && projectMode !== "work" && (
          !effectiveUseWorktree ? (
            <p className="text-gray-400 text-xs font-mono">
              Working directly on main (worktrees disabled)
            </p>
          ) : expectedWorktreePath && (
            <p className="text-cyan-500 text-xs font-mono">
              Worktree: {expectedWorktreePath.split('/').slice(-3).join('/')}
            </p>
          )
        )}
      </PasteTipDialog>

      <PasteTipDialog
        open={showIdeationConfirm}
        onOpenChange={setShowIdeationConfirm}
        title="Interactive Ideation"
        terminalLabel={pasteTipTerminalLabel}
        confirmLabel="Start Discussion"
        confirmClassName="bg-cyan-500 hover:bg-cyan-600"
        onConfirm={handleOpenIdeationTerminal}
      />

      <PasteTipDialog
        open={showTestTogetherConfirm}
        onOpenChange={setShowTestTogetherConfirm}
        title="Test Together"
        lead="Start an interactive test session with Claude as your QA partner."
        terminalLabel={pasteTipTerminalLabel}
        confirmLabel="Start Testing"
        confirmClassName="bg-emerald-500 hover:bg-emerald-600"
        onConfirm={handleOpenTestTerminal}
      />

      <AlertDialog open={showAutonomousConfirm} onOpenChange={setShowAutonomousConfirm}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Start {phaseLabels.play}?</AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-2">
                <p>This will run in autonomous mode with full file access.</p>
                {chainWarning && phase === "implementation" && (
                  <p className="text-amber-500 text-xs">{chainWarning}</p>
                )}
                {phase === "planning" && (
                  <p className="text-muted-foreground">
                    The task will be analyzed and a solution plan will be written.
                  </p>
                )}
                {phase === "implementation" && (
                  <div className="space-y-2">
                    {dialogUseWorktree ? (
                      <>
                        <p className="text-amber-500">
                          Files in your project may be modified. A new worktree will be created automatically.
                        </p>
                        {expectedWorktreePath && (
                          <p className="text-cyan-500 text-xs font-mono">
                            {expectedWorktreePath.split('/').slice(-3).join('/')}
                          </p>
                        )}
                      </>
                    ) : (
                      <p className="text-amber-500">
                        Files in your project may be modified. Working directly on main branch.
                      </p>
                    )}
                    <div className="flex items-center justify-between pt-2 border-t border-border">
                      <div className="space-y-0.5">
                        <label className="text-sm font-medium">Use git worktree</label>
                        <p className="text-xs text-muted-foreground">
                          {dialogUseWorktree
                            ? "Isolated branch for this task"
                            : "Work directly on main (flow mode)"}
                        </p>
                      </div>
                      <Switch
                        checked={dialogUseWorktree}
                        onCheckedChange={setDialogUseWorktree}
                      />
                    </div>
                  </div>
                )}
                {phase === "retest" && (
                  <p className="text-muted-foreground">
                    Tests will be re-run and any issues will be fixed.
                  </p>
                )}
                {phase === "verify" && (
                  <div className="space-y-2">
                    <p className="text-muted-foreground">
                      {verifyRunBlurb(canVerifyAll ? dialogVerifyScope : "next", verifyGroup)}
                    </p>
                    {/* Only offered past the core flow, and only when more than
                        one group is left: with one, both choices are the same. */}
                    {canVerifyAll && (
                      <div className="flex items-center justify-between pt-2 border-t border-border">
                        <div className="space-y-0.5">
                          <label className="text-sm font-medium">All remaining groups</label>
                          <p className="text-xs text-muted-foreground">
                            {dialogVerifyScope === "all"
                              ? remainingVerifyGroups.map(testGroupLabel).join(", ")
                              : `This group only: ${verifyGroup ? testGroupLabel(verifyGroup) : ""}`}
                          </p>
                        </div>
                        <Switch
                          checked={dialogVerifyScope === "all"}
                          onCheckedChange={(checked) => setDialogVerifyScope(checked ? "all" : "next")}
                        />
                      </div>
                    )}
                  </div>
                )}
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleStart}>
              Start
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      </span>
    </>
  );
}
