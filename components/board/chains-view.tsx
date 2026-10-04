"use client";

import { useMemo, useState } from "react";
import { AlertTriangle, ChevronDown, ChevronRight, ListVideo } from "lucide-react";
import {
  CardGroupSummary,
  chainOrderAnomaly,
  chainPillWindow,
  summarizeChainsForView,
} from "@/lib/card-group";
import { useKanbanStore } from "@/lib/store";
import {
  Card,
  getColumns,
  getColumnTitle,
  getDisplayId,
  Project,
  Status,
  STATUS_COLORS,
} from "@/lib/types";
import { StatusIcon } from "@/components/ui/status-icon";
import { CardGroupChip } from "./card-group-chip";
import { ChainRowMenu } from "./card-group-chain";
import { FocusBlockHeading, QuietRow } from "./focus-view";
import { QueueRankChip, RunQueueChip } from "./run-queue-popover";

// Past this many members a segment drops under ~3px on a normal window and the
// bar turns to noise. Runs of the same status then merge into one block —
// still in chain order, so a withdrawn card stays where it was dropped.
const SEGMENT_LIMIT = 40;

type Segment = {
  key: string;
  status: Status;
  weight: number;
  isNext: boolean;
  queued: boolean;
  label: string;
};

function displayIdOf(card: Card, projects: Project[]): string {
  return getDisplayId(card, projects.find((p) => p.id === card.projectId)) ?? card.title;
}

/**
 * Each queued card's place, 1-based. The view reads the whole snapshot,
 * which the board cards must not; here it is one map per poll that actually
 * changed the queue, since the store keeps the snapshot otherwise.
 */
function useQueueRanks(): Map<string, number> {
  const queue = useKanbanStore((s) => s.queueState);
  return useMemo(
    () => new Map(queue?.items.map((item, index) => [item.cardId, index + 1]) ?? []),
    [queue]
  );
}

/** Queued and not yet running: the board's `isQueued`, for a card in a chain. */
function queuedRank(card: Card, ranks: Map<string, number>): number {
  return card.processingType ? 0 : ranks.get(card.id) ?? 0;
}

/**
 * Every card group in the active workspace at once: how far along each one is
 * and where its cards sit.
 *
 * A view rather than a sidebar tab, because a group is a lens on the board,
 * not a place of its own — and it stores nothing. Every figure here is
 * `summarizeCardGroups` redrawn, so a percentage cannot drift from the cards.
 * Two lines per chain whatever its length; click one to open its matrix.
 */
