"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ArrowLeft, Check, ChevronUp } from "lucide-react";
import { focusDetail, getFocusState, isYourTurn } from "@/lib/board-focus";
import { openCardById } from "@/lib/open-card";
import { useKanbanStore } from "@/lib/store";
import { parseTestProgress } from "@/lib/test-progress";
import { loadToday, readToday } from "@/lib/today-cache";
import {
  Card,
  getColumnTitle,
  getDisplayId,
  TodayCard,
  TodayChip,
  TodaySource,
} from "@/lib/types";
import { FocusBlockHeading, ProjectIdPill, QuietRow } from "./focus-view";
import { keyboardBelongsElsewhere } from "./selection-bar";

const REFRESH_MS = 30_000;
const PLAN_PREVIEW_CHARS = 280;
// Newest first, so the cap keeps the latest work in view and folds the
// morning away — the same idea as the board columns' row cap.
const TODAY_ROW_CAP = 8;
const SKELETON_ROWS = 4;

function formatClock(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", hour12: false });
}

/** The plan's opening lines as plain text — enough to recall what was agreed. */
function planPreview(html: string): string {
  if (!html || typeof DOMParser === "undefined") return "";
  const doc = new DOMParser().parseFromString(html, "text/html");
  // A card mention's text is its editor form, "[[IDE-370 · Title]]"; the ID
  // alone reads better in a two-line preview.
  for (const mention of Array.from(doc.body.querySelectorAll("[data-display-id]"))) {
    mention.textContent = mention.getAttribute("data-display-id");
  }
  let text = "";
  for (const el of Array.from(doc.body.querySelectorAll("p, li"))) {
    const line = el.textContent?.replace(/\s+/g, " ").trim();
    if (!line) continue;
    text = text ? `${text} ${line}` : line;
    if (text.length >= PLAN_PREVIEW_CHARS) break;
  }
  return text.length > PLAN_PREVIEW_CHARS
    ? `${text.slice(0, PLAN_PREVIEW_CHARS).trimEnd()}…`
    : text;
}

const CHIP_STYLES: Record<TodayChip["kind"], string> = {
  completed: "text-green-600 dark:text-green-500 border-green-500/35 bg-green-500/[0.08]",
  run: "text-violet-600 dark:text-violet-400 border-violet-500/30 bg-ink/[0.04]",
  chat: "text-muted-foreground border-ink/15 bg-ink/[0.04]",
  terminal: "text-muted-foreground border-ink/15 bg-ink/[0.04]",
};

function Chip({ kind, children }: { kind: TodayChip["kind"]; children: React.ReactNode }) {
  return (
    <span
      className={`rounded border px-1.5 py-px font-mono text-[9.5px] tracking-[0.02em] ${CHIP_STYLES[kind]}`}
    >
      {kind === "completed" && <Check className="mr-0.5 inline h-2.5 w-2.5 -translate-y-px" />}
      {children}
    </span>
  );
}

/**
 * The day's cards, one row each, fetched quietly in the background.
 *
 * It refreshes on its own 30-second tick and when the window comes back, and
 * stops while the tab is hidden. No animation, no badge: this sits beside a
 * list whose job is to say what to do next, and a panel that moves would
 * compete with it for the same attention.
 */
function useTodayActivity(cards: Card[]) {
  const activeProjectId = useKanbanStore((s) => s.activeProjectId);
  // The list itself lives in the cache, keyed by project, so a second visit
  // to Focus paints the last answer at once and a project switch can never
  // show the other project's list. This only re-renders when an answer lands.
  const [, setVersion] = useState(0);

  const load = useCallback(async () => {
    // A failed fetch resolves to null and keeps the last good list.
    if (await loadToday(activeProjectId)) setVersion((v) => v + 1);
  }, [activeProjectId]);

  useEffect(() => {
    load();
    const interval = setInterval(() => {
      if (document.visibilityState === "visible") load();
    }, REFRESH_MS);
    const onVisible = () => {
      if (document.visibilityState === "visible") load();
    };
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("focus", onVisible);
    return () => {
      clearInterval(interval);
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("focus", onVisible);
    };
  }, [load]);

  // A card that changed on the board (completed, moved, a run finished) is
  // worth reloading for without waiting out the tick.
  const boardVersion = useMemo(
    () => cards.reduce((max, c) => (c.updatedAt > max ? c.updatedAt : max), ""),
    [cards]
  );
  const firstVersion = useRef(true);
  useEffect(() => {
    if (firstVersion.current) {
      firstVersion.current = false;
      return;
    }
    load();
  }, [boardVersion, load]);

  // Null until this project has an answer for today — past midnight
  // yesterday's list stops counting until the next tick replaces it.
  return readToday(activeProjectId);
}

