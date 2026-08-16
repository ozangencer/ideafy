"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useDroppable } from "@dnd-kit/core";
import {
  Card as CardType,
  Status,
  STATUS_COLORS,
  COMPLETED_FILTER_OPTIONS,
  CompletedFilter,
  getDisplayId,
} from "@/lib/types";
import { buildColumnRows, CardGroupSummary, ColumnRow, groupFoldKey } from "@/lib/card-group";
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
    // One box, folded or not: opening the group grows it rather than spawning
    // loose cards into the column's flow. Without it an expanded member and
    // the ungrouped card beneath it are indistinguishable, and the group has
    // no visible end.
    <div className="rounded-md border border-dashed border-border bg-muted/50 p-1.5 space-y-1.5">
      <div className={isExpanded ? "px-0.5 pb-1 border-b border-dashed border-border" : "px-0.5"}>
        <button
          type="button"
          onClick={() => toggleGroupCollapse(foldKey)}
          className="flex w-full items-center gap-1.5 text-left"
        >
          {header}
        </button>
        {(nextDisplayId || hiddenCount > 0) && (
          <div className="pl-[18px] text-[10px] text-muted-foreground font-mono">
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
          </div>
        )}
      </div>

      {visibleCards.map((card) => (
        <TaskCard
          key={card.id}
          card={card}
          group={group}
          columnWidth={columnWidth}
        />
      ))}

      {/* Nothing sits under a folded row. A "+N more" button there was a third
          control repeating what the chevron and "N collapsed" already say, and
          it doubled the height of the very thing this feature exists to
          shrink. Expanded is where a footer earns its place: by then the
          header has scrolled away and there is no way back to it. */}
      {isExpanded && columnMembers.length >= COLLAPSE_FOOTER_MIN_MEMBERS && (
        <button
          type="button"
          onClick={() => toggleGroupCollapse(foldKey)}
          className="flex w-full items-center justify-center gap-1 rounded py-1 font-mono text-[10px] text-muted-foreground transition-colors hover:text-foreground"
        >
          <ChevronUp className="w-3 h-3" />
          collapse {group.code}
        </button>
      )}
    </div>
  );
}

interface ColumnProps {
  id: Status;
  title: string;
  cards: CardType[];
  groupSummaries: Map<string, CardGroupSummary>;
}

export function Column({ id, title, cards, groupSummaries }: ColumnProps) {
  const { openNewCardModal, activeProjectId, collapsedColumns, toggleColumnCollapse, completedFilter, setCompletedFilter } = useKanbanStore();
  const { setNodeRef, isOver } = useDroppable({ id });
  const { ref: widthRef, width: columnWidth } = useColumnWidth();

  const isCollapsed = collapsedColumns.includes(id);
  const rows = useMemo(
    () => buildColumnRows(cards, groupSummaries),
    [cards, groupSummaries]
  );

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
          <span className="mt-3 text-xs text-muted-foreground bg-muted px-1.5 py-0.5 rounded">
            {cards.length}
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
          <span className="text-xs text-muted-foreground bg-muted px-1.5 py-0.5 rounded flex-shrink-0">
            {cards.length}
          </span>
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
        {rows.map((row) =>
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
        {cards.length === 0 && (
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
