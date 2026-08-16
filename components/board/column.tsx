"use client";

import { ReactNode, useEffect, useMemo, useRef, useState } from "react";
import { useDroppable } from "@dnd-kit/core";
import {
  Card as CardType,
  Status,
  STATUS_COLORS,
  COLUMN_WIP_LIMITS,
  COMPLETED_FILTER_OPTIONS,
  CompletedFilter,
  getDisplayId,
} from "@/lib/types";
import {
  buildColumnRows,
  CardGroupSummary,
  ColumnRow,
  groupFoldKey,
  STALE_GROUP_ID,
} from "@/lib/card-group";
import { formatAgeShort, StaleGroup } from "@/lib/card-age";
import { useKanbanStore } from "@/lib/store";
import { TaskCard } from "./card";
import { CardGroupChip } from "./card-group-chip";
import { ChevronLeft, ChevronRight, ChevronUp } from "lucide-react";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
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
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

// Default column width (w-72), used until the real one is measured so the
// first paint matches what the layout is about to settle on.
const DEFAULT_COLUMN_W = 288;

/**
 * The column's own width, observed. Cards need it to decide whether the
 * project name fits in their footer, and with fluid columns that is no longer
 * a constant. One observer per column — seven on the board, not one per card,
 * which is what made measuring too expensive to do inside the card itself.
 */