/**
 * Stand-in rows for the first load, when the cache has nothing yet. Still on
 * purpose, like the rest of the panel: a shimmer would pull the eye away from
 * Your turn, which is already on screen.
 */
function TodaySkeleton() {
  return (
    <div aria-hidden>
      {Array.from({ length: SKELETON_ROWS }, (_, index) => (
        <div
          key={index}
          className="grid grid-cols-[48px_minmax(0,1fr)] gap-2.5 border-b border-border py-2 last:border-b-0"
        >
          <span className="mt-1 h-2.5 w-8 rounded-sm bg-ink/[0.04]" />
          <span className="flex flex-col gap-1.5">
            <span
              className="h-3.5 rounded-sm bg-ink/[0.04]"
              style={{ width: `${70 - index * 10}%` }}
            />
            <span className="flex gap-1">
              <span className="h-3 w-14 rounded bg-ink/[0.04]" />
              <span className="h-3 w-16 rounded bg-ink/[0.04]" />
            </span>
          </span>
        </div>
      ))}
    </div>
  );
}

function TodayRow({
  entry,
  card,
  onSelect,
}: {
  entry: TodayCard;
  card: Card;
  onSelect: () => void;
}) {
  const projects = useKanbanStore((s) => s.projects);
  const project = projects.find((p) => p.id === card.projectId);
  const displayId = getDisplayId(card, project);

  return (
    <button
      type="button"
      onClick={onSelect}
      className="group grid w-full grid-cols-[48px_minmax(0,1fr)] gap-2.5 border-b border-border py-2 text-left last:border-b-0"
    >
      <span className="pt-0.5 font-mono text-[10.5px] tabular-nums text-muted-foreground">
        {formatClock(entry.lastTouchedAt)}
      </span>
      <span className="flex min-w-0 flex-col gap-1">
        <span className="flex min-w-0 items-center gap-1.5 text-[13px] font-medium text-card-foreground">
          {displayId && (
            <ProjectIdPill displayId={displayId} project={project} className="text-[10.5px]" />
          )}
          <span className="truncate decoration-border underline-offset-[3px] group-hover:underline">
            {card.title}
          </span>
        </span>
        <span className="flex flex-wrap gap-1">
          {entry.chips.map((chip) => (
            <Chip key={`${chip.kind}-${chip.label}`} kind={chip.kind}>
              {chip.label}
            </Chip>
          ))}
        </span>
      </span>
    </button>
  );
}