export function ChainsView({ summaries }: { summaries: Map<string, CardGroupSummary> }) {
  const projects = useKanbanStore((s) => s.projects);
  const activeProjectId = useKanbanStore((s) => s.activeProjectId);
  const activeWorkspace = useKanbanStore((s) => s.activeWorkspace);
  const searchQuery = useKanbanStore((s) => s.searchQuery);
  const [openChainId, setOpenChainId] = useState<string | null>(null);
  const [showFinished, setShowFinished] = useState(false);

  const { open, finished } = useMemo(
    () =>
      summarizeChainsForView(summaries.values(), {
        query: searchQuery,
        projectId: activeProjectId,
        workspace: activeWorkspace,
        projects,
      }),
    [summaries, searchQuery, activeProjectId, activeWorkspace, projects]
  );

  const toggle = (groupId: string) =>
    setOpenChainId((current) => (current === groupId ? null : groupId));

  return (
    <div className="flex-1 overflow-y-auto p-6">
      <div className="flex w-full max-w-[1040px] flex-col gap-1.5">
        <FocusBlockHeading
          title="Chains"
          count={open.length}
          note="ordered by last move · progress excludes withdrawn"
          action={
            // The board's queue popover, so the order can be fixed or the
            // queue paused without leaving the chains for the board.
            <RunQueueChip
              align="end"
              trigger={({ count, paused }) => (
                <button
                  type="button"
                  aria-label={`Run queue: ${count} waiting${paused ? ", paused" : ""}`}
                  className={`inline-flex items-center gap-1 rounded px-1.5 py-0.5 font-mono text-[10.5px] tabular-nums transition-colors ${
                    paused
                      ? "bg-amber-500/15 text-amber-600 hover:bg-amber-500/25 dark:text-amber-400"
                      : "bg-violet-500/10 text-violet-600 hover:bg-violet-500/20 dark:text-violet-400"
                  }`}
                >
                  <ListVideo className="h-3 w-3" />
                  Queue {count}
                  {paused && " · paused"}
                </button>
              )}
            />
          }
        />
        {open.length === 0 && finished.length === 0 ? (
          <QuietRow>
            <span>
              {searchQuery
                ? `No chain matches “${searchQuery}”.`
                : "No chains here yet. Group cards from a card's chain picker to see them here."}
            </span>
          </QuietRow>
        ) : open.length === 0 ? (
          <QuietRow>
            <span>Every chain here is finished.</span>
          </QuietRow>
        ) : (
          open.map((summary) => (
            <ChainRow
              key={summary.group.id}
              summary={summary}
              expanded={openChainId === summary.group.id}
              onToggle={() => toggle(summary.group.id)}
            />
          ))
        )}

        {finished.length > 0 && (
          <>
            <button
              type="button"
              onClick={() => setShowFinished((v) => !v)}
              className="mt-3 flex items-center gap-1.5 font-mono text-[10.5px] uppercase tracking-[0.13em] text-muted-foreground transition-colors hover:text-foreground"
            >
              {showFinished ? (
                <ChevronDown className="h-3 w-3" />
              ) : (
                <ChevronRight className="h-3 w-3" />
              )}
              Finished
              <span className="tabular-nums text-muted-foreground/70">{finished.length}</span>
              <span className="ml-1 flex-1 border-t border-border" />
            </button>
            {showFinished &&
              finished.map((summary) => (
                <ChainRow
                  key={summary.group.id}
                  summary={summary}
                  expanded={openChainId === summary.group.id}
                  onToggle={() => toggle(summary.group.id)}
                  finished
                />
              ))}
          </>
        )}
      </div>
    </div>
  );
}

