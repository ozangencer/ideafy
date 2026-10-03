"use client";

import { useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  Check,
  Columns3,
  Cpu,
  FlaskConical,
  Lightbulb,
  MessageSquare,
  Unlock,
} from "lucide-react";
import {
  buildFocusBoard,
  focusDetail,
  FOCUS_STATE_STYLES,
  FocusRow,
  replyLine,
  unreadSignalsByCard,
} from "@/lib/board-focus";
import type { PhaseAction } from "@/lib/card-phase";
import { useKanbanStore } from "@/lib/store";
import { prefetchToday } from "@/lib/today-cache";
import {
  BoardView,
  Card,
  getDisplayId,
  Project,
  SectionType,
  TodaySource,
} from "@/lib/types";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { CardPhaseActions } from "./card-phase-actions";
import { TodayPanel } from "./today-panel";

const STATE_ICONS = {
  AlertTriangle,
  Check,
  FlaskConical,
  Lightbulb,
  MessageSquare,
} as const;

/**
 * The card's ID tinted with its project's color, the same pill the board card
 * wears. In All Projects the rows otherwise read as one grey list, and the
 * prefix alone is too small to sort them by at a glance.
 */
export function ProjectIdPill({
  displayId,
  project,
  className = "",
}: {
  displayId: string;
  project: Project | undefined;
  className?: string;
}) {
  return (
    <span
      className={`shrink-0 rounded px-1 py-px font-mono ${className}`}
      style={
        project
          ? { backgroundColor: `${project.color}20`, color: project.color }
          : undefined
      }
    >
      {displayId}
    </span>
  );
}

/**
 * Which question the board is answering, said out loud and always reachable.
 *
 * It lives in the header rather than in settings because a view that changes
 * what the whole board shows has to be one click from being disbelieved. A
 * Focus mode you can only reach through a dialog is one you stop trusting the
 * first time it hides something, with no way to check.
 */