function useColumnWidth() {
  const ref = useRef<HTMLDivElement | null>(null);
  const [width, setWidth] = useState(DEFAULT_COLUMN_W);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const observer = new ResizeObserver(([entry]) => {
      const next = Math.round(entry.contentRect.width);
      // Ignore the collapsed state's 40px: the cards are unmounted then, and
      // letting it through would make every card re-render twice on collapse.
      if (next > 0) setWidth((prev) => (prev === next ? prev : next));
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  return { ref, width };
}

// Above this many members, an expanded group runs past the fold and its own
// header — the only way to close it again — scrolls out of reach. Four cards
// still sit within a column's viewport alongside the row, so the footer would
// be noise there.
const COLLAPSE_FOOTER_MIN_MEMBERS = 5;

// How many rows a column paints before the rest folds behind one button. Seven
// is about a screen's worth: past it you are scrolling inside a column to find
// out what a column contains, which is the density problem the whole card
// exists to fix. Note this counts rows, not cards — a folded chain of fourteen
// is one row, and shortening the board by hiding a group that is already one
// line tall would buy nothing.
const COLUMN_ROW_CAP = 7;

/**
 * The frame a folded row lives in: one dashed box, a chevron header that
 * toggles it, an indented sub-line, and — once open and long enough — a way
 * back to a header that has scrolled out of reach.
 *
 * Chains and Stale share it because they differ in what they say, not in how
 * they behave. Two hand-rolled copies would drift the first time either one
 * was touched, and a Stale box that folded differently from the chain three
 * cards above it would read as two unrelated features.
 */
function FoldableBlock({
  isExpanded,
  onToggle,
  header,
  sub,
  actions,
  memberCount,
  collapseLabel,
  children,
}: {
  isExpanded: boolean;
  onToggle: () => void;
  /** Sits inside the toggle button, after the chevron. */
  header: ReactNode;
  sub?: ReactNode;
  actions?: ReactNode;
  memberCount: number;
  collapseLabel: string;
  children?: ReactNode;
}) {
  return (
    // One box, folded or not: opening the row grows it rather than spawning
    // loose cards into the column's flow. Without it an expanded member and
    // the ungrouped card beneath it are indistinguishable, and the row has no
    // visible end.
    <div className="rounded-md border border-dashed border-border bg-muted/50 p-1.5 space-y-1.5">
      <div className={isExpanded ? "px-0.5 pb-1 border-b border-dashed border-border" : "px-0.5"}>
        <button
          type="button"
          onClick={onToggle}
          className="flex w-full items-center gap-1.5 text-left"
        >
          <ChevronRight
            className={`w-3 h-3 shrink-0 text-muted-foreground transition-transform ${
              isExpanded ? "rotate-90" : ""
            }`}
          />
          {header}
        </button>
        {sub && (
          <div className="pl-[18px] text-[10px] text-muted-foreground font-mono">{sub}</div>
        )}
        {actions && <div className="pl-[18px] mt-1 flex flex-wrap gap-1">{actions}</div>}
      </div>

      {children}

      {/* Nothing sits under a folded row. A "+N more" button there was a third
          control repeating what the chevron and the sub-line already say, and
          it doubled the height of the very thing this feature exists to
          shrink. Expanded is where a footer earns its place: by then the
          header has scrolled away and there is no way back to it. */}
      {isExpanded && memberCount >= COLLAPSE_FOOTER_MIN_MEMBERS && (
        <button
          type="button"
          onClick={onToggle}
          className="flex w-full items-center justify-center gap-1 rounded py-1 font-mono text-[10px] text-muted-foreground transition-colors hover:text-foreground"
        >
          <ChevronUp className="w-3 h-3" />
          {collapseLabel}
        </button>
      )}
    </div>
  );
}

/**
 * A chain folded into one slot. The row carries what the 14 cards underneath
 * it used to carry between them: how far the chain has got (board-wide, so the
 * count survives the members spreading across columns) and which card is next.
 */
function CardGroupBlock({
  row,
  columnId,
  columnWidth,
}: {
  row: Extract<ColumnRow, { kind: "group" }>;
  columnId: Status;
  columnWidth: number;
}) {
  const projects = useKanbanStore((s) => s.projects);
  const expandedGroups = useKanbanStore((s) => s.expandedGroups);
  const toggleGroupCollapse = useKanbanStore((s) => s.toggleGroupCollapse);
  const selectCard = useKanbanStore((s) => s.selectCard);
  const openModal = useKanbanStore((s) => s.openModal);

  const { summary, columnMembers } = row;
  const { group, done, total, nextCard } = summary;
  const foldKey = groupFoldKey(group.id, columnId);
  const isExpanded = expandedGroups.includes(foldKey);

  // Folded means folded. The chevron is a disclosure control, so leaving one
  // member on screen under a closed row breaks what the control promises —
  // and makes it ambiguous whether that card is inside the group or a sibling
  // below it.
  const visibleCards = isExpanded ? columnMembers : [];
  const hiddenCount = columnMembers.length - visibleCards.length;

  const nextProject = nextCard
    ? projects.find((p) => p.id === nextCard.projectId)
    : undefined;
  const nextDisplayId = nextCard ? getDisplayId(nextCard, nextProject) : null;

  const header = (
    <>
      <ChevronRight
        className={`w-3 h-3 shrink-0 text-muted-foreground transition-transform ${
          isExpanded ? "rotate-90" : ""
        }`}
      />
      <CardGroupChip group={group} />
      <span className="text-xs font-semibold text-foreground truncate min-w-0">
        {group.name}
      </span>
      {/* "done" is not decoration. Next to a chevron and a "3 collapsed"
          counter, a bare 0/4 reads as "0 of 4 shown here" — the one thing it
          does not mean. */}
      <Tooltip>
        <TooltipTrigger asChild>
          <span className="ml-auto shrink-0 font-mono text-[10px] tabular-nums text-muted-foreground whitespace-nowrap cursor-default">
            <span className={done > 0 ? "font-semibold text-green-500" : undefined}>
              {done}
            </span>
            /{total} done
          </span>
        </TooltipTrigger>
        <TooltipContent side="top">
          {done} of {total} card{total === 1 ? "" : "s"} in this chain completed
        </TooltipContent>
      </Tooltip>
    </>
  );

  return (
    <FoldableBlock
      isExpanded={isExpanded}
      onToggle={() => toggleGroupCollapse(foldKey)}
      header={header}
      memberCount={columnMembers.length}
      collapseLabel={`collapse ${group.code}`}
      sub={
        (nextDisplayId || hiddenCount > 0) && (
          <>
            {nextDisplayId && nextCard && (
              // The id is the handle, so folding costs no reach: the card the
              // chain is waiting on is still one click away without a card
              // body sitting under a closed row.
              <>
                next:{" "}
                <button
                  type="button"
                  onClick={() => {
                    selectCard(nextCard);
                    openModal();
                  }}
                  className="underline decoration-dotted underline-offset-2 transition-colors hover:text-foreground"
                >
                  {nextDisplayId}
                </button>
              </>
            )}
            {nextDisplayId && hiddenCount > 0 && " · "}
            {hiddenCount > 0 && `${hiddenCount} collapsed`}
          </>
        )
      }
    >
      {visibleCards.map((card) => (
        <TaskCard
          key={card.id}
          card={card}
          group={group}
          columnWidth={columnWidth}
          inGroupFrame
        />
      ))}
    </FoldableBlock>
  );
}

/**
 * The cards a column has stopped moving, gathered at its foot.
 *
 * Not a column of its own: a stale card has not changed what it is, only how
 * long it has been ignored, and an eighth column would ask you to decide where
 * things belong instead of what to do about them. At the foot of the column it
 * came from, it keeps its context and stays one drag from coming back.
 *
 * The two actions are the only two answers that resolve it. Anything else —
 * reprioritising, re-planning — is work, and work starts by opening the card,
 * which expanding the row already offers.
 */
function StaleGroupBlock({
  stale,
  columnId,
  columnWidth,
  groupSummaries,
}: {
  stale: StaleGroup;
  columnId: Status;
  columnWidth: number;
  groupSummaries: Map<string, CardGroupSummary>;
}) {
  const expandedGroups = useKanbanStore((s) => s.expandedGroups);
  const toggleGroupCollapse = useKanbanStore((s) => s.toggleGroupCollapse);
  const moveCard = useKanbanStore((s) => s.moveCard);
  const [pendingMove, setPendingMove] = useState<Status | null>(null);

  const foldKey = groupFoldKey(STALE_GROUP_ID, columnId);
  const isExpanded = expandedGroups.includes(foldKey);
  const count = stale.cards.length;

  // Offering "To backlog" inside Backlog would be a button that does nothing.
  const canSendToBacklog = columnId !== "backlog";

  const applyMove = async (target: Status) => {
    setPendingMove(null);
    for (const card of stale.cards) {
      await moveCard(card.id, target);
    }
  };

  const actionButtonClass =
    "rounded border border-border bg-card px-1.5 py-0.5 font-mono text-[9.5px] uppercase tracking-wide text-muted-foreground transition-colors hover:text-foreground hover:border-ink/40";

  return (
    <>
      <FoldableBlock
        isExpanded={isExpanded}
        onToggle={() => toggleGroupCollapse(foldKey)}
        memberCount={count}
        collapseLabel="collapse stale"
        header={
          <>
            <span className="text-xs font-semibold text-muted-foreground">Stale</span>
            <span className="ml-auto shrink-0 font-mono text-[10px] tabular-nums text-muted-foreground">
              {count}
            </span>
          </>
        }
        sub={
          <>
            untouched {formatAgeShort(stale.oldestDays)} · threshold {stale.thresholdDays}d
          </>
        }
        actions={
          <>
            <button
              type="button"
              onClick={() => setPendingMove("withdrawn")}
              className={actionButtonClass}
            >
              Withdraw
            </button>
            {canSendToBacklog && (
              <button
                type="button"
                onClick={() => setPendingMove("backlog")}
                className={actionButtonClass}
              >
                To backlog
              </button>
            )}
          </>
        }
      >
        {isExpanded &&
          stale.cards.map((card) => (
            <TaskCard
              key={card.id}
              card={card}
              group={
                card.groupId ? groupSummaries.get(card.groupId)?.group ?? null : null
              }
              columnWidth={columnWidth}
              inGroupFrame
            />
          ))}
      </FoldableBlock>

      {/* The buttons sit on a row that can be folded shut over the cards they
          move, so the count has to be said out loud before anything moves. */}
      <AlertDialog
        open={pendingMove !== null}
        onOpenChange={(open) => !open && setPendingMove(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {pendingMove === "withdrawn" ? "Withdraw" : "Move to Backlog"} {count} stale{" "}
              {count === 1 ? "card" : "cards"}?
            </AlertDialogTitle>
            <AlertDialogDescription>
              {count === 1 ? "This card has" : "These cards have"} gone untouched for{" "}
              {formatAgeShort(stale.oldestDays)} or more.{" "}
              {pendingMove === "withdrawn"
                ? "Withdrawn cards leave the board but are not deleted."
                : "They rejoin Backlog at the bottom of the queue."}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={() => pendingMove && applyMove(pendingMove)}>
              {pendingMove === "withdrawn" ? "Withdraw" : "Move"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

interface ColumnProps {
  id: Status;
  title: string;
  /** The cards still in play. Stale ones arrive separately, in `stale`. */
  cards: CardType[];
  groupSummaries: Map<string, CardGroupSummary>;
  /** This column's stopped cards, or null when it has none. */
  stale: StaleGroup | null;
}

export function Column({ id, title, cards, groupSummaries, stale }: ColumnProps) {
  const { openNewCardModal, activeProjectId, collapsedColumns, toggleColumnCollapse, completedFilter, setCompletedFilter, uncappedColumns, toggleColumnCap } = useKanbanStore();
  const { setNodeRef, isOver } = useDroppable({ id });
  const { ref: widthRef, width: columnWidth } = useColumnWidth();

  const isCollapsed = collapsedColumns.includes(id);
  const rows = useMemo(
    () => buildColumnRows(cards, groupSummaries),
    [cards, groupSummaries]
  );

  const isUncapped = uncappedColumns.includes(id);
  const visibleRows = isUncapped ? rows : rows.slice(0, COLUMN_ROW_CAP);
  // Cards, not rows: "+3 more" over a hidden chain of fourteen would be a
  // number that undersells what you are not looking at.
  const cappedAwayCards = rows
    .slice(visibleRows.length)
    .reduce((sum, row) => sum + (row.kind === "card" ? 1 : row.columnMembers.length), 0);

  const staleCount = stale?.cards.length ?? 0;
  const wipLimit = COLUMN_WIP_LIMITS[id];
  const isOverWip = wipLimit !== undefined && cards.length > wipLimit;

  const handleAddCard = () => {
    openNewCardModal(id, activeProjectId);
  };

  // Collapsed view - vertical tab
  if (isCollapsed) {
    return (
      <div
        ref={setNodeRef}
        onClick={() => toggleColumnCollapse(id)}
        className={`flex flex-col items-center w-10 min-w-10 bg-surface rounded-lg cursor-pointer hover:bg-muted transition-all duration-200 snap-start ${
          isOver ? "ring-2 ring-ink ring-opacity-40" : ""
        }`}
      >
        <div className="py-3 px-2">
          <ChevronRight className="w-4 h-4 text-muted-foreground" />
        </div>
        <div className="flex-1 flex flex-col items-center justify-center py-4">
          <span
            className="text-sm font-medium text-foreground whitespace-nowrap"
            style={{
              writingMode: "vertical-rl",
              textOrientation: "mixed",
              transform: "rotate(180deg)",
            }}
          >
            {title}
          </span>
          {/* The plain total, stale included. A collapsed tab is answering
              "what is in this drawer", and 40px leaves no room to qualify a
              number the way the open header's tooltip can. */}
          <span className="mt-3 text-xs text-muted-foreground bg-muted px-1.5 py-0.5 rounded">
            {cards.length + staleCount}
          </span>
        </div>
      </div>
    );
  }

  // Expanded view - normal column
  return (
    <div
      ref={(node) => {
        setNodeRef(node);
        widthRef.current = node;
      }}
      // Grow to fill, never below the old fixed width and never so wide that a
      // card's title line gets uncomfortably long. On a laptop the minimum
      // binds and this behaves exactly as the fixed w-72 did; on a large
      // display the columns take up the slack instead of leaving a dead strip
      // and a scrollbar that has nothing left to reveal.
      className={`flex flex-col flex-1 w-72 min-w-72 max-w-[22rem] bg-surface rounded-lg transition-all duration-200 snap-start ${
        isOver ? "ring-2 ring-ink ring-opacity-40 scale-[1.02]" : ""
      }`}
    >
      {/* Column Header */}
      <div className="flex items-center justify-between px-3 py-3 border-b border-border">
        <div className="flex items-center gap-2 min-w-0 flex-1">
          <button
            onClick={() => toggleColumnCollapse(id)}
            className="text-muted-foreground hover:text-foreground transition-colors p-0.5 rounded hover:bg-muted flex-shrink-0"
            title="Collapse column"
          >
            <ChevronLeft className="w-4 h-4" />
          </button>
          <div className={`w-2 h-2 rounded-full flex-shrink-0 ${STATUS_COLORS[id]}`} />
          <h2 className="text-sm font-medium text-foreground truncate">{title}</h2>
          {/* The count says load, not inventory: stale cards are not work in
              flight, and counting them here would let two dead cards push a
              column over its limit and keep it there. What they are is said
              once, on their own row at the foot of the column. The limit is
              never enforced — it is here to be heard, and a number that turns
              red is louder than a drop the board refuses. */}
          <Tooltip>
            <TooltipTrigger asChild>
              <span
                className={`text-xs px-1.5 py-0.5 rounded flex-shrink-0 font-mono tabular-nums cursor-default ${
                  isOverWip
                    ? "bg-red-500/15 text-red-500 font-semibold"
                    : "bg-muted text-muted-foreground"
                }`}
              >
                {wipLimit === undefined ? cards.length : `${cards.length} / ${wipLimit}`}
              </span>
            </TooltipTrigger>
            <TooltipContent side="top">
              {cards.length} in flight
              {staleCount > 0 && ` · ${staleCount} stale`}
              {wipLimit !== undefined &&
                (isOverWip ? ` · ${cards.length - wipLimit} over the limit of ${wipLimit}` : ` · limit ${wipLimit}`)}
            </TooltipContent>
          </Tooltip>
          {id === "completed" && (
            <Select
              value={completedFilter}
              onValueChange={(value) => setCompletedFilter(value as CompletedFilter)}
            >
              <SelectTrigger
                className="h-6 w-auto min-w-0 text-xs bg-muted border-none px-2 py-0.5 gap-1 flex-shrink-0"
                onClick={(e) => e.stopPropagation()}
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {COMPLETED_FILTER_OPTIONS.map((option) => (
                  <SelectItem key={option.value} value={option.value} className="text-xs">
                    {option.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
        </div>
        <button
          onClick={handleAddCard}
          className="text-muted-foreground hover:text-foreground transition-colors p-1 rounded hover:bg-muted flex-shrink-0 ml-1"
          title="Add card"
        >
          <svg
            width="16"
            height="16"
            viewBox="0 0 16 16"
            fill="none"
            xmlns="http://www.w3.org/2000/svg"
          >
            <path
              d="M8 3V13M3 8H13"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
            />
          </svg>
        </button>
      </div>

      {/* Cards Container */}
      <div className="flex-1 p-2 space-y-2 overflow-y-auto max-h-[calc(100vh-180px)]">
        {visibleRows.map((row) =>
          row.kind === "card" ? (
            <TaskCard
              key={row.card.id}
              card={row.card}
              group={
                row.card.groupId
                  ? groupSummaries.get(row.card.groupId)?.group ?? null
                  : null
              }
              columnWidth={columnWidth}
            />
          ) : (
            <CardGroupBlock
              key={row.summary.group.id}
              row={row}
              columnId={id}
              columnWidth={columnWidth}
            />
          )
        )}

        {/* Unlike the chain rows above, this one is not a disclosure control
            with a chevron already saying the same thing — the cards below it
            have no other handle, so the button is the only way to reach them. */}
        {cappedAwayCards > 0 && (
          <button
            type="button"
            onClick={() => toggleColumnCap(id)}
            className="w-full rounded-md border border-dashed border-border py-1.5 text-center font-mono text-[10px] text-muted-foreground transition-colors hover:text-foreground hover:border-ink/40"
          >
            +{cappedAwayCards} more
          </button>
        )}
        {isUncapped && rows.length > COLUMN_ROW_CAP && (
          <button
            type="button"
            onClick={() => toggleColumnCap(id)}
            className="flex w-full items-center justify-center gap-1 rounded py-1 font-mono text-[10px] text-muted-foreground transition-colors hover:text-foreground"
          >
            <ChevronUp className="w-3 h-3" />
            show fewer
          </button>
        )}

        {/* Always last, and outside the cap: the whole point is that these
            cards stop taking room at the top of the column. */}
        {stale && (
          <StaleGroupBlock
            stale={stale}
            columnId={id}
            columnWidth={columnWidth}
            groupSummaries={groupSummaries}
          />
        )}

        {cards.length === 0 && !stale && (
          <div
            className={`text-center py-8 text-muted-foreground text-sm transition-colors ${
              isOver ? "bg-paper-cream rounded-md text-ink" : ""
            }`}
          >
            {isOver ? "Drop here" : "No tasks"}
          </div>
        )}
      </div>
    </div>
  );
}