function ChainRow({
  summary,
  expanded,
  onToggle,
  finished = false,
}: {
  summary: CardGroupSummary;
  expanded: boolean;
  onToggle: () => void;
  finished?: boolean;
}) {
  const projects = useKanbanStore((s) => s.projects);
  const selectCard = useKanbanStore((s) => s.selectCard);
  const openModal = useKanbanStore((s) => s.openModal);
  const queueRanks = useQueueRanks();

  const { group, total, done, withdrawn, nextCard } = summary;
  const denominator = total - withdrawn;
  const { pills, more } = chainPillWindow(summary);
  const anomaly = chainOrderAnomaly(summary);

  const openCard = (card: Card) => {
    selectCard(card);
    openModal();
  };

  return (
    <div
      className={`rounded-md border bg-card ${
        expanded ? "border-ink/25" : "border-border"
      } ${finished && !expanded ? "opacity-60" : ""}`}
    >
      {/* The head is the fold toggle; pills sit outside it because a button
          cannot hold buttons. */}
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={expanded}
        className="grid w-full grid-cols-[14px_64px_220px_minmax(80px,1fr)_132px_120px] items-center gap-3 rounded-t-md px-3 pt-2.5 pb-1.5 text-left transition-colors hover:bg-ink/[0.04]"
      >
        {expanded ? (
          <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />
        ) : (
          <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" />
        )}
        <span className="flex min-w-0">
          <CardGroupChip group={group} />
        </span>
        <span className="truncate text-[13px] font-medium text-card-foreground">{group.name}</span>
        <ChainBar summary={summary} projects={projects} queueRanks={queueRanks} />
        <span className="truncate text-right font-mono text-[11px] tabular-nums text-muted-foreground">
          <span className={done > 0 ? "font-semibold text-green-500" : undefined}>{done}</span>/
          {denominator}
          {withdrawn > 0 && <span className="opacity-70"> · {withdrawn} withdrawn</span>}
        </span>
        <span className="truncate text-right font-mono text-[11px]">
          {nextCard ? (
            <span className="text-foreground">next → {displayIdOf(nextCard, projects)}</span>
          ) : (
            <span className="text-muted-foreground">—</span>
          )}
        </span>
      </button>

      {!finished && (
        <div className="flex items-center gap-1.5 overflow-hidden whitespace-nowrap px-3 pb-2.5 pl-[115px]">
          {done > 0 && (
            <SummaryPill status="completed" label={`${done} done`} />
          )}
          {withdrawn > 0 && (
            <SummaryPill status="withdrawn" label={`${withdrawn} withdrawn`} />
          )}
          {pills.map((card) => {
            const rank = queuedRank(card, queueRanks);
            return (
              <button
                key={card.id}
                type="button"
                title={rank > 0 ? `${card.title} · queued #${rank}` : card.title}
                onClick={() => openCard(card)}
                // Queued speaks the board's violet: the wash and border a
                // queued card wears in its column. Next keeps its ink border.
                className={`group/pill inline-flex shrink-0 items-center gap-1.5 rounded-full border px-2 py-0.5 font-mono text-[10.5px] transition-colors hover:bg-accent hover:text-accent-foreground ${
                  card.id === nextCard?.id
                    ? "border-ink/60 text-foreground"
                    : rank > 0
                    ? "border-violet-500/[0.45] text-muted-foreground dark:border-violet-400/35"
                    : "border-border text-muted-foreground"
                } ${rank > 0 ? "bg-violet-500/10 dark:bg-violet-400/10" : ""}`}
              >
                <StatusIcon status={card.status} size={10} />
                <span className="max-w-[160px] truncate text-current">{displayIdOf(card, projects)}</span>
                {rank > 0 && (
                  <span className="inline-flex items-center gap-0.5 tabular-nums text-violet-600 group-hover/pill:text-current dark:text-violet-400">
                    <ListVideo className="h-2.5 w-2.5" />
                    {rank}
                  </span>
                )}
              </button>
            );
          })}
          {more > 0 && (
            <button
              type="button"
              onClick={onToggle}
              className="shrink-0 px-1 font-mono text-[10.5px] text-muted-foreground underline decoration-dotted underline-offset-2 transition-colors hover:text-foreground"
            >
              +{more} more →
            </button>
          )}
        </div>
      )}

      {!finished && anomaly && nextCard && (
        <div className="flex items-center gap-1.5 px-3 pb-2.5 pl-[115px] text-[11.5px] text-amber-600 dark:text-amber-500">
          <AlertTriangle className="h-3 w-3 shrink-0" />
          <span className="truncate">
            {displayIdOf(anomaly, projects)} comes after {displayIdOf(nextCard, projects)} in the
            chain but is already further along
          </span>
        </div>
      )}

      {expanded && <ChainMatrix summary={summary} />}
    </div>
  );
}

function SummaryPill({ status, label }: { status: Status; label: string }) {
  return (
    <span className="inline-flex shrink-0 items-center gap-1.5 rounded-full border border-dashed border-ink/15 px-2 py-0.5 font-mono text-[10.5px] text-muted-foreground">
      <StatusIcon status={status} size={10} />
      {label}
    </span>
  );
}

/**
 * Where every card is, read left to right in chain order: one segment per
 * card in its status colour, next outlined. "Where is that card?" is answered
 * here without opening anything.
 */
