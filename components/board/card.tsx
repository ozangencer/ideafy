"use client";

import { memo, useMemo, useState } from "react";
import { useDraggable } from "@dnd-kit/core";
import { CSS } from "@dnd-kit/utilities";
import { Card, CardGroup, getDisplayId, COLUMNS, RUN_MODE_LABELS } from "@/lib/types";
import { CardGroupChip } from "./card-group-chip";
import { formatAgeLong, getCardStaleness } from "@/lib/card-age";
import { parseTestProgress } from "@/lib/test-progress";
import { useKanbanStore } from "@/lib/store";
import { Play, Loader2, Terminal, Lightbulb, FlaskConical, ExternalLink, ArrowRightLeft, Trash2, Zap, Unlock, Brain, MessagesSquare, FileDown, FolderGit2, MonitorPlay, MonitorStop, AlertTriangle, Check, GitCommitHorizontal, X } from "lucide-react";
import { downloadCardAsMarkdown } from "@/lib/card-export";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuSub,
  ContextMenuSubContent,
  ContextMenuSubTrigger,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
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
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { Switch } from "@/components/ui/switch";

// Decode HTML entities and strip tags for preview text
function stripHtml(html: string): string {
  if (!html) return "";
  // First decode common HTML entities
  const decoded = html
    .replace(/&#39;/g, "'")
    .replace(/&#x27;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&#34;/g, '"')
    .replace(/&#x22;/g, '"')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&nbsp;/g, ' ');
  // Then strip HTML tags
  return decoded.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
}

// Priority icon with bars (3 levels)
function PriorityIcon({ priority }: { priority: string }) {
  const levels = {
    low: 1,
    medium: 2,
    high: 3,
  };
  const colors = {
    low: "#6b7280",
    medium: "#3b82f6",
    high: "#ef4444",
  };

  const level = levels[priority as keyof typeof levels] || 2;
  const color = colors[priority as keyof typeof colors] || "#3b82f6";

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span>
          <svg
            width="12"
            height="12"
            viewBox="0 0 12 12"
            fill="none"
            className="shrink-0"
          >
            {[0, 1, 2].map((i) => (
              <rect
                key={i}
                x={i * 4}
                y={9 - (i + 1) * 3}
                width="3"
                height={(i + 1) * 3}
                rx="0.5"
                fill={i < level ? color : "currentColor"}
                opacity={i < level ? 1 : 0.15}
              />
            ))}
          </svg>
        </span>
      </TooltipTrigger>
      <TooltipContent side="top">
        Priority: {priority.charAt(0).toUpperCase() + priority.slice(1)}
      </TooltipContent>
    </Tooltip>
  );
}

// Footer width budget, in px. The card gives up its column's p-2 (16) and its
// own p-3 (24); inside a group frame another 14 goes to the frame's border and
// padding. Columns are fluid, so this is derived from the measured width the
// column hands down rather than assumed from w-72 — otherwise a wide column
// would keep hiding names that fit.
const COLUMN_PADDING_W = 16;
const CARD_PADDING_W = 24;
const GROUP_FRAME_W = 14;
const FOOTER_ICON_W = 26;
const FOOTER_BADGE_W = 52;
const FOOTER_CORE_BADGE_W = 88;
// Below this the name would clip to two or three letters — a label too short
// to identify anything while still taking the space of one.
const FOOTER_NAME_MIN_W = 72;

interface TaskCardProps {
  card: Card;
  /** The card's chain, when it belongs to one. Drives the code chip. */
  group?: CardGroup | null;
  /**
   * The measured width of the column this card sits in. Columns are fluid, so
   * the footer's "does the project name fit" budget cannot be a constant.
   */
  columnWidth?: number;
  isDragging?: boolean;
  extraBadges?: React.ReactNode;
  extraContextMenuItems?: React.ReactNode;
  extraWrapperClassName?: string;
  softLock?: boolean;
}

type Phase = "planning" | "implementation" | "retest" | "verify";

function detectPhase(
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

function getPhaseLabels(phase: Phase): { play: string; terminal: string } {
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
        terminal: "Test Together (Interactive)",
      };
  }
}

function getEffectiveTerminal(
  settings: { terminalApp?: string | null; detectedTerminal?: string | null } | null | undefined
): string | null {
  return settings?.terminalApp ?? settings?.detectedTerminal ?? null;
}

function getPasteTipTerminalLabel(terminal: string | null): string {
  if (terminal === "ghostty") return "Ghostty";
  if (terminal === "cmux") return "cmux";
  if (terminal === "warp") return "Warp";
  if (terminal === "iterm2") return "iTerm2";
  if (terminal === "terminal") return "Terminal";
  return "terminal";
}

function TaskCardImpl({
  card,
  group = null,
  // The drag overlay renders outside any column; it is a 272px snapshot, so
  // the default keeps the dragged card looking like the one it was lifted from.
  columnWidth = 288,
  isDragging = false,
  extraBadges,
  extraContextMenuItems,
  extraWrapperClassName,
  softLock,
}: TaskCardProps) {
  // Narrow selectors: boolean membership checks re-render this card only when
  // ITS own flag flips, instead of on every store change (e.g. fetchCards
  // replacing the cards array every 10s). Critical on boards with heavy cards.
  const selectCard = useKanbanStore((s) => s.selectCard);
  const openModal = useKanbanStore((s) => s.openModal);
  const projects = useKanbanStore((s) => s.projects);
  const startTask = useKanbanStore((s) => s.startTask);
  const startingLocal = useKanbanStore((s) => s.startingCardIds.includes(card.id));
  const openTerminal = useKanbanStore((s) => s.openTerminal);
  const openIdeationTerminal = useKanbanStore((s) => s.openIdeationTerminal);
  const openTestTerminal = useKanbanStore((s) => s.openTestTerminal);
  const moveCard = useKanbanStore((s) => s.moveCard);
  const deleteCard = useKanbanStore((s) => s.deleteCard);
  const quickFixTask = useKanbanStore((s) => s.quickFixTask);
  const quickFixingLocal = useKanbanStore((s) => s.quickFixingCardIds.includes(card.id));
  const evaluateIdea = useKanbanStore((s) => s.evaluateIdea);
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
  const unlockCard = useKanbanStore((s) => s.unlockCard);
  const updateCard = useKanbanStore((s) => s.updateCard);
  const settings = useKanbanStore((s) => s.settings);
  const startDevServer = useKanbanStore((s) => s.startDevServer);
  const stopDevServer = useKanbanStore((s) => s.stopDevServer);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [showQuickFixConfirm, setShowQuickFixConfirm] = useState(false);
  const [showTerminalConfirm, setShowTerminalConfirm] = useState(false);
  const [showIdeationConfirm, setShowIdeationConfirm] = useState(false);
  const [showAutonomousConfirm, setShowAutonomousConfirm] = useState(false);
  const [dialogUseWorktree, setDialogUseWorktree] = useState(true);
  const [showTestTogetherConfirm, setShowTestTogetherConfirm] = useState(false);
  const [isServerLoading, setIsServerLoading] = useState(false);
  const { attributes, listeners, setNodeRef, transform, isDragging: isBeingDragged } = useDraggable({
    id: card.id,
  });

  // Heavy HTML parses — cache per-string so board-wide re-renders don't re-strip
  // hundreds of KB of markup on every tick.
  const descriptionText = useMemo(() => stripHtml(card.description), [card.description]);
  const solutionSummaryText = useMemo(() => stripHtml(card.solutionSummary), [card.solutionSummary]);
  const testScenariosText = useMemo(() => stripHtml(card.testScenarios), [card.testScenarios]);
  const aiOpinionText = useMemo(() => stripHtml(card.aiOpinion), [card.aiOpinion]);
  const testProgress = useMemo(() => parseTestProgress(card.testScenarios), [card.testScenarios]);

  // Three independent signals converge so the spinner is robust: local
  // trigger state (instant), persisted processingType (DB), and the
  // server-side backgroundProcesses list (catches cross-session spawns).
  const isStarting = startingLocal || card.processingType === "autonomous" || autonomousInBg;
  const isQuickFixing = quickFixingLocal || card.processingType === "quick-fix" || quickFixInBg;
  const isEvaluating = evaluatingLocal || card.processingType === "evaluate" || evaluateInBg;
  const isLocked = lockedLocal || !!card.processingType || !!softLock;
  // Background processing = auto unlock when done, no manual unlock needed
  const isBackgroundProcessing = isStarting || isQuickFixing || isEvaluating;
  // Human Test'te otonom koşu yalnızca temel akışı doğrular. Bu grubu ilan
  // etmeyen bir çeklistte agent hangi maddenin temel olduğunu bilemez, o yüzden
  // orada buton hiç çıkmaz — çıkarsa hiçbir şey işaretlemeyen bir koşu vaat eder.
  const canPreVerify = card.status === "test" && !!testProgress?.core;
  const canStart = !!(card.description && (card.projectId || card.projectFolder) && card.status !== "completed" && card.status !== "ideation" && (card.status !== "test" || canPreVerify));
  const canQuickFix = card.status === "bugs" && !!(card.description && (card.projectId || card.projectFolder));
  const canEvaluate = card.status === "ideation" && !!(card.description && (card.projectId || card.projectFolder));
  const canTestTogether = card.status === "test" && !!(card.testScenarios && testScenariosText !== "" && (card.projectId || card.projectFolder));
  const hasAiOpinion = !!aiOpinionText;

  // Detect current phase for dynamic tooltips
  const phase = detectPhase(card, solutionSummaryText, testScenariosText);
  const phaseLabels = getPhaseLabels(phase);

  // Get project info for worktree path calculation
  const project = projects.find((p) => p.id === card.projectId);
  const projectPath = project?.folderPath || card.projectFolder;

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
  const effectiveTerminal = getEffectiveTerminal(settings);
  // cmux embeds Ghostty but does not inherit its paste confirmation (verified
  // in real use), so it stays out of this list.
  const needsPasteConfirm = effectiveTerminal === "ghostty";
  const pasteTipTerminalLabel = getPasteTipTerminalLabel(effectiveTerminal);

  const style = {
    transform: CSS.Translate.toString(transform),
    transition: transform ? 'transform 0ms' : 'transform 200ms ease',
    opacity: isBeingDragged ? 0 : 1,
    cursor: isBeingDragged ? 'grabbing' : 'grab',
  };

  const handleClick = () => {
    if (!isDragging && !isBeingDragged && (!isLocked || softLock)) {
      selectCard(card);
      openModal();
    }
  };

  const handleUnlock = (e: React.MouseEvent) => {
    e.stopPropagation();
    unlockCard(card.id);
  };

  const projectDefaultWorktree = project?.useWorktrees ?? true;
  const effectiveUseWorktree = card.useWorktree ?? projectDefaultWorktree;

  const handleStartClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (isLocked || isStarting || !canStart) return;
    setDialogUseWorktree(effectiveUseWorktree);
    setShowAutonomousConfirm(true);
  };

  const handleStart = async () => {
    setShowAutonomousConfirm(false);
    if (isStarting || !canStart) return;

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

  const handleOpenTerminalClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (isLocked || !canStart) return;

    if (needsPasteConfirm) {
      setShowTerminalConfirm(true);
    } else {
      handleOpenTerminal();
    }
  };

  const handleOpenTerminal = async () => {
    setShowTerminalConfirm(false);

    const result = await openTerminal(card.id);
    if (!result.success) {
      console.error("Failed to open terminal:", result.error);
    }
  };

  const handleQuickFixClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (isLocked || !canQuickFix) return;
    setDialogUseWorktree(effectiveUseWorktree);
    setShowQuickFixConfirm(true);
  };

  const handleQuickFix = async () => {
    setShowQuickFixConfirm(false);
    if (isQuickFixing || !canQuickFix) return;

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

  const handleEvaluate = async (e: React.MouseEvent) => {
    e.stopPropagation();
    if (isLocked || isEvaluating || !canEvaluate) return;

    const result = await evaluateIdea(card.id);
    if (!result.success) {
      console.error("Failed to evaluate idea:", result.error);
    }
  };

  const handleOpenIdeationTerminalClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (isLocked || !canEvaluate) return;

    if (needsPasteConfirm) {
      setShowIdeationConfirm(true);
    } else {
      handleOpenIdeationTerminal();
    }
  };

  const handleOpenIdeationTerminal = async () => {
    setShowIdeationConfirm(false);

    const result = await openIdeationTerminal(card.id);
    if (!result.success) {
      console.error("Failed to open ideation terminal:", result.error);
    }
  };

  const handleTestTogetherClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (isLocked || !canTestTogether) return;

    if (needsPasteConfirm) {
      setShowTestTogetherConfirm(true);
    } else {
      handleOpenTestTerminal();
    }
  };

  const handleOpenTestTerminal = async () => {
    setShowTestTogetherConfirm(false);

    const result = await openTestTerminal(card.id);
    if (!result.success) {
      console.error("Failed to open test terminal:", result.error);
    }
  };

  const handleExportMarkdown = (e: React.MouseEvent) => {
    e.stopPropagation();
    downloadCardAsMarkdown(card, project);
  };

  // What the run button means for this project. A card with no project can
  // still have a worktree, so fall back to the historical dev-server shape.
  const runMode = project?.resolvedRunMode ?? "server";
  const runLabels = RUN_MODE_LABELS[runMode];
  // Opening Xcode leaves no process behind — there is never a Stop state.
  const isOneShotRun = runMode === "xcode";
  const runIsActive = !isOneShotRun && !!card.devServerPid;

  const handleDevServerToggle = async (e: React.MouseEvent) => {
    e.stopPropagation();
    if (isServerLoading || isLocked) return;

    setIsServerLoading(true);
    try {
      if (runIsActive) {
        const result = await stopDevServer(card.id);
        if (!result.success) {
          console.error("Failed to stop:", result.error);
        }
      } else {
        const result = await startDevServer(card.id);
        if (!result.success) {
          console.error("Failed to start:", result.error);
        }
      }
    } finally {
      setIsServerLoading(false);
    }
  };

  const displayId = getDisplayId(card, project);
  const staleness = getCardStaleness(card.status, card.createdAt);
  const projectName = project?.name || (card.projectFolder ? card.projectFolder.split("/").pop() : null);

  // Whether the footer has room for the project name. There is no CSS query
  // for "does this text fit", and measuring per card would cost a
  // ResizeObserver on every card of a 200-card board — but we do not need to
  // measure, because what crowds the row is the icon set, and that is decided
  // right here from the same flags that render it. Getting the estimate a
  // little wrong only shows or hides a label; nothing breaks. Any icon added
  // below should get a line here too, or it will be spent width the estimate
  // does not know about.
  const showsRunButton =
    card.status === "test" &&
    card.gitWorktreeStatus === "active" &&
    !isLocked &&
    (project?.resolvedRunMode ?? "server") !== "none";
  const footerSlots: Array<[boolean, number]> = [
    [canEvaluate && !isLocked, FOOTER_ICON_W],
    [canEvaluate, FOOTER_ICON_W],
    [canQuickFix, FOOTER_ICON_W],
    [canStart && !isLocked, FOOTER_ICON_W],
    [canStart && phase !== "retest", FOOTER_ICON_W],
    [canTestTogether && !isLocked, FOOTER_ICON_W],
    [showsRunButton, FOOTER_ICON_W],
    [!!card.rebaseConflict, FOOTER_ICON_W],
    [!!extraBadges, FOOTER_ICON_W],
    [card.gitWorktreeStatus === "active" && !isBackgroundProcessing, FOOTER_ICON_W],
    [!!project && !effectiveUseWorktree && !isBackgroundProcessing, FOOTER_ICON_W],
    [!!solutionSummaryText && !isBackgroundProcessing, FOOTER_ICON_W],
    [
      !!testScenariosText && !isBackgroundProcessing,
      testProgress?.core ? FOOTER_CORE_BADGE_W : testProgress ? FOOTER_BADGE_W : FOOTER_ICON_W,
    ],
  ];
  const footerRightWidth = footerSlots.reduce(
    (sum, [shown, width]) => (shown ? sum + width : sum),
    0
  );
  const cardInnerWidth =
    columnWidth - COLUMN_PADDING_W - CARD_PADDING_W - (group ? GROUP_FRAME_W : 0);
  const showProjectName =
    !!project && cardInnerWidth - footerRightWidth >= FOOTER_NAME_MIN_W;

  // Prevent context menu when locked
  const handleContextMenu = (e: React.MouseEvent) => {
    if (isLocked) {
      e.preventDefault();
    }
  };

  return (
    <>
      <ContextMenu>
        <ContextMenuTrigger asChild>
          <div
            ref={setNodeRef}
            style={style}
            {...(isLocked ? {} : listeners)}
            {...(isLocked ? {} : attributes)}
            onClick={handleClick}
            onContextMenu={handleContextMenu}
            className={`bg-card border border-border rounded-md p-3 transition-colors group touch-none select-none relative ${
              isDragging ? "shadow-2xl ring-2 ring-ink/40" : ""
            } ${isBeingDragged ? "z-50" : ""} ${
              isLocked
                ? "opacity-50 cursor-not-allowed"
                : extraWrapperClassName
                ? extraWrapperClassName
                : "hover:border-ink/40"
            }`}
          >
            {/* Unlock button - only for interactive locks (terminal), not background processing or soft locks */}
            {isLocked && !isBackgroundProcessing && !softLock && (
              <Tooltip>
                <TooltipTrigger asChild>
                  <button
                    onClick={handleUnlock}
                    className="absolute top-2 right-2 p-1.5 rounded bg-orange-500/20 text-orange-500 hover:bg-orange-500/30 transition-colors z-10"
                  >
                    <Unlock className="w-3.5 h-3.5" />
                  </button>
                </TooltipTrigger>
                <TooltipContent side="left">Unlock</TooltipContent>
              </Tooltip>
            )}


            {/* Title with displayId and priority */}
            <div className={`flex items-start gap-2 mb-1 ${isLocked && !isBackgroundProcessing ? "pr-8" : ""}`}>
              {displayId && (
                <span
                  className="text-[10px] font-mono px-1.5 py-0.5 rounded shrink-0"
                  style={{
                    backgroundColor: project ? `${project.color}20` : undefined,
                    color: project?.color,
                  }}
                >
                  {displayId}
                </span>
              )}
              {group && (
                <Tooltip>
                  <TooltipTrigger asChild>
                    <span className="mt-px">
                      <CardGroupChip group={group} />
                    </span>
                  </TooltipTrigger>
                  <TooltipContent side="top">{group.name}</TooltipContent>
                </Tooltip>
              )}
              {/* Three lines, because the description quote below used to be
                  where a clipped title continued. Now the title gets the room
                  the repetition was taking.

                  13px, not 14: the chips beside it are 10px and the footer meta
                  is 10–12px, so 14 jumped two steps of the scale at once and
                  read as shouting. With the quote gone the title has nothing
                  left to out-shout, and the contrast it needs comes from weight
                  and colour instead. Tighter leading buys back ~7px per card,
                  which is three lines' worth over a full column. */}
              <h3 className={`text-[13px] leading-snug tracking-[-0.01em] font-medium text-card-foreground transition-colors line-clamp-3 flex-1 ${isLocked ? "" : "group-hover:text-ink"}`}>
                {card.title}
              </h3>
              {/* Age, but only once it is worth mentioning. Shown on every card
                  it would be noise that hides the cards it exists to surface. */}
              {staleness && (
                <Tooltip>
                  <TooltipTrigger asChild>
                    <span className="text-[10px] shrink-0 tabular-nums mt-0.5 cursor-default text-muted-foreground">
                      {staleness.label}
                    </span>
                  </TooltipTrigger>
                  <TooltipContent side="top">
                    Created {formatAgeLong(staleness.days)}
                  </TooltipContent>
                </Tooltip>
              )}
              {!isLocked && <PriorityIcon priority={card.priority} />}
            </div>

            {/* Ideation only. Everywhere else `description` is a prompt, and a
                prompt opens by restating the task — so the quote was the title
                again, longer, competing for the row that now carries state.
                In Ideation there is no state to derive (no plan, no tests, no
                agent) and the idea itself lives in the body, so it stays.
                Column-aware behaviour is already the norm here: kanban-board
                sorts per column, card-age thresholds differ per column. */}
            {card.status === "ideation" && card.description && (
              <p className="text-xs text-muted-foreground line-clamp-2 mt-1">
                {descriptionText}
              </p>
            )}

            <div className="flex items-center justify-between mt-2">
              {/* Project indicator. BOARD-01 balanced this row by letting the
                  name truncate, which on an icon-heavy card left "I…" — a
                  label too short to identify anything, still taking the space
                  of one. The dot always shows; the name shows only where the
                  icons leave room for it to be read. When it is dropped the
                  identity is still there: the tooltip, and the display-id chip
                  above, tinted with the project colour and prefixed
                  IDE-/ICL-/DIC-. "No project" stays as text — that one is a
                  warning, not a label, and has no chip to fall back on. */}
              {project ? (
                showProjectName ? (
                  // The name is right there — a tooltip repeating it would be
                  // a hover that costs a beat and returns nothing.
                  <div className="flex items-center gap-1.5 min-w-0">
                    <div
                      className="w-2 h-2 rounded-full shrink-0"
                      style={{ backgroundColor: project.color }}
                    />
                    <span className="text-xs text-muted-foreground truncate">
                      {project.name}
                    </span>
                  </div>
                ) : (
                  // No delay only where the tooltip carries something the card
                  // dropped. The 100ms default exists to keep tooltips from
                  // firing as the pointer crosses a row of icons; here the dot
                  // is the sole target and the name is the label that would
                  // have been printed, so waiting for it is friction.
                  <Tooltip delayDuration={0}>
                    <TooltipTrigger asChild>
                      {/* The dot is 8px, too small to hover reliably. Padding
                          plus a matching negative margin grows the hit area to
                          ~24px without moving anything on screen. */}
                      <div className="p-2 -m-2 shrink-0 cursor-default">
                        <div
                          className="w-2 h-2 rounded-full"
                          style={{ backgroundColor: project.color }}
                        />
                      </div>
                    </TooltipTrigger>
                    <TooltipContent side="top">{project.name}</TooltipContent>
                  </Tooltip>
                )
              ) : projectName ? (
                // No project record, only a folder path — there is no chip
                // above carrying this, so the text stays.
                <span className="text-xs text-muted-foreground truncate min-w-0 max-w-[120px]">
                  {projectName}
                </span>
              ) : (
                <span className="text-xs text-muted-foreground">No project</span>
              )}

              {/* Badges and Action Buttons */}
              <div className="flex items-center gap-1 shrink-0">
                {/* Interactive Ideation button - hidden when locked */}
                {canEvaluate && !isLocked && (
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <button
                        onClick={handleOpenIdeationTerminalClick}
                        className="p-1 rounded transition-colors bg-cyan-500/10 text-cyan-500/70 hover:bg-cyan-500/20 hover:text-cyan-500"
                      >
                        <MessagesSquare className="w-3.5 h-3.5" />
                      </button>
                    </TooltipTrigger>
                    <TooltipContent side="top">Discuss Idea (Interactive)</TooltipContent>
                  </Tooltip>
                )}
                {/* Autonomous Evaluate button - shows spinner when running */}
                {canEvaluate && (
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <button
                        onClick={handleEvaluate}
                        disabled={isEvaluating || isLocked}
                        className={`p-1 rounded transition-colors ${
                          isEvaluating
                            ? "bg-ink/20 text-ink cursor-wait"
                            : isLocked
                            ? "bg-ink/10 text-ink/30 cursor-not-allowed"
                            : "bg-ink/10 text-ink/70 hover:bg-ink/20 hover:text-ink"
                        }`}
                      >
                        {isEvaluating ? (
                          <Loader2 className="w-3.5 h-3.5 animate-spin" />
                        ) : (
                          <div className="relative">
                            <Brain className="w-3.5 h-3.5" />
                            {hasAiOpinion && (
                              <span className={`absolute -bottom-1 -right-1 flex items-center justify-center w-2.5 h-2.5 rounded-full ${
                                card.aiVerdict === 'negative' ? 'bg-red-500' : 'bg-green-500'
                              }`}>
                                {card.aiVerdict === 'negative' ? (
                                  <X className="w-1.5 h-1.5 text-white" strokeWidth={4} />
                                ) : (
                                  <Check className="w-1.5 h-1.5 text-white" strokeWidth={4} />
                                )}
                              </span>
                            )}
                          </div>
                        )}
                      </button>
                    </TooltipTrigger>
                    <TooltipContent side="top">
                      {isEvaluating ? "Evaluating..." : hasAiOpinion ? "Re-evaluate Idea" : "Evaluate Idea"}
                    </TooltipContent>
                  </Tooltip>
                )}
                {/* Autonomous QuickFix button - shows spinner when running */}
                {canQuickFix && (
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <button
                        onClick={handleQuickFixClick}
                        disabled={isQuickFixing || isLocked}
                        className={`p-1 rounded transition-colors ${
                          isQuickFixing
                            ? "bg-yellow-500/20 text-yellow-500 cursor-wait"
                            : isLocked
                            ? "bg-yellow-500/10 text-yellow-500/30 cursor-not-allowed"
                            : "bg-yellow-500/10 text-yellow-500/70 hover:bg-yellow-500/20 hover:text-yellow-500"
                        }`}
                      >
                        {isQuickFixing ? (
                          <Loader2 className="w-3.5 h-3.5 animate-spin" />
                        ) : (
                          <Zap className="w-3.5 h-3.5" />
                        )}
                      </button>
                    </TooltipTrigger>
                    <TooltipContent side="top">
                      {isQuickFixing ? "Quick fixing..." : "Quick Fix (No Plan)"}
                    </TooltipContent>
                  </Tooltip>
                )}
                {/* Terminal button - hidden when locked */}
                {canStart && !isLocked && (
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <button
                        onClick={handleOpenTerminalClick}
                        className="p-1 rounded transition-colors bg-orange-500/10 text-orange-500/70 hover:bg-orange-500/20 hover:text-orange-500"
                      >
                        <Terminal className="w-3.5 h-3.5" />
                      </button>
                    </TooltipTrigger>
                    <TooltipContent side="top">{phaseLabels.terminal}</TooltipContent>
                  </Tooltip>
                )}
                {/* Autonomous button - shows spinner when running, hidden only for retest phase */}
                {canStart && phase !== "retest" && (
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <button
                        onClick={handleStartClick}
                        disabled={isStarting || isLocked}
                        className={`p-1 rounded transition-colors ${
                          isStarting
                            ? "bg-ink/20 text-ink cursor-wait"
                            : isLocked
                            ? "bg-ink/10 text-ink/30 cursor-not-allowed"
                            : "bg-ink/10 text-ink/70 hover:bg-ink/20 hover:text-ink"
                        }`}
                      >
                        {isStarting ? (
                          <Loader2 className="w-3.5 h-3.5 animate-spin" />
                        ) : (
                          <Play className="w-3.5 h-3.5" />
                        )}
                      </button>
                    </TooltipTrigger>
                    <TooltipContent side="top">
                      {isStarting ? "Running..." : phaseLabels.play}
                    </TooltipContent>
                  </Tooltip>
                )}
                {/* Test Together button - hidden when locked */}
                {canTestTogether && !isLocked && (
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <button
                        onClick={handleTestTogetherClick}
                        className="p-1 rounded transition-colors bg-emerald-500/10 text-emerald-500/70 hover:bg-emerald-500/20 hover:text-emerald-500"
                      >
                        <FlaskConical className="w-3.5 h-3.5" />
                      </button>
                    </TooltipTrigger>
                    <TooltipContent side="top">Test Together (Interactive)</TooltipContent>
                  </Tooltip>
                )}
                {card.status === "test" &&
                  card.gitWorktreeStatus === "active" &&
                  !isLocked &&
                  runMode !== "none" && (
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <button
                        onClick={handleDevServerToggle}
                        disabled={isServerLoading}
                        className={`p-1 rounded transition-colors ${
                          runIsActive
                            ? "bg-green-500/20 text-green-500 hover:bg-red-500/20 hover:text-red-500"
                            : "bg-cyan-500/10 text-cyan-500/70 hover:bg-cyan-500/20 hover:text-cyan-500"
                        }`}
                      >
                        {isServerLoading ? (
                          <Loader2 className="w-3.5 h-3.5 animate-spin" />
                        ) : runIsActive ? (
                          <MonitorStop className="w-3.5 h-3.5" />
                        ) : isOneShotRun ? (
                          <ExternalLink className="w-3.5 h-3.5" />
                        ) : (
                          <MonitorPlay className="w-3.5 h-3.5" />
                        )}
                      </button>
                    </TooltipTrigger>
                    <TooltipContent side="top">
                      {isServerLoading
                        ? "Loading..."
                        : runIsActive
                        ? card.devServerPort
                          ? `${runLabels.running} (port ${card.devServerPort})`
                          : runLabels.running
                        : runLabels.start}
                    </TooltipContent>
                  </Tooltip>
                )}
                {/* Conflict badge - shows when rebase conflict detected */}
                {card.rebaseConflict && (
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <span className="p-1 rounded bg-red-500/20 text-red-500 animate-pulse">
                        <AlertTriangle className="w-3 h-3" />
                      </span>
                    </TooltipTrigger>
                    <TooltipContent side="top">
                      Merge conflict detected
                      {card.conflictFiles && card.conflictFiles.length > 0 && (
                        <span className="block text-xs opacity-75">
                          {card.conflictFiles.length} file(s) in conflict
                        </span>
                      )}
                    </TooltipContent>
                  </Tooltip>
                )}
                {extraBadges}
                {card.gitWorktreeStatus === "active" && !isBackgroundProcessing && (
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <span className="p-1 rounded bg-cyan-500/15 text-cyan-500">
                        <FolderGit2 className="w-3 h-3" />
                      </span>
                    </TooltipTrigger>
                    <TooltipContent side="top">Worktree active</TooltipContent>
                  </Tooltip>
                )}
                {/* Show "Main" badge when effective setting is "no worktree" (card override or project setting) */}
                {project && !effectiveUseWorktree && !isBackgroundProcessing && (
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <span className="p-1 rounded bg-gray-500/15 text-gray-400">
                        <GitCommitHorizontal className="w-3 h-3" />
                      </span>
                    </TooltipTrigger>
                    <TooltipContent side="top">
                      {card.useWorktree === false
                        ? "Direct on main (card override)"
                        : "Direct on main (no worktree)"}
                    </TooltipContent>
                  </Tooltip>
                )}
                {solutionSummaryText && !isBackgroundProcessing && (
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <span className="p-1 rounded bg-green-500/15 text-green-500">
                        <Lightbulb className="w-3 h-3" />
                      </span>
                    </TooltipTrigger>
                    <TooltipContent side="top">Has solution</TooltipContent>
                  </Tooltip>
                )}
                {testScenariosText && !isBackgroundProcessing && (() => {
                  const progress = testProgress;
                  const core = progress?.core;
                  // Green tracks the core flow when the checklist declares one:
                  // those items passing is what says the feature works.
                  const isComplete = progress
                    ? core
                      ? core.checked === core.total
                      : progress.checked === progress.total
                    : false;
                  const extra = core ? progress!.total - core.total : 0;
                  return (
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <span className={`p-1 rounded flex items-center gap-1 ${
                          isComplete
                            ? "bg-green-500/15 text-green-500"
                            : "bg-ink/10 text-ink"
                        }`}>
                          <FlaskConical className="w-3 h-3" />
                          {progress && (
                            <span className="text-[10px] font-mono tabular-nums flex items-center gap-0.5 whitespace-nowrap">
                              {core ? (
                                <>
                                  <span className="font-semibold">
                                    {core.checked}/{core.total}
                                  </span>
                                  <span>core</span>
                                  {extra > 0 && <span className="opacity-60">+{extra}</span>}
                                </>
                              ) : (
                                <span>{progress.checked}/{progress.total}</span>
                              )}
                            </span>
                          )}
                        </span>
                      </TooltipTrigger>
                      <TooltipContent side="top">
                        {!progress
                          ? "Has tests"
                          : core
                            ? `Core flow ${core.checked}/${core.total}${extra > 0 ? ` · ${extra} more scenario${extra === 1 ? "" : "s"}` : ""}`
                            : `Tests: ${progress.checked}/${progress.total} completed`
                        }
                      </TooltipContent>
                    </Tooltip>
                  );
                })()}
              </div>
            </div>
          </div>
        </ContextMenuTrigger>
        <ContextMenuContent className="w-48">
          <ContextMenuItem onClick={handleClick}>
            <ExternalLink className="w-4 h-4 mr-2" />
            Open Details
          </ContextMenuItem>
          <ContextMenuSub>
            <ContextMenuSubTrigger>
              <ArrowRightLeft className="w-4 h-4 mr-2" />
              Change Status
            </ContextMenuSubTrigger>
            <ContextMenuSubContent className="w-40">
              {COLUMNS.map((col) => (
                <ContextMenuItem
                  key={col.id}
                  onClick={() => moveCard(card.id, col.id)}
                  disabled={card.status === col.id}
                >
                  {col.title}
                </ContextMenuItem>
              ))}
            </ContextMenuSubContent>
          </ContextMenuSub>
          <ContextMenuItem onClick={handleExportMarkdown}>
            <FileDown className="w-4 h-4 mr-2" />
            Export as Markdown
          </ContextMenuItem>
          {extraContextMenuItems}
          <ContextMenuSeparator />
          <ContextMenuItem
            onClick={() => setShowDeleteConfirm(true)}
            className="text-red-500 focus:text-red-500"
          >
            <Trash2 className="w-4 h-4 mr-2" />
            Delete
          </ContextMenuItem>
        </ContextMenuContent>
      </ContextMenu>

      <AlertDialog open={showDeleteConfirm} onOpenChange={setShowDeleteConfirm}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Card</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete &quot;{card.title}&quot;? This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => deleteCard(card.id)}
              className="bg-red-500 hover:bg-red-600"
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

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

      <AlertDialog open={showTerminalConfirm} onOpenChange={setShowTerminalConfirm}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Open Interactive Terminal</AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-2">
                <p>
                  <strong>Tip:</strong> Use <kbd className="px-1.5 py-0.5 bg-secondary border border-border rounded text-xs">⌘V</kbd> to paste in {pasteTipTerminalLabel}.
                </p>
                {phase === "implementation" && (
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
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleOpenTerminal}
              className="bg-orange-500 hover:bg-orange-600"
            >
              Open Terminal
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={showIdeationConfirm} onOpenChange={setShowIdeationConfirm}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Interactive Ideation</AlertDialogTitle>
            <AlertDialogDescription>
              <strong>Tip:</strong> Use <kbd className="px-1.5 py-0.5 bg-secondary border border-border rounded text-xs">⌘V</kbd> to paste in {pasteTipTerminalLabel}.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleOpenIdeationTerminal}
              className="bg-cyan-500 hover:bg-cyan-600"
            >
              Start Discussion
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={showTestTogetherConfirm} onOpenChange={setShowTestTogetherConfirm}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Test Together</AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-2">
                <p>Start an interactive test session with Claude as your QA partner.</p>
                <p>
                  <strong>Tip:</strong> Use <kbd className="px-1.5 py-0.5 bg-secondary border border-border rounded text-xs">⌘V</kbd> to paste in {pasteTipTerminalLabel}.
                </p>
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleOpenTestTerminal}
              className="bg-emerald-500 hover:bg-emerald-600"
            >
              Start Testing
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

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
                  <p className="text-muted-foreground">
                    The agent runs the core flow only and ticks the steps that pass.
                    Later groups and your own ticks stay untouched.
                  </p>
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
    </>
  );
}

// Memoized: skip re-render when the card's data fingerprint (updatedAt) and
// drag state are unchanged. Zustand subscriptions inside TaskCardImpl still
// trigger their own re-renders when spinner flags flip.
export const TaskCard = memo(TaskCardImpl, (prev, next) => {
  return (
    prev.isDragging === next.isDragging &&
    prev.card.id === next.card.id &&
    prev.card.updatedAt === next.card.updatedAt &&
    prev.card.processingType === next.card.processingType &&
    // Compare the group by what the chip renders, not by identity: every poll
    // rebuilds the group objects, so a reference check would re-render every
    // grouped card every 10 seconds.
    prev.group?.id === next.group?.id &&
    prev.group?.code === next.group?.code &&
    prev.group?.name === next.group?.name &&
    prev.group?.color === next.group?.color &&
    prev.columnWidth === next.columnWidth &&
    prev.softLock === next.softLock &&
    prev.extraWrapperClassName === next.extraWrapperClassName &&
    prev.extraBadges === next.extraBadges &&
    prev.extraContextMenuItems === next.extraContextMenuItems
  );
});
