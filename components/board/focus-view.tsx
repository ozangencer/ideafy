"use client";

import { useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  Check,
  Columns3,
  Cpu,
  FlaskConical,
  Lightbulb,
  ListVideo,
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
import { formatElapsedShort, processRowLabel, processShortLabel } from "@/lib/process-labels";
import { useKanbanStore } from "@/lib/store";
import { prefetchToday } from "@/lib/today-cache";
import {
  BackgroundProcess,
  BoardView,
  Card,
  getDisplayId,
  Project,
  SectionType,
  TodaySource,
} from "@/lib/types";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { CardPhaseActions } from "./card-phase-actions";
import { QUEUE_KIND_SHORT, RunQueueChip } from "./run-queue-popover";
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
    { value: "chains", label: "Chains" },
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
  action,
}: {
  title: string;
  count?: number;
  note?: string;
  /** A control at the far right, after the note. */
  action?: React.ReactNode;
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
      {action && <span className={`shrink-0 self-center ${note ? "ml-2" : "ml-auto"}`}>{action}</span>}
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

// Up to this many runs each get their own line with the full label; past it
// they share one line and the phase shrinks to "impl" / "verify".
const MAX_RUN_LINES = 2;

const ELAPSED_TICK_MS = 30_000;

/** What a card with no registry entry yet (before the first poll) says. */
function processingFallback(card: Card): string {
  switch (card.processingType) {
    case "quick-fix":
      return "quick fix";
    case "evaluate":
      return "evaluating";
    case "generate":
      return "generating";
    default:
      return "running";
  }
}

/**
 * The registry entry behind a card's running state. Two runs can share a card
 * (an autonomous run and a chat): the one matching the card's own
 * `processingType` is the one Focus put it here for, else the oldest.
 */
function runningProcessFor(card: Card, processes: BackgroundProcess[]): BackgroundProcess | null {
  const running = processes.filter((p) => p.cardId === card.id && p.status === "running");
  if (running.length === 0) return null;
  return (
    running.find((p) => p.processType === card.processingType) ??
    [...running].sort((a, b) => Date.parse(a.startedAt) - Date.parse(b.startedAt))[0]
  );
}

/**
 * What each running agent is doing and for how long: "IDE-432 Implementation →
 * Human Test · 14m". "Running" alone does not answer the only question this
 * block is read for — come back now, or in an hour? Still quiet text, not rows
 * with buttons: none of it is a decision.
 */
function AgentRunningLines({ cards }: { cards: Card[] }) {
  const projects = useKanbanStore((s) => s.projects);
  const selectCard = useKanbanStore((s) => s.selectCard);
  const openModal = useKanbanStore((s) => s.openModal);
  const processes = useKanbanStore((s) => s.backgroundProcesses);

  // The store polls every 10s; a minute counter fed only by that would stall
  // and jump. Mounted only while something runs, so the tick is too.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const interval = setInterval(() => setNow(Date.now()), ELAPSED_TICK_MS);
    return () => clearInterval(interval);
  }, []);

  const compact = cards.length > MAX_RUN_LINES;
  const runs = cards.map((card) => {
    const project = projects.find((p) => p.id === card.projectId);
    const displayId = getDisplayId(card, project);
    const process = runningProcessFor(card, processes);
    const started = process ? Date.parse(process.startedAt) : NaN;
    const elapsed = Number.isNaN(started) ? null : formatElapsedShort(now - started);
    const label = process ? processRowLabel(process) : processingFallback(card);
    return {
      card,
      project,
      displayId,
      label: compact && process ? processShortLabel(process) : label,
      elapsed,
      // The full wording survives truncation and the compact line in the tooltip.
      full: [`${displayId ?? card.title} ${label}`, elapsed].filter(Boolean).join(" · "),
    };
  });

  const renderRun = (run: (typeof runs)[number]) => (
    <>
      <button
        type="button"
        onClick={() => {
          selectCard(run.card);
          openModal();
        }}
        className={
          run.displayId
            ? "transition-opacity hover:opacity-80"
            : "transition-colors hover:text-foreground"
        }
      >
        {run.displayId ? (
          <ProjectIdPill displayId={run.displayId} project={run.project} />
        ) : (
          run.card.title
        )}
      </button>{" "}
      {run.label}
      {run.elapsed && (
        <span className="font-mono text-[10.5px] tabular-nums text-muted-foreground/60">
          {" · "}
          {run.elapsed}
        </span>
      )}
    </>
  );

  const icon = <Cpu className="w-3.5 h-3.5 shrink-0 text-muted-foreground/70" />;

  if (!compact) {
    return (
      <>
        {runs.map((run) => (
          <QuietRow key={run.card.id}>
            {icon}
            <span className="min-w-0 truncate" title={run.full}>
              {renderRun(run)}
            </span>
          </QuietRow>
        ))}
      </>
    );
  }

  return (
    <QuietRow>
      {icon}
      <span className="min-w-0 truncate" title={runs.map((run) => run.full).join("\n")}>
        {runs.map((run, index) => (
          <span key={run.card.id}>
            {index > 0 && " · "}
            {renderRun(run)}
          </span>
        ))}
      </span>
    </QuietRow>
  );
}