function ChainBar({
  summary,
  projects,
  queueRanks,
}: {
  summary: CardGroupSummary;
  projects: Project[];
  queueRanks: Map<string, number>;
}) {
  const activeWorkspace = useKanbanStore((s) => s.activeWorkspace);
  const { members, nextCard } = summary;

  const segments: Segment[] = [];
  for (const card of members) {
    const isNext = card.id === nextCard?.id;
    const rank = queuedRank(card, queueRanks);
    const label = `${displayIdOf(card, projects)} · ${getColumnTitle(card.status, activeWorkspace)}${
      rank > 0 ? ` · queued #${rank}` : ""
    }`;
    const last = segments[segments.length - 1];
    // A queued card keeps its own segment, or its place would merge away.
    if (
      members.length > SEGMENT_LIMIT &&
      !isNext &&
      rank === 0 &&
      last &&
      !last.isNext &&
      !last.queued &&
      last.status === card.status
    ) {
      last.weight += 1;
      last.label = `${last.weight} × ${getColumnTitle(card.status, activeWorkspace)}`;
      continue;
    }
    segments.push({ key: card.id, status: card.status, weight: 1, isNext, queued: rank > 0, label });
  }

  return (
    <span className="flex h-2 min-w-0 items-stretch gap-0.5 py-px">
      {segments.map((segment) => (
        <span
          key={segment.key}
          title={segment.label}
          style={{ flexGrow: segment.weight }}
          className={`min-w-[3px] basis-0 rounded-[2px] ${STATUS_COLORS[segment.status]} ${
            segment.status === "withdrawn" ? "opacity-40" : ""
          } ${segment.isNext ? "outline outline-2 outline-offset-1 outline-ink" : ""}`}
        />
      ))}
    </span>
  );
}

/**
 * The chain opened up: rows in chain order, the workspace's columns across,
 * one dot where each card sits — where the chain is piling up is visible at a
 * glance. The finished stretch ahead of next folds into one line so the first
 * row you read is the card the chain is waiting on.
 *
 * Reordering goes through the same "⋯" menu as the chain popover; no drag
 * handles, because the order is a relation ("after IDE-331"), not a slot.
 */
function ChainMatrix({ summary }: { summary: CardGroupSummary }) {
  const projects = useKanbanStore((s) => s.projects);
  const activeWorkspace = useKanbanStore((s) => s.activeWorkspace);
  const selectCard = useKanbanStore((s) => s.selectCard);
  const openModal = useKanbanStore((s) => s.openModal);
  const placeCardInChain = useKanbanStore((s) => s.placeCardInChain);
  const [showPrefix, setShowPrefix] = useState(false);
  const queueRanks = useQueueRanks();

  const { group, members, nextCard } = summary;

  // Bugs and Withdrawn only earn a column when a member is in them — seven
  // columns of which two are always empty is width the titles need.
  const columns = getColumns(activeWorkspace).filter(
    (column) =>
      (column.id !== "bugs" && column.id !== "withdrawn") ||
      members.some((card) => card.status === column.id)
  );

  // Everything ahead of next is finished by definition. Folding it is only
  // worth a row when it hides more than one.
  const nextIndex = nextCard ? members.findIndex((card) => card.id === nextCard.id) : -1;
  const prefixLength = nextIndex >= 2 ? nextIndex : 0;
  const prefix = members.slice(0, prefixLength);
  const prefixDone = prefix.filter((card) => card.status === "completed").length;
  const prefixWithdrawn = prefix.length - prefixDone;

  return (
    <div className="max-h-[420px] overflow-auto border-t border-border">
      <table className="w-full min-w-[640px] table-fixed border-collapse text-xs">
        <thead>
          <tr>
            <th className="sticky top-0 z-10 w-9 bg-card px-2 py-1.5 text-left font-mono text-[10px] font-normal text-muted-foreground">
              #
            </th>
            <th className="sticky top-0 z-10 bg-card px-2 py-1.5 text-left font-mono text-[10px] font-normal uppercase tracking-wider text-muted-foreground">
              Card
            </th>
            {columns.map((column) => (
              <th
                key={column.id}
                className="sticky top-0 z-10 w-[84px] truncate bg-card px-1 py-1.5 text-center font-mono text-[10px] font-normal uppercase tracking-wider text-muted-foreground"
              >
                {column.title}
              </th>
            ))}
            <th className="sticky top-0 z-10 w-8 bg-card" />
          </tr>
        </thead>
        <tbody>
          {prefixLength > 0 && !showPrefix && (
            <tr className="border-t border-border bg-ink/[0.04]">
              <td colSpan={columns.length + 3} className="p-0">
                <button
                  type="button"
                  onClick={() => setShowPrefix(true)}
                  className="flex w-full items-center gap-2 px-2 py-1.5 text-left text-[11.5px] text-muted-foreground transition-colors hover:text-foreground"
                >
                  <ChevronRight className="h-3 w-3" />
                  <span className="font-mono tabular-nums">1–{prefixLength}</span>
                  <span>
                    · {prefixDone} completed
                    {prefixWithdrawn > 0 && `, ${prefixWithdrawn} withdrawn`} — show
                  </span>
                </button>
              </td>
            </tr>
          )}
          {members.map((card, index) => {
            if (index < prefixLength && !showPrefix) return null;
            const project = projects.find((p) => p.id === card.projectId);
            const isNext = card.id === nextCard?.id;
            const isQueued = queuedRank(card, queueRanks) > 0;
            // "After X" is a no-op when X already sits right in front.
            const anchors = members.filter(
              (member, i) => member.id !== card.id && i !== index - 1
            );
            return (
                <tr
                  key={card.id}
                  onClick={() => {
                    selectCard(card);
                    openModal();
                  }}
                  className={`group/row cursor-pointer border-t border-border transition-colors hover:bg-ink/[0.08] ${
                    isNext ? "bg-ink/[0.05]" : ""
                  }`}
                >
                  <td className="px-2 py-1.5 font-mono text-[10.5px] tabular-nums text-muted-foreground">
                    {index + 1}
                  </td>
                  <td className="px-2 py-1.5">
                    <div className="flex min-w-0 items-center gap-2">
                      <span className="shrink-0 font-mono text-[10.5px] text-current">
                        {getDisplayId(card, project) ?? "draft"}
                      </span>
                      <span className="min-w-0 truncate">{card.title}</span>
                      {isNext && (
                        <span className="shrink-0 rounded bg-primary/15 px-1 font-mono text-[9px] uppercase text-current">
                          next
                        </span>
                      )}
                      {/* "In Backlog, but up next for the agent" without
                          reading the row: the board's queue chip, small. */}
                      {isQueued && <QueueRankChip cardId={card.id} size="inline" />}
                    </div>
                  </td>
                  {columns.map((column) => (
                    <td key={column.id} className="px-1 py-1.5 text-center">
                      {card.status === column.id && (
                        <span
                          className={`inline-flex rounded-full align-middle ${
                            isQueued
                              ? "ring-2 ring-violet-500/60 ring-offset-1 ring-offset-card dark:ring-violet-400/60"
                              : ""
                          }`}
                        >
                          <StatusIcon status={card.status} size={12} />
                        </span>
                      )}
                    </td>
                  ))}
                  {/* The menu renders in a portal, but React still bubbles its
                      clicks through this tree — without the stop, "Move to
                      start" would also open the card. */}
                  <td className="px-1 py-1" onClick={(event) => event.stopPropagation()}>
                    {(index > 0 || anchors.length > 0) && (
                      <ChainRowMenu
                        card={card}
                        project={project}
                        canMoveToStart={index > 0}
                        anchors={anchors}
                        projects={projects}
                        onPlace={(afterCardId) =>
                          placeCardInChain(group.id, card.id, afterCardId)
                        }
                      />
                    )}
                  </td>
                </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