export function BoardViewToggle() {
  const boardView = useKanbanStore((s) => s.boardView);
  const setBoardView = useKanbanStore((s) => s.setBoardView);
  const activeProjectId = useKanbanStore((s) => s.activeProjectId);

  // The header mounts this in both views, so it is the place to warm Today's
  // list: Focus opened from All finds it already loaded instead of painting
  // Your turn first and Today seconds later.
  useEffect(() => {
    prefetchToday(activeProjectId);
  }, [activeProjectId]);

  const options: { value: BoardView; label: string }[] = [
    { value: "focus", label: "Focus" },
    { value: "all", label: "All" },
  ];

  return (
    <div className="inline-flex rounded-md border border-border overflow-hidden bg-card">
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          onClick={() => setBoardView(option.value)}
          onPointerEnter={
            option.value === "focus" && boardView !== "focus"
              ? () => prefetchToday(activeProjectId)
              : undefined
          }
          className={`px-2.5 py-1 font-mono text-[10px] uppercase tracking-wider transition-colors ${
            boardView === option.value
              ? "bg-ink text-background font-semibold"
              : "text-muted-foreground hover:text-foreground"
          }`}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

export function FocusBlockHeading({
  title,
  count,
  note,
}: {
  title: string;
  count?: number;
  note?: string;
}) {
  return (
    <div className="flex items-baseline gap-1.5">
      <h4 className="font-mono text-[10.5px] font-semibold uppercase tracking-[0.13em] text-muted-foreground">
        {title}
      </h4>
      {count !== undefined && (
        <span className="font-mono text-[10.5px] tabular-nums text-muted-foreground/70">
          {count}
        </span>
      )}
      {note && <span className="ml-auto text-[10.5px] text-muted-foreground/70">{note}</span>}
    </div>
  );
}

// Ideation and Quick Fix rows never reach Your turn as a test row, and Play
// leads here because pre-verifying is the step that saves the tester work.
const TEST_ROW_ACTIONS: PhaseAction[] = ["play", "terminal", "test-together"];

/**
 * The three ways to take a Human Test turn, on the row that announces it.
 *
 * The row's own button says *that* it is your turn and opens the checklist. It
 * cannot say *how*, and the how is where the work actually is: hand the core
 * flow to the agent, walk it together, or report what broke. On the board those
 * are one click each; without them here, Focus view can only ever hand you back
 * to a modal, and the button whose entire point is that you do not have to do
 * the testing yourself ends up the hardest one to reach.
 *
 * Deliberately not the rest of the board's footer. The badges — worktree,
 * solution, the test counter — say what `focusDetail` already says in words,
 * and a row that grows a second copy of its own subtitle stops being a row.
 */
function TestRowActions({ card }: { card: Card }) {
  const lockedLocal = useKanbanStore((s) => s.lockedCardIds.includes(card.id));
  const unlockCard = useKanbanStore((s) => s.unlockCard);

  // A card whose row is in Your turn cannot be processing — `getFocusState`
  // would have routed it to Agent running — but the check costs nothing and
  // closes the gap between a run starting and the next poll.
  const isLocked = lockedLocal || !!card.processingType;

  // A session is open on this card, so the three runs are gone — starting a
  // second one would fight the first. The board says so twice, by dimming the
  // card and by putting an unlock where the buttons were; a row that only
  // loses its icons says nothing about why, or how to get them back. Only the
  // interactive lock reaches here: a card with a running agent has already
  // left Your turn for Agent running.
  if (isLocked) {
    return (
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            type="button"
            onClick={() => unlockCard(card.id)}
            className="shrink-0 p-1 rounded transition-colors bg-orange-500/20 text-orange-500 hover:bg-orange-500/30"
          >
            <Unlock className="w-3.5 h-3.5" />
          </button>
        </TooltipTrigger>
        <TooltipContent side="top">Session open — unlock</TooltipContent>
      </Tooltip>
    );
  }

  return (
    <div className="flex shrink-0 items-center gap-1">
      <CardPhaseActions card={card} actions={TEST_ROW_ACTIONS} />
    </div>
  );
}

function YourTurnRow({ row }: { row: FocusRow }) {
  const projects = useKanbanStore((s) => s.projects);
  const selectCard = useKanbanStore((s) => s.selectCard);
  const openModal = useKanbanStore((s) => s.openModal);
  const setPendingCardSection = useKanbanStore((s) => s.setPendingCardSection);

  const style = FOCUS_STATE_STYLES[row.state];
  const Icon = STATE_ICONS[style.icon];
  const project = projects.find((p) => p.id === row.card.projectId);
  const displayId = getDisplayId(row.card, project);
  const detail = focusDetail(row.card, Date.now(), row.state, row.reply);

  const openAt = (section: SectionType) => {
    // The row already named the next move, so landing on the Detail tab and
    // making you find it again would waste the one thing the row bought.
    setPendingCardSection(section);
    selectCard(row.card);
    openModal();
  };
  const open = () =>
    openAt(row.state === "your-reply" ? row.reply?.section ?? style.section : style.section);

  // A signal on a row that is here for its own reason gets its own line rather
  // than taking over the detail: "new reply" in front of "4/5 core ✓" would
  // truncate the counter the row exists to show.
  const sideReply = row.state !== "your-reply" ? row.reply : undefined;
  // Only a chat answer is something to reply to; a verdict, a run or a
  // dropped queue card is something to open and read.
  const action =
    row.state === "your-reply" && row.reply && row.reply.kind !== "chat" ? "Open" : style.action;

  return (
    <div className="flex items-center gap-2 rounded-md border border-border bg-card px-2.5 py-2">
      <span className={`relative grid w-4 shrink-0 place-items-center ${style.color}`}>
        <Icon className="w-3.5 h-3.5" />
        {sideReply && (
          <span
            className={`absolute -right-0.5 -top-0.5 h-1.5 w-1.5 rounded-full ${
              sideReply.failed ? "bg-red-500" : "bg-amber-500"
            }`}
          />
        )}
      </span>
      <div className="flex min-w-0 flex-1 flex-col items-start gap-0.5">
        <button
          type="button"
          onClick={open}
          className="flex w-full min-w-0 flex-col items-start gap-0.5 text-left"
        >
          <span className="w-full truncate text-[13px] font-medium text-card-foreground">
            {row.card.title}
          </span>
          <span className="flex w-full min-w-0 items-center gap-1.5 font-mono text-[10.5px] tabular-nums text-muted-foreground">
            {displayId && <ProjectIdPill displayId={displayId} project={project} />}
            <span className="truncate">{detail}</span>
          </span>
        </button>
        {sideReply && (
          <button
            type="button"
            onClick={() => openAt(sideReply.section ?? style.section)}
            className={`max-w-full truncate text-left font-mono text-[10.5px] tabular-nums transition-colors hover:text-foreground ${
              sideReply.failed ? "text-red-500" : "text-amber-600 dark:text-amber-500"
            }`}
          >
            {replyLine(sideReply)}
          </button>
        )}
      </div>
      {row.state === "your-test" && <TestRowActions card={row.card} />}
      <button
        type="button"
        onClick={open}
        className="shrink-0 rounded border border-border bg-card px-1.5 py-0.5 font-mono text-[9.5px] uppercase tracking-wide text-muted-foreground transition-colors hover:border-ink/40 hover:text-foreground"
      >
        {action}
      </button>
    </div>
  );
}

export function QuietRow({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-2 rounded-md border border-dashed border-border px-2.5 py-2 text-[11.5px] text-muted-foreground">
      {children}
    </div>
  );
}

/**
 * The board rewritten as an answer to "whose turn is it".
 *
 * Three blocks, and only the first is a list. The other two exist so the list
 * can be short honestly: without them, a Focus view showing five rows out of
 * fifty-four looks like it lost your work. Naming what it left out — and how
 * much — is what makes a short list trustworthy enough to act on.
 *
 * On a wide window the Today panel takes the space to the right; below `xl`
 * it is hidden and the list stands alone, as it did before.
 */
export function FocusView({
  cards,
  todaySources,
}: {
  cards: Card[];
  todaySources?: TodaySource[];
}) {
  const staleThresholds = useKanbanStore((s) => s.staleThresholds);
  const setBoardView = useKanbanStore((s) => s.setBoardView);
  const projects = useKanbanStore((s) => s.projects);
  const activeWorkspace = useKanbanStore((s) => s.activeWorkspace);
  const selectCard = useKanbanStore((s) => s.selectCard);
  const openModal = useKanbanStore((s) => s.openModal);
  // The bell polls this list for the topbar, so Focus reads the same copy
  // instead of fetching its own and drifting from the bell's dots.
  const activityEvents = useKanbanStore((s) => s.activityEvents);

  const unreadReplies = useMemo(() => unreadSignalsByCard(activityEvents), [activityEvents]);

  const focus = useMemo(
    () => buildFocusBoard(cards, staleThresholds, Date.now(), activeWorkspace, unreadReplies),
    [cards, staleThresholds, activeWorkspace, unreadReplies]
  );

  const isQuiet =
    focus.yourTurn.length === 0 &&
    focus.agentRunning.length === 0 &&
    focus.waiting.total === 0 &&
    focus.waiting.stale === 0;

  return (
    <div className="flex-1 overflow-y-auto p-6">
      <div className="grid w-full grid-cols-1 gap-7 xl:grid-cols-[minmax(0,560px)_minmax(0,1fr)]">
        <div className="flex w-full max-w-[560px] flex-col gap-4">
          {/* The heading stays even on an empty board, so this column starts on
              the same line as the Today panel's heading beside it. */}
          <div className="flex flex-col gap-1.5">
            <FocusBlockHeading title="Your turn" count={focus.yourTurn.length} />
            {isQuiet ? (
              <QuietRow>
                <span>Nothing on the board yet.</span>
              </QuietRow>
            ) : focus.yourTurn.length === 0 ? (
              <QuietRow>
                <Check className="w-3.5 h-3.5 shrink-0 text-green-500" />
                <span>Nothing is waiting on you.</span>
              </QuietRow>
            ) : (
              focus.yourTurn.map((row) => <YourTurnRow key={row.card.id} row={row} />)
            )}
          </div>

          {focus.agentRunning.length > 0 && (
            <div className="flex flex-col gap-1.5">
              <FocusBlockHeading
                title="Agent running"
                count={focus.agentRunning.length}
                note="nothing for you"
              />
              {/* One line, not one row per card: these are not decisions, and a
                  list of them would compete with the block above that is. */}
              <QuietRow>
                <Cpu className="w-3.5 h-3.5 shrink-0 text-muted-foreground/70" />
                <span className="min-w-0 truncate">
                  {focus.agentRunning.map((card, index) => {
                    const project = projects.find((p) => p.id === card.projectId);
                    const displayId = getDisplayId(card, project);
                    return (
                      <span key={card.id}>
                        {index > 0 && " · "}
                        <button
                          type="button"
                          onClick={() => {
                            selectCard(card);
                            openModal();
                          }}
                          className={
                            displayId
                              ? "transition-opacity hover:opacity-80"
                              : "transition-colors hover:text-foreground"
                          }
                        >
                          {displayId ? (
                            <ProjectIdPill displayId={displayId} project={project} />
                          ) : (
                            card.title
                          )}
                        </button>{" "}
                        {card.processingType === "quick-fix"
                          ? "quick fix"
                          : card.processingType === "evaluate"
                            ? "evaluating"
                            : card.processingType === "generate"
                              ? "generating"
                              : "running"}
                      </span>
                    );
                  })}
                </span>
              </QuietRow>
            </div>
          )}

          {(focus.waiting.total > 0 || focus.waiting.stale > 0) && (
            <div className="flex flex-col gap-1.5">
              <FocusBlockHeading title="Waiting" count={focus.waiting.total} />
              <QuietRow>
                <Columns3 className="w-3.5 h-3.5 shrink-0 text-muted-foreground/70" />
                <span className="min-w-0 truncate font-mono text-[10.5px] tabular-nums">
                  {focus.waiting.buckets
                    .map((bucket) => `${bucket.title} ${bucket.count}`)
                    .join(" · ")}
                  {focus.waiting.stale > 0 && (
                    <>
                      {focus.waiting.buckets.length > 0 && " · "}
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <span className="cursor-default underline decoration-dotted underline-offset-2">
                            Stale {focus.waiting.stale}
                          </span>
                        </TooltipTrigger>
                        <TooltipContent side="top">
                          Untouched past their column&apos;s threshold. Held out of Your turn —
                          find them at the foot of each column.
                        </TooltipContent>
                      </Tooltip>
                    </>
                  )}
                </span>
                <button
                  type="button"
                  onClick={() => setBoardView("all")}
                  className="ml-auto shrink-0 rounded border border-border bg-card px-1.5 py-0.5 font-mono text-[9.5px] uppercase tracking-wide text-muted-foreground transition-colors hover:border-ink/40 hover:text-foreground"
                >
                  Go to board
                </button>
              </QuietRow>
            </div>
          )}
        </div>

        <aside className="hidden min-w-0 max-w-[560px] self-start border-l border-border pl-7 xl:sticky xl:top-0 xl:block xl:max-h-[calc(100vh-8rem)] xl:overflow-y-auto">
          <TodayPanel cards={cards} sources={todaySources} />
        </aside>
      </div>
    </div>
  );
}