function SourceGroup({ source }: { source: TodaySource }) {
  const entries = [...source.entries].sort((a, b) => b.at.localeCompare(a.at));
  return (
    <div className="flex flex-col gap-1.5">
      <FocusBlockHeading title={source.title} count={entries.length} note={source.note} />
      <div>
        {entries.map((entry) => (
          <button
            key={entry.id}
            type="button"
            onClick={entry.onOpen}
            disabled={!entry.onOpen}
            className="group grid w-full grid-cols-[48px_minmax(0,1fr)] gap-2.5 border-b border-border py-2 text-left last:border-b-0 disabled:cursor-default"
          >
            <span className="pt-0.5 font-mono text-[10.5px] tabular-nums text-muted-foreground">
              {formatClock(entry.at)}
            </span>
            <span className="flex min-w-0 flex-col gap-1">
              <span className="truncate text-[13px] font-medium text-card-foreground">
                {entry.actor && (
                  <span className="mr-1.5 font-mono text-[10.5px] text-muted-foreground">
                    {entry.actor}
                  </span>
                )}
                {entry.title}
              </span>
              {entry.chips.length > 0 && (
                <span className="flex flex-wrap gap-1">
                  {entry.chips.map((chip) => (
                    <Chip key={chip} kind="chat">
                      {chip}
                    </Chip>
                  ))}
                </span>
              )}
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}

function CardPreview({
  entry,
  card,
  onBack,
}: {
  entry: TodayCard | null;
  card: Card;
  onBack: () => void;
}) {
  const projects = useKanbanStore((s) => s.projects);
  const project = projects.find((p) => p.id === card.projectId);
  const displayId = getDisplayId(card, project);
  const state = getFocusState(card);
  const progress = parseTestProgress(card.testScenarios);
  const plan = useMemo(() => planPreview(card.solutionSummary), [card.solutionSummary]);

  const tests = progress?.core ?? progress;
  const testsLabel = progress
    ? progress.core
      ? `${progress.core.checked}/${progress.core.total} core · ${progress.checked}/${progress.total} total`
      : `${progress.checked}/${progress.total} checked`
    : null;

  return (
    <div className="flex flex-col gap-1.5">
      <FocusBlockHeading title="Card" note="Esc — back to Today" />
      <div className="flex flex-col">
        {displayId && (
          <ProjectIdPill displayId={displayId} project={project} className="self-start text-[10.5px]" />
        )}
        <h3 className="mt-1 text-[15px] font-semibold leading-snug text-foreground">{card.title}</h3>

        <dl className="my-3.5 grid grid-cols-[88px_minmax(0,1fr)] gap-x-2.5 gap-y-1.5 text-[12px]">
          <dt className="pt-px font-mono text-[10.5px] uppercase tracking-[0.08em] text-muted-foreground">
            Status
          </dt>
          <dd>{getColumnTitle(card.status, project?.mode)}</dd>
          {isYourTurn(state) && (
            <>
              <dt className="pt-px font-mono text-[10.5px] uppercase tracking-[0.08em] text-muted-foreground">
                Next
              </dt>
              <dd>{focusDetail(card)}</dd>
            </>
          )}
          {tests && testsLabel && (
            <>
              <dt className="pt-px font-mono text-[10.5px] uppercase tracking-[0.08em] text-muted-foreground">
                Tests
              </dt>
              <dd>
                <span className="tabular-nums">{testsLabel}</span>
                <div className="mt-1 h-[5px] w-40 overflow-hidden rounded-sm bg-ink/[0.06]">
                  <i
                    className="block h-full bg-green-500"
                    style={{ width: `${tests.total ? (tests.checked / tests.total) * 100 : 0}%` }}
                  />
                </div>
              </dd>
            </>
          )}
        </dl>

        {plan && (
          <p className="rounded-md border border-ink/15 bg-ink/[0.03] px-3 py-2.5 text-[12px] leading-relaxed text-foreground">
            {plan}
          </p>
        )}

        {entry && entry.steps.length > 0 && (
          <ul className="mt-3.5 border-l border-border">
            {entry.steps.map((step, index) => (
              <li
                key={`${step.at}-${index}`}
                className="relative pb-2 pl-3.5 text-[12px] before:absolute before:-left-1 before:top-[5px] before:h-[7px] before:w-[7px] before:rounded-full before:bg-border"
              >
                <span className="mr-1.5 font-mono text-[10.5px] tabular-nums text-muted-foreground">
                  {formatClock(step.at)}
                </span>
                {step.label}
              </li>
            ))}
          </ul>
        )}

        <div className="mt-3.5 flex gap-2">
          <button
            type="button"
            onClick={() => openCardById(card.id, entry?.lastSection ?? null)}
            className="rounded-md border border-ink bg-ink px-2.5 py-1 text-[12px] text-background transition-opacity hover:opacity-90"
          >
            Open card
          </button>
          <button
            type="button"
            onClick={onBack}
            className="inline-flex items-center gap-1 rounded-md border border-border bg-card px-2.5 py-1 text-[12px] text-foreground transition-colors hover:border-ink/40"
          >
            <ArrowLeft className="h-3 w-3" />
            Today
          </button>
        </div>
      </div>
    </div>
  );
}

/**
 * Focus view's right column: what you touched today, and a preview of any one
 * of those cards.
 *
 * One row per card rather than one per event. "What did I do today" is asked
 * about cards, not about the order things happened in, and folding the day into
 * chips means a card run three times reads as one line with "× 3" — the flood
 * the bell's dedup exists to prevent never forms in the first place.
 *
 * The list is intersected with the cards Focus view was handed, so the project
 * filter, the workspace and the search box narrow it exactly as they narrow
 * the board.
 */
export function TodayPanel({
  cards,
  sources = [],
}: {
  cards: Card[];
  sources?: TodaySource[];
}) {
  const today = useTodayActivity(cards);
  const isModalOpen = useKanbanStore((s) => s.isModalOpen);
  const hasCardSelection = useKanbanStore((s) => s.selectedCardIds.length > 0);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  // Local on purpose: leaving Focus folds the list again, and a refresh tick
  // that brings a new row leaves it as the user set it.
  const [showAll, setShowAll] = useState(false);

  const cardById = useMemo(() => new Map(cards.map((c) => [c.id, c])), [cards]);
  const rows = useMemo(
    () => (today ?? []).filter((entry) => cardById.has(entry.cardId)),
    [today, cardById]
  );

  const selectedCard = selectedId ? cardById.get(selectedId) ?? null : null;
  const selectedEntry = selectedId ? rows.find((r) => r.cardId === selectedId) ?? null : null;

  // The previewed card left the filter (project switch, search, deleted).
  useEffect(() => {
    if (selectedId && !cardById.has(selectedId)) setSelectedId(null);
  }, [selectedId, cardById]);

  // Esc steps back to Today, with the selection bar's stand-down rule: a text
  // field, an open dialog or a board multi-selection keeps its own Esc.
  useEffect(() => {
    if (!selectedId) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || e.metaKey || e.ctrlKey || e.altKey) return;
      if (hasCardSelection || keyboardBelongsElsewhere(e.target, isModalOpen)) return;
      e.preventDefault();
      setSelectedId(null);
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [selectedId, isModalOpen, hasCardSelection]);

  if (selectedCard) {
    return (
      <CardPreview
        entry={selectedEntry}
        card={selectedCard}
        onBack={() => setSelectedId(null)}
      />
    );
  }

  const visibleRows = showAll ? rows : rows.slice(0, TODAY_ROW_CAP);
  const hiddenCount = rows.length - visibleRows.length;
  const dateLabel = new Date().toLocaleDateString([], { day: "numeric", month: "short" });

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-col gap-1.5">
        {/* No count while loading: "Today 0" reads as an empty day. */}
        <FocusBlockHeading
          title="Today"
          count={today === null ? undefined : rows.length}
          note={dateLabel}
        />
        {today === null ? (
          <TodaySkeleton />
        ) : rows.length === 0 ? (
          <QuietRow>
            <span>Nothing touched today yet.</span>
          </QuietRow>
        ) : (
          <div className="flex flex-col gap-1.5">
            <div>
              {visibleRows.map((entry) => {
                const card = cardById.get(entry.cardId);
                if (!card) return null;
                return (
                  <TodayRow
                    key={entry.cardId}
                    entry={entry}
                    card={card}
                    onSelect={() => setSelectedId(entry.cardId)}
                  />
                );
              })}
            </div>
            {hiddenCount > 0 && (
              <button
                type="button"
                onClick={() => setShowAll(true)}
                className="w-full rounded-md border border-dashed border-border py-1.5 text-center font-mono text-[10px] text-muted-foreground transition-colors hover:text-foreground hover:border-ink/40"
              >
                +{hiddenCount} more
              </button>
            )}
            {showAll && rows.length > TODAY_ROW_CAP && (
              <button
                type="button"
                onClick={() => setShowAll(false)}
                className="flex w-full items-center justify-center gap-1 rounded py-1 font-mono text-[10px] text-muted-foreground transition-colors hover:text-foreground"
              >
                <ChevronUp className="w-3 h-3" />
                show fewer
              </button>
            )}
          </div>
        )}
      </div>

      {sources.map((source) => (
        <SourceGroup key={source.key} source={source} />
      ))}
    </div>
  );
}
