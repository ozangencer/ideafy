"use client";

import { memo, useMemo, useState } from "react";
import { useDraggable } from "@dnd-kit/core";
import { CSS } from "@dnd-kit/utilities";
import { Card, CardGroup, getDisplayId, COLUMNS, RUN_MODE_LABELS } from "@/lib/types";
import { CardGroupChip } from "./card-group-chip";
import { cardLastActivityAt, formatAgeLong, getCardStaleness } from "@/lib/card-age";
import { parseTestProgress } from "@/lib/test-progress";
import {
  BOARD_PHASE_ACTIONS,
  getPhaseActionFlags,
  isPhaseActionShown,
} from "@/lib/card-phase";
import { CardPhaseActions } from "./card-phase-actions";
import { useKanbanStore } from "@/lib/store";
import { Loader2, Lightbulb, FlaskConical, ExternalLink, ArrowRightLeft, Trash2, Unlock, FileDown, FolderGit2, MonitorPlay, MonitorStop, AlertTriangle, GitCommitHorizontal } from "lucide-react";
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
// own p-3 (24); inside a group frame another 24 goes to the frame — 7 on the
// right for its border and padding, 17 on the left, where the rail and its
// indent do the work of showing the card is nested. Columns are fluid, so this
// is derived from the measured width the column hands down rather than assumed
// from w-72 — otherwise a wide column would keep hiding names that fit.
const COLUMN_PADDING_W = 16;
const CARD_PADDING_W = 24;
const GROUP_FRAME_W = 24;
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
  /**
   * Set when the card sits inside a dashed block — a chain row or the Stale
   * row — which costs it the frame's border and padding. `group` used to imply
   * this, but a stale card need not belong to a chain and still loses the
   * width.
   */
  inGroupFrame?: boolean;
  isDragging?: boolean;
  extraBadges?: React.ReactNode;
  extraContextMenuItems?: React.ReactNode;
  extraWrapperClassName?: string;
  softLock?: boolean;
}