/**
 * The run queue as one line under Agent running: what the agent picks up
 * next, in order, and which run each one is waiting for. One quiet line for
 * the same reason the running cards get quiet lines — none of it is a
 * decision — and managing it is the board's popover, opened
 * from Manage, not a second list to keep in step with it.
 */
function QueueLine() {
  const queue = useKanbanStore((s) => s.queueState);
  const cards = useKanbanStore((s) => s.cards);
  const projects = useKanbanStore((s) => s.projects);
  const selectCard = useKanbanStore((s) => s.selectCard);
  const openModal = useKanbanStore((s) => s.openModal);

  if (!queue || queue.items.length === 0) return null;
  const paused = !queue.armed;
  const waitingBehind = paused ? null : queue.running?.displayId ?? null;

  return (
    <QuietRow>
      <ListVideo
        className={`w-3.5 h-3.5 shrink-0 ${
          paused ? "text-amber-600 dark:text-amber-400" : "text-violet-600 dark:text-violet-400"
        }`}
      />
      <span className="min-w-0 flex-1 truncate">
        <span
          className={`font-mono text-[10.5px] tabular-nums ${
            paused ? "text-amber-600 dark:text-amber-400" : ""
          }`}
        >
          Queue {queue.items.length}
          {paused && " · paused"}
        </span>
        {queue.items.map((item, index) => {
          // The queue is global, so a card from another project shows up here
          // too; its pill wears that project's colour, which says so.
          const card = cards.find((c) => c.id === item.cardId);
          const project = projects.find((p) => p.id === card?.projectId);
          return (
            <span key={item.cardId}>
              {" · "}
              <button
                type="button"
                title={item.title}
                onClick={() => {
                  if (!card) return;
                  selectCard(card);
                  openModal();
                }}
                className="transition-opacity hover:opacity-80"
              >
                <ProjectIdPill displayId={item.displayId} project={project} />
              </button>{" "}
              {QUEUE_KIND_SHORT[item.kind]}
              {/* Why the head of the queue has not started. Not while paused:
                  there it starts after nothing until you resume it. */}
              {index === 0 && waitingBehind && (
                <span className="text-muted-foreground/60">, starts after {waitingBehind}</span>
              )}
            </span>
          );
        })}
      </span>
      <RunQueueChip
        align="end"
        trigger={({ count }) => (
          <button
            type="button"
            aria-label={`Manage run queue: ${count} waiting${paused ? ", paused" : ""}`}
            className="ml-auto shrink-0 rounded border border-border bg-card px-1.5 py-0.5 font-mono text-[9.5px] uppercase tracking-wide text-muted-foreground transition-colors hover:border-ink/40 hover:text-foreground"
          >
            Manage
          </button>
        )}
      />
    </QuietRow>
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
  const activeWorkspace = useKanbanStore((s) => s.activeWorkspace);
  // The bell polls this list for the topbar, so Focus reads the same copy
  // instead of fetching its own and drifting from the bell's dots.
  const activityEvents = useKanbanStore((s) => s.activityEvents);

  // The store keeps the same snapshot when a poll changes nothing, so this
  // and the board below only recompute when the queue really moved.
  const queueState = useKanbanStore((s) => s.queueState);

  const unreadReplies = useMemo(() => unreadSignalsByCard(activityEvents), [activityEvents]);
  const queuedIds = useMemo(
    () => new Set(queueState?.items.map((item) => item.cardId) ?? []),
    [queueState]
  );
  const queueLength = queueState?.items.length ?? 0;

  const focus = useMemo(
    () =>
      buildFocusBoard(cards, staleThresholds, Date.now(), activeWorkspace, unreadReplies, queuedIds),
    [cards, staleThresholds, activeWorkspace, unreadReplies, queuedIds]
  );

  const isQuiet =
    focus.yourTurn.length === 0 &&
    focus.agentRunning.length === 0 &&
    focus.queued.length === 0 &&
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

          {(focus.agentRunning.length > 0 || queueLength > 0) && (
            <div className="flex flex-col gap-1.5">
              <FocusBlockHeading
                title="Agent running"
                count={focus.agentRunning.length + queueLength}
                note="nothing for you"
              />
              {/* Quiet lines, not rows with buttons: these are not decisions,
                  and a list of them would compete with the block above that is. */}
              {focus.agentRunning.length > 0 && <AgentRunningLines cards={focus.agentRunning} />}
              <QueueLine />
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
