"use client";

import { useMemo, useState } from "react";
import {
  AlertTriangle,
  Check,
  Columns3,
  Cpu,
  FlaskConical,
  Lightbulb,
  Loader2,
  Play,
  Terminal,
  Unlock,
} from "lucide-react";
import {
  buildFocusBoard,
  focusDetail,
  FOCUS_STATE_STYLES,
  FocusRow,
} from "@/lib/board-focus";
import {
  canRunAutonomousFor,
  canStartCard,
  canTestTogetherFor,
  detectBoardPhase,
  getPhaseLabels,
  VERIFY_RUN_BLURB,
} from "@/lib/card-phase";
import { stripHtml } from "@/lib/prompts/utils";
import { parseTestProgress } from "@/lib/test-progress";
import { useKanbanStore } from "@/lib/store";
import { BoardView, Card, getDisplayId } from "@/lib/types";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
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
  getEffectiveTerminal,
  getPasteTipTerminalLabel,
  needsPasteTip,
  PasteTipDialog,
} from "./paste-tip-dialog";

const STATE_ICONS = {
  AlertTriangle,
  Check,
  FlaskConical,
  Lightbulb,
} as const;

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

function FocusBlockHeading({
  title,
  count,
  note,
}: {
  title: string;
  count: number;
  note?: string;
}) {
  return (
    <div className="flex items-baseline gap-1.5">
      <h4 className="font-mono text-[10.5px] font-semibold uppercase tracking-[0.13em] text-muted-foreground">
        {title}
      </h4>
      <span className="font-mono text-[10.5px] tabular-nums text-muted-foreground/70">
        {count}
      </span>
      {note && <span className="ml-auto text-[10.5px] text-muted-foreground/70">{note}</span>}
    </div>
  );
}

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
  const startTask = useKanbanStore((s) => s.startTask);
  const openTerminal = useKanbanStore((s) => s.openTerminal);
  const openTestTerminal = useKanbanStore((s) => s.openTestTerminal);
  const startingLocal = useKanbanStore((s) => s.startingCardIds.includes(card.id));
  const lockedLocal = useKanbanStore((s) => s.lockedCardIds.includes(card.id));
  const settings = useKanbanStore((s) => s.settings);
  const unlockCard = useKanbanStore((s) => s.unlockCard);

  const [showAutonomousConfirm, setShowAutonomousConfirm] = useState(false);
  const [showTerminalConfirm, setShowTerminalConfirm] = useState(false);
  const [showTestTogetherConfirm, setShowTestTogetherConfirm] = useState(false);

  const solutionSummaryText = useMemo(
    () => stripHtml(card.solutionSummary),
    [card.solutionSummary]
  );
  const testScenariosText = useMemo(
    () => stripHtml(card.testScenarios),
    [card.testScenarios]
  );
  const testProgress = useMemo(
    () => parseTestProgress(card.testScenarios),
    [card.testScenarios]
  );

  // Same phase the board would compute, rather than a hardcoded "verify": a
  // Human Test card with no checklist is not in the verify phase, and its
  // terminal is still the one the board labels for whatever phase it is in.
  const phase = detectBoardPhase(card, solutionSummaryText, testScenariosText);
  const phaseLabels = getPhaseLabels(phase);

  // A card whose row is in Your turn cannot be processing — `getFocusState`
  // would have routed it to Agent running — but the check costs nothing and
  // closes the gap between a run starting and the next poll.
  const isLocked = lockedLocal || !!card.processingType;
  const isStarting = startingLocal || card.processingType === "autonomous";

  const showPlay = canRunAutonomousFor(card, testProgress);
  const showTerminal = canStartCard(card);
  const showTestTogether = canTestTogetherFor(card, testScenariosText);

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

  if (!showPlay && !showTerminal && !showTestTogether) return null;

  const pasteTipLabel = getPasteTipTerminalLabel(getEffectiveTerminal(settings));
  const askPasteTip = needsPasteTip(settings);

  const runTerminal = () => {
    setShowTerminalConfirm(false);
    void openTerminal(card.id);
  };
  const runTestTogether = () => {
    setShowTestTogetherConfirm(false);
    void openTestTerminal(card.id);
  };

  return (
    <div className="flex shrink-0 items-center gap-1">
      {showPlay && (
        <>
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                type="button"
                onClick={() => setShowAutonomousConfirm(true)}
                disabled={isStarting}
                className={`p-1 rounded transition-colors ${
                  isStarting
                    ? "bg-ink/20 text-ink cursor-wait"
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
          <AlertDialog open={showAutonomousConfirm} onOpenChange={setShowAutonomousConfirm}>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Start {phaseLabels.play}?</AlertDialogTitle>
                <AlertDialogDescription asChild>
                  <div className="space-y-2">
                    <p>This will run in autonomous mode with full file access.</p>
                    <p className="text-muted-foreground">{VERIFY_RUN_BLURB}</p>
                  </div>
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Cancel</AlertDialogCancel>
                <AlertDialogAction
                  onClick={() => {
                    setShowAutonomousConfirm(false);
                    void startTask(card.id);
                  }}
                >
                  Start
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </>
      )}

      {showTerminal && (
        <>
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                type="button"
                onClick={() => (askPasteTip ? setShowTerminalConfirm(true) : runTerminal())}
                className="p-1 rounded transition-colors bg-orange-500/10 text-orange-500/70 hover:bg-orange-500/20 hover:text-orange-500"
              >
                <Terminal className="w-3.5 h-3.5" />
              </button>
            </TooltipTrigger>
            <TooltipContent side="top">{phaseLabels.terminal}</TooltipContent>
          </Tooltip>
          <PasteTipDialog
            open={showTerminalConfirm}
            onOpenChange={setShowTerminalConfirm}
            title="Open Interactive Terminal"
            terminalLabel={pasteTipLabel}
            confirmLabel="Open Terminal"
            confirmClassName="bg-orange-500 hover:bg-orange-600"
            onConfirm={runTerminal}
          />
        </>
      )}

      {showTestTogether && (
        <>
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                type="button"
                onClick={() =>
                  askPasteTip ? setShowTestTogetherConfirm(true) : runTestTogether()
                }
                className="p-1 rounded transition-colors bg-emerald-500/10 text-emerald-500/70 hover:bg-emerald-500/20 hover:text-emerald-500"
              >
                <FlaskConical className="w-3.5 h-3.5" />
              </button>
            </TooltipTrigger>
            <TooltipContent side="top">Test Together (Interactive)</TooltipContent>
          </Tooltip>
          <PasteTipDialog
            open={showTestTogetherConfirm}
            onOpenChange={setShowTestTogetherConfirm}
            title="Test Together"
            lead="Start an interactive test session with Claude as your QA partner."
            terminalLabel={pasteTipLabel}
            confirmLabel="Start Testing"
            confirmClassName="bg-emerald-500 hover:bg-emerald-600"
            onConfirm={runTestTogether}
          />
        </>
      )}
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
  const detail = focusDetail(row.card);

  const open = () => {
    // The row already named the next move, so landing on the Detail tab and
    // making you find it again would waste the one thing the row bought.
    setPendingCardSection(style.section);
    selectCard(row.card);
    openModal();
  };

  return (
    <div className="flex items-center gap-2 rounded-md border border-border bg-card px-2.5 py-2">
      <span className={`grid w-4 shrink-0 place-items-center ${style.color}`}>
        <Icon className="w-3.5 h-3.5" />
      </span>
      <button
        type="button"
        onClick={open}
        className="flex min-w-0 flex-1 flex-col items-start gap-0.5 text-left"
      >
        <span className="w-full truncate text-[13px] font-medium text-card-foreground">
          {row.card.title}
        </span>
        <span className="font-mono text-[10.5px] tabular-nums text-muted-foreground">
          {displayId ? `${displayId} · ` : ""}
          {detail}
        </span>
      </button>
      {row.state === "your-test" && <TestRowActions card={row.card} />}
      <button
        type="button"
        onClick={open}
        className="shrink-0 rounded border border-border bg-card px-1.5 py-0.5 font-mono text-[9.5px] uppercase tracking-wide text-muted-foreground transition-colors hover:border-ink/40 hover:text-foreground"
      >
        {style.action}
      </button>
    </div>
  );
}

function QuietRow({ children }: { children: React.ReactNode }) {
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
 */
export function FocusView({ cards }: { cards: Card[] }) {
  const staleThresholds = useKanbanStore((s) => s.staleThresholds);
  const setBoardView = useKanbanStore((s) => s.setBoardView);
  const projects = useKanbanStore((s) => s.projects);
  const selectCard = useKanbanStore((s) => s.selectCard);
  const openModal = useKanbanStore((s) => s.openModal);

  const focus = useMemo(
    () => buildFocusBoard(cards, staleThresholds),
    [cards, staleThresholds]
  );

  const isQuiet =
    focus.yourTurn.length === 0 &&
    focus.agentRunning.length === 0 &&
    focus.waiting.total === 0 &&
    focus.waiting.stale === 0;

  return (
    <div className="flex-1 overflow-y-auto p-6">
      <div className="flex w-full max-w-[560px] flex-col gap-4">
        {isQuiet && (
          <QuietRow>
            <span>Nothing on the board yet.</span>
          </QuietRow>
        )}

        {(focus.yourTurn.length > 0 || !isQuiet) && (
          <div className="flex flex-col gap-1.5">
            <FocusBlockHeading title="Your turn" count={focus.yourTurn.length} />
            {focus.yourTurn.length === 0 ? (
              <QuietRow>
                <Check className="w-3.5 h-3.5 shrink-0 text-green-500" />
                <span>Nothing is waiting on you.</span>
              </QuietRow>
            ) : (
              focus.yourTurn.map((row) => <YourTurnRow key={row.card.id} row={row} />)
            )}
          </div>
        )}

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
                        className="font-mono transition-colors hover:text-foreground"
                      >
                        {displayId ?? card.title}
                      </button>{" "}
                      {card.processingType === "quick-fix"
                        ? "quick fix"
                        : card.processingType === "evaluate"
                          ? "evaluating"
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
    </div>
  );
}