function TaskCardImpl({
  card,
  group = null,
  // The drag overlay renders outside any column; it is a 272px snapshot, so
  // the default keeps the dragged card looking like the one it was lifted from.
  columnWidth = 288,
  inGroupFrame = false,
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
  const staleThresholds = useKanbanStore((s) => s.staleThresholds);
  const startingLocal = useKanbanStore((s) => s.startingCardIds.includes(card.id));
  const moveCard = useKanbanStore((s) => s.moveCard);
  const deleteCard = useKanbanStore((s) => s.deleteCard);
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
  const unlockCard = useKanbanStore((s) => s.unlockCard);
  const startDevServer = useKanbanStore((s) => s.startDevServer);
  const stopDevServer = useKanbanStore((s) => s.stopDevServer);
  // Two booleans, not the id list: a toggle re-renders the card it flipped
  // and, on the first and last pick, every card (the checkboxes appear) —
  // never the whole board on every click in between.
  const isSelected = useKanbanStore((s) => s.selectedCardIds.includes(card.id));
  const selectionActive = useKanbanStore((s) => s.selectedCardIds.length > 0);
  const toggleCardSelection = useKanbanStore((s) => s.toggleCardSelection);
  const selectCardRange = useKanbanStore((s) => s.selectCardRange);
  const moveCards = useKanbanStore((s) => s.moveCards);
  const setBulkDeleteConfirmOpen = useKanbanStore((s) => s.setBulkDeleteConfirmOpen);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [isServerLoading, setIsServerLoading] = useState(false);
  const { attributes, listeners, setNodeRef, transform, isDragging: isBeingDragged } = useDraggable({
    id: card.id,
  });

  // Heavy HTML parses — cache per-string so board-wide re-renders don't re-strip
  // hundreds of KB of markup on every tick.
  const descriptionText = useMemo(() => stripHtml(card.description), [card.description]);
  const solutionSummaryText = useMemo(() => stripHtml(card.solutionSummary), [card.solutionSummary]);
  const testScenariosText = useMemo(() => stripHtml(card.testScenarios), [card.testScenarios]);
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

  // The run buttons themselves live in CardPhaseActions; the card only needs
  // to know which of them will be drawn, for the footer width budget below.
  const phaseFlags = getPhaseActionFlags(card, solutionSummaryText, testScenariosText, testProgress);
  const shownPhaseActions = BOARD_PHASE_ACTIONS.filter((action) =>
    isPhaseActionShown(action, phaseFlags, isLocked)
  ).length;

  // Get project info
  const project = projects.find((p) => p.id === card.projectId);

  const style = {
    transform: CSS.Translate.toString(transform),
    transition: transform ? 'transform 0ms' : 'transform 200ms ease',
    opacity: isBeingDragged ? 0 : 1,
    cursor: isBeingDragged ? 'grabbing' : 'grab',
  };

  const openDetails = () => {
    if (!isDragging && !isBeingDragged && (!isLocked || softLock)) {
      selectCard(card);
      openModal();
    }
  };

  const canSelect = !isLocked && !isDragging;

  // Shift+click picks every card between the anchor and this one, in the order
  // the column shows them. Read off the DOM because that order is only final
  // after grouping, folding, the Stale row and the render cap have all had
  // their say. Ranges stay inside one column: across columns there is no
  // "between". Running cards in the middle are stepped over, as they would be
  // one by one.
  const selectRangeTo = (target: HTMLElement) => {
    const anchorId = useKanbanStore.getState().selectionAnchorId;
    const columnEl = target.closest("[data-column-id]");
    const ids = columnEl
      ? Array.from(
          columnEl.querySelectorAll<HTMLElement>("[data-card-id][data-selectable]")
        ).map(
          (el) => el.dataset.cardId as string
        )
      : [];
    const from = anchorId ? ids.indexOf(anchorId) : -1;
    const to = ids.indexOf(card.id);
    if (from === -1 || to === -1) {
      toggleCardSelection(card.id);
      return;
    }
    selectCardRange(ids.slice(Math.min(from, to), Math.max(from, to) + 1));
  };

  const handleSelectionClick = (e: React.MouseEvent<HTMLElement>) => {
    if (e.shiftKey) selectRangeTo(e.currentTarget);
    else toggleCardSelection(card.id);
  };

  const handleClick = (e: React.MouseEvent<HTMLElement>) => {
    if (isDragging || isBeingDragged) return;
    // Once anything is picked, a plain click keeps picking — opening a card
    // mid-selection would throw the selection away (openModal clears it).
    if (canSelect && (e.shiftKey || e.metaKey || e.ctrlKey || selectionActive)) {
      handleSelectionClick(e);
      return;
    }
    openDetails();
  };

  const handleUnlock = (e: React.MouseEvent) => {
    e.stopPropagation();
    unlockCard(card.id);
  };

  const projectDefaultWorktree = project?.useWorktrees ?? true;
  const effectiveUseWorktree = card.useWorktree ?? projectDefaultWorktree;

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
  // Same thresholds the column used to sort this card into the Stale row, so
  // the marker and the row it sits in cannot disagree.
  const staleness = getCardStaleness(
    card.status,
    cardLastActivityAt(card),
    Date.now(),
    staleThresholds
  );
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
    ...Array.from({ length: shownPhaseActions }, (): [boolean, number] => [true, FOOTER_ICON_W]),
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
    columnWidth -
    COLUMN_PADDING_W -
    CARD_PADDING_W -
    (group || inGroupFrame ? GROUP_FRAME_W : 0);
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
            data-card-id={isDragging ? undefined : card.id}
            data-selectable={canSelect || undefined}
            onClick={handleClick}
            onContextMenu={handleContextMenu}
            // Selected is a solid ink border, not a ring: ring-2 ring-ink/40 is
            // what the drag overlay looks like, and the two must not be mixed up.
            className={`bg-card border rounded-md p-3 transition-colors group touch-none select-none relative ${
              isSelected ? "border-ink" : "border-border"
            } ${
              isDragging ? "shadow-2xl ring-2 ring-ink/40" : ""
            } ${isBeingDragged ? "z-50" : ""} ${
              isLocked
                ? "opacity-50 cursor-not-allowed"
                : isSelected
                ? ""
                : extraWrapperClassName
                ? extraWrapperClassName
                : "hover:border-ink/40"
            }`}
          >
            {isSelected && (
              <div className="absolute inset-0 rounded-md bg-ink/[0.05] pointer-events-none" />
            )}

            {/* Hangs off the corner rather than sitting in the title row, so
                showing it on hover moves neither the id chip nor the title.
                Hover-only until something is picked; after that every card
                shows one, since a plain click now selects too. */}
            {canSelect && (
              <button
                type="button"
                role="checkbox"
                aria-checked={isSelected}
                aria-label={isSelected ? "Deselect card" : "Select card"}
                // dnd-kit's PointerSensor listens on the card; without this a
                // click here reads as the start of a drag.
                onPointerDown={(e) => e.stopPropagation()}
                onClick={(e) => {
                  e.stopPropagation();
                  handleSelectionClick(e);
                }}
                className={`absolute -top-1.5 -left-1.5 z-10 flex h-4 w-4 items-center justify-center rounded border transition-opacity ${
                  isSelected
                    ? "border-ink bg-ink text-background opacity-100"
                    : `border-ink/40 bg-card text-transparent hover:border-ink ${
                        selectionActive ? "opacity-100" : "opacity-0 group-hover:opacity-100"
                      }`
                }`}
              >
                <Check className="h-3 w-3" strokeWidth={3} />
              </button>
            )}
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
              {/* Silence since the last activity — not age since creation. A
                  card opened in April and worked on yesterday is not old, and
                  saying it was would put every long-running card in the same
                  bucket as the abandoned ones. Only shown past the column's
                  threshold: on every card it would be noise that hides the
                  cards it exists to surface. */}
              {staleness && (
                <Tooltip>
                  <TooltipTrigger asChild>
                    <span className="text-[10px] shrink-0 tabular-nums mt-0.5 cursor-default text-muted-foreground">
                      {staleness.label}
                    </span>
                  </TooltipTrigger>
                  <TooltipContent side="top">
                    Last touched {formatAgeLong(staleness.days)}
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
                <CardPhaseActions card={card} softLock={softLock} />
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
          <ContextMenuItem onClick={openDetails}>
            <ExternalLink className="w-4 h-4 mr-2" />
            Open Details
          </ContextMenuItem>
          <ContextMenuSub>
            <ContextMenuSubTrigger>
              <ArrowRightLeft className="w-4 h-4 mr-2" />
              Change Status
              {isSelected && <SelectionCount inline />}
            </ContextMenuSubTrigger>
            <ContextMenuSubContent className="w-40">
              {COLUMNS.map((col) => (
                <ContextMenuItem
                  key={col.id}
                  // Right-clicking inside the selection acts on all of it;
                  // outside it, only on this card, as before.
                  onClick={() =>
                    isSelected
                      ? moveCards(useKanbanStore.getState().selectedCardIds, col.id)
                      : moveCard(card.id, col.id)
                  }
                  // A mixed selection has no single "current" column to grey out.
                  disabled={!isSelected && card.status === col.id}
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
            onClick={() =>
              isSelected ? setBulkDeleteConfirmOpen(true) : setShowDeleteConfirm(true)
            }
            className="text-red-500 focus:text-red-500"
          >
            <Trash2 className="w-4 h-4 mr-2" />
            Delete
            {isSelected && <SelectionCount />}
          </ContextMenuItem>
        </ContextMenuContent>
      </ContextMenu>

      <AlertDialog open={showDeleteConfirm} onOpenChange={setShowDeleteConfirm}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Card</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete &quot;{card.title}&quot;? You can undo with ⌘Z.
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
    </>
  );
}

/**
 * The selection size, for context-menu labels. Its own subscriber so the count
 * is only watched while a menu is open, not by every card on the board.
 */
function SelectionCount({ inline = false }: { inline?: boolean }) {
  const count = useKanbanStore((s) => s.selectedCardIds.length);
  return (
    // Inline beside a sub-trigger, whose chevron already claims the far edge.
    <span
      className={`${inline ? "pl-1.5" : "ml-auto pl-2"} font-mono text-[10px] tabular-nums text-current opacity-70`}
    >
      {count}
    </span>
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
    prev.inGroupFrame === next.inGroupFrame &&
    prev.softLock === next.softLock &&
    prev.extraWrapperClassName === next.extraWrapperClassName &&
    prev.extraBadges === next.extraBadges &&
    prev.extraContextMenuItems === next.extraContextMenuItems
  );
});
