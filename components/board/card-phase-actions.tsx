"use client";

import { useMemo, useState } from "react";
import {
  Brain,
  Check,
  FileOutput,
  FlaskConical,
  Loader2,
  MessagesSquare,
  Play,
  Terminal,
  Unlock,
  X,
  Zap,
} from "lucide-react";
import { Card } from "@/lib/types";
import { stripHtml } from "@/lib/prompts/utils";
import { parseTestProgress } from "@/lib/test-progress";
import {
  BOARD_PHASE_ACTIONS,
  getPhaseActionFlags,
  isPhaseActionShown,
  PhaseAction,
  VERIFY_RUN_BLURB,
} from "@/lib/card-phase";
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
  generate: "bg-ink/10 text-ink/70 hover:bg-ink/20 hover:text-ink",
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
  generate: "",
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
  softLock?: boolean;
}

export function CardPhaseActions({
  card,
  variant = "icon",
  actions = BOARD_PHASE_ACTIONS,
  beforeRun,
  softLock,
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
  const updateCard = useKanbanStore((s) => s.updateCard);
  const unlockCard = useKanbanStore((s) => s.unlockCard);
  const startingLocal = useKanbanStore((s) => s.startingCardIds.includes(card.id));
  const quickFixingLocal = useKanbanStore((s) => s.quickFixingCardIds.includes(card.id));
  const evaluatingLocal = useKanbanStore((s) => s.evaluatingCardIds.includes(card.id));
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

  const [showQuickFixConfirm, setShowQuickFixConfirm] = useState(false);
  const [showTerminalConfirm, setShowTerminalConfirm] = useState(false);
  const [showIdeationConfirm, setShowIdeationConfirm] = useState(false);
  const [showAutonomousConfirm, setShowAutonomousConfirm] = useState(false);
  const [showTestTogetherConfirm, setShowTestTogetherConfirm] = useState(false);
  const [dialogUseWorktree, setDialogUseWorktree] = useState(true);
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

  // Three independent signals converge so the spinner is robust: local
  // trigger state (instant), persisted processingType (DB), and the
  // server-side backgroundProcesses list (catches cross-session spawns).
  const isStarting = startingLocal || card.processingType === "autonomous" || autonomousInBg;
  const isQuickFixing = quickFixingLocal || card.processingType === "quick-fix" || quickFixInBg;
  const isEvaluating = evaluatingLocal || card.processingType === "evaluate" || evaluateInBg;
  const isLocked = lockedLocal || !!card.processingType || !!softLock;
  // Background processing = auto unlock when done, no manual unlock needed
  const isBackgroundProcessing = isStarting || isQuickFixing || isEvaluating;

  const projectPath = project?.folderPath || card.projectFolder;
  const projectDefaultWorktree = project?.useWorktrees ?? true;
  const effectiveUseWorktree = card.useWorktree ?? projectDefaultWorktree;

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

  // The board card opens the modal on click; a button inside it must not.
  const stop = (e?: React.MouseEvent) => e?.stopPropagation();
  const stopEvent = (e: React.SyntheticEvent) => e.stopPropagation();

  const handleStartClick = async (e?: React.MouseEvent) => {
    stop(e);
    if (isLocked || isStarting || isPreparing || !flags.canRunAutonomous) return;
    if (!(await prepare())) return;
    setDialogUseWorktree(effectiveUseWorktree);
    setShowAutonomousConfirm(true);
  };

  const handleStart = async () => {
    setShowAutonomousConfirm(false);
    if (isStarting || !flags.canRunAutonomous) return;

    // Persist per-card override only when it diverges from project default.
    // Matching the project default clears the override (back to "follow project").
    if (phase === "implementation") {
      const desiredOverride =
        dialogUseWorktree === projectDefaultWorktree ? null : dialogUseWorktree;
      if (desiredOverride !== (card.useWorktree ?? null)) {
        await updateCard(card.id, { useWorktree: desiredOverride });
      }
    }

    const result = await startTask(card.id);
    if (!result.success) {
      console.error("Failed to start task:", result.error);
    }
  };

  const handleQuickFixClick = async (e?: React.MouseEvent) => {
    stop(e);
    if (isLocked || isPreparing || !flags.canQuickFix) return;
    if (!(await prepare())) return;
    setDialogUseWorktree(effectiveUseWorktree);
    setShowQuickFixConfirm(true);
  };

  const handleQuickFix = async () => {
    setShowQuickFixConfirm(false);
    if (isQuickFixing || !flags.canQuickFix) return;

    // Persist per-card override only when it diverges from project default.
    const desiredOverride =
      dialogUseWorktree === projectDefaultWorktree ? null : dialogUseWorktree;
    if (desiredOverride !== (card.useWorktree ?? null)) {
      await updateCard(card.id, { useWorktree: desiredOverride });
    }

    const result = await quickFixTask(card.id);
    if (!result.success) {
      console.error("Failed to quick fix:", result.error);
    }
  };

  const handleEvaluate = async (e?: React.MouseEvent) => {
    stop(e);
    if (isLocked || isEvaluating || isPreparing || !flags.canEvaluate) return;
    if (!(await prepare())) return;

    const result = await evaluateIdea(card.id);
    if (!result.success) {
      console.error("Failed to evaluate idea:", result.error);
    }
  };

  // Interactive sessions flush right before the terminal opens — after the
  // paste tip, so a tip left open for a minute cannot outlive a later edit.
  const handleOpenTerminal = async () => {
    setShowTerminalConfirm(false);
    if (!(await prepare())) return;

    const result = await openTerminal(card.id);
    if (!result.success) {
      console.error("Failed to open terminal:", result.error);
    }
  };

  const handleOpenIdeationTerminal = async () => {
    setShowIdeationConfirm(false);
    if (!(await prepare())) return;

    const result = await openIdeationTerminal(card.id);
    if (!result.success) {
      console.error("Failed to open ideation terminal:", result.error);
    }
  };

  const handleOpenTestTerminal = async () => {
    setShowTestTogetherConfirm(false);
    if (!(await prepare())) return;

    const result = await openTestTerminal(card.id);
    if (!result.success) {
      console.error("Failed to open test terminal:", result.error);
    }
  };

  const handleOpenTerminalClick = (e?: React.MouseEvent) => {
    stop(e);
    if (isLocked || isPreparing || !flags.canStart) return;
    if (needsPasteConfirm) setShowTerminalConfirm(true);
    else void handleOpenTerminal();
  };

  const handleOpenIdeationTerminalClick = (e?: React.MouseEvent) => {
    stop(e);
    if (isLocked || isPreparing || !flags.canEvaluate) return;
    if (needsPasteConfirm) setShowIdeationConfirm(true);
    else void handleOpenIdeationTerminal();
  };

  const handleTestTogetherClick = (e?: React.MouseEvent) => {
    stop(e);
    if (isLocked || isPreparing || !flags.canTestTogether) return;
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
    // No route yet; canGenerate keeps the button from being drawn.
    generate: () => {},
  };

  const tooltipFor = (action: PhaseAction): string => {
    switch (action) {
      case "discuss":
        return "Discuss Idea (Interactive)";
      case "evaluate":
        return isEvaluating ? "Evaluating..." : hasAiOpinion ? "Re-evaluate Idea" : "Evaluate Idea";
      case "quick-fix":
        return isQuickFixing ? "Quick fixing..." : "Quick Fix (No Plan)";
      case "terminal":
        return phaseLabels.terminal;
      case "play":
        return isStarting ? "Running..." : phaseLabels.play;
      case "test-together":
        return "Test Together (Interactive)";
      case "generate":
        return "Generate";
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

  // --- Board-sized icon, identical to the footer row it came from ---
  const renderIcon = (action: PhaseAction) => {
    const running =
      (action === "play" && isStarting) ||
      (action === "quick-fix" && isQuickFixing) ||
      (action === "evaluate" && isEvaluating);
    // Autonomous buttons stay drawn while locked, as a spinner or a dimmed
    // icon; interactive ones are not shown at all then.
    const autonomous = action === "play" || action === "quick-fix" || action === "evaluate";
    const dimmed = autonomous && isLocked && !running;

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
            disabled={autonomous ? running || isLocked : undefined}
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
                      card.aiVerdict === "negative" ? "bg-red-500" : "bg-green-500"
                    }`}
                  >
                    {card.aiVerdict === "negative" ? (
                      <X className="w-1.5 h-1.5 text-white" strokeWidth={4} />
                    ) : (
                      <Check className="w-1.5 h-1.5 text-white" strokeWidth={4} />
                    )}
                  </span>
                )}
              </div>
            ) : (
              <Icon className="w-3.5 h-3.5" />
            )}
          </button>
        </TooltipTrigger>
        <TooltipContent side="top">{tooltipFor(action)}</TooltipContent>
      </Tooltip>
    );
  };

  // --- Modal footer: one spelled-out primary, the rest as icons ---
  const renderLabeled = () => {
    if (isBackgroundProcessing) {
      return (
        <Button size="sm" disabled className="disabled:opacity-100 cursor-wait">
          <Loader2 className="animate-spin" />
          {isEvaluating ? "Evaluating..." : isQuickFixing ? "Quick fixing..." : "Running..."}
        </Button>
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
          return (
            <Tooltip key={action}>
              <TooltipTrigger asChild>
                <button
                  type="button"
                  onClick={onAction[action]}
                  disabled={isPreparing}
                  aria-label={tooltipFor(action)}
                  className={`h-8 w-8 grid place-items-center rounded-md transition-colors disabled:opacity-50 ${ICON_TINT[action]}`}
                >
                  <Icon className="w-4 h-4" />
                </button>
              </TooltipTrigger>
              <TooltipContent side="top">{tooltipFor(action)}</TooltipContent>
            </Tooltip>
          );
        })}
        <Button
          size="sm"
          onClick={onAction[primary]}
          disabled={isPreparing}
          className={PRIMARY_CLASS[primary]}
        >
          {isPreparing ? <Loader2 className="animate-spin" /> : <PrimaryIcon />}
          {labelFor(primary)}
        </Button>
      </div>
    );
  };

  return (
    <>
      {variant === "labeled"
        ? renderLabeled()
        : actions
            .filter((action) => isPhaseActionShown(action, flags, isLocked))
            .map(renderIcon)}

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

      <PasteTipDialog
        open={showTerminalConfirm}
        onOpenChange={setShowTerminalConfirm}
        title="Open Interactive Terminal"
        terminalLabel={pasteTipTerminalLabel}
        confirmLabel="Open Terminal"
        confirmClassName="bg-orange-500 hover:bg-orange-600"
        onConfirm={handleOpenTerminal}
      >
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
                  <p className="text-muted-foreground">{VERIFY_RUN_BLURB}</p>
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
