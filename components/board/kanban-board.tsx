"use client";

import {
  DndContext,
  DragEndEvent,
  DragOverlay,
  DragStartEvent,
  PointerSensor,
  TouchSensor,
  useSensor,
  useSensors,
  closestCenter,
} from "@dnd-kit/core";
import { useState, useRef, useEffect, useMemo } from "react";
import { useKanbanStore } from "@/lib/store";
import { useUndoShortcut } from "@/hooks/use-undo-shortcut";
import { COLUMNS, Card, Status, Priority, Complexity, CompletedFilter, getColumns, TodaySource } from "@/lib/types";
import { isCardInWorkspace } from "@/lib/workspace";
import { summarizeCardGroups } from "@/lib/card-group";
import { partitionStaleCards } from "@/lib/card-age";
import { FocusView } from "./focus-view";
import { SelectionBar } from "./selection-bar";

// Priority order: high > medium > low (descending)
const PRIORITY_ORDER: Record<Priority, number> = {
  high: 3,
  medium: 2,
  low: 1,
};

// Complexity order: low > medium > high (ascending)
const COMPLEXITY_ORDER: Record<Complexity, number> = {
  low: 1,
  medium: 2,
  high: 3,
};

// Filter completed cards by date filter
function filterByCompletedDate(cards: Card[], filter: CompletedFilter): Card[] {
  // 'all' filter or any unknown/invalid filter should return all cards
  if (!filter || filter === 'all') {
    return cards;
  }

  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());

  switch (filter) {
    case 'today':
      return cards.filter(card => {
        const dateToCheck = card.completedAt || card.updatedAt;
        const cardDate = new Date(dateToCheck);
        const cardDateOnly = new Date(cardDate.getFullYear(), cardDate.getMonth(), cardDate.getDate());
        return cardDateOnly.getTime() === today.getTime();
      });
    case 'yesterday': {
      const yesterday = new Date(today.getTime() - 24 * 60 * 60 * 1000);
      return cards.filter(card => {
        const dateToCheck = card.completedAt || card.updatedAt;
        const cardDate = new Date(dateToCheck);
        const cardDateOnly = new Date(cardDate.getFullYear(), cardDate.getMonth(), cardDate.getDate());
        return cardDateOnly.getTime() === yesterday.getTime();
      });
    }
    case 'this_week': {
      const weekAgo = new Date(today.getTime() - 7 * 24 * 60 * 60 * 1000);
      return cards.filter(card => {
        const dateToCheck = card.completedAt || card.updatedAt;
        const cardDate = new Date(dateToCheck);
        return cardDate >= weekAgo;
      });
    }
    default:
      // For any unrecognized filter value, show all cards
      return cards;
  }
}

// Sort cards by priority (desc) then complexity (asc)
function sortCards(cards: Card[]): Card[] {
  return [...cards].sort((a, b) => {
    // Primary: Priority descending (urgent first)
    const priorityDiff =
      (PRIORITY_ORDER[b.priority] || 2) - (PRIORITY_ORDER[a.priority] || 2);
    if (priorityDiff !== 0) return priorityDiff;

    // Secondary: Complexity ascending (low first)
    return (
      (COMPLEXITY_ORDER[a.complexity] || 2) - (COMPLEXITY_ORDER[b.complexity] || 2)
    );
  });
}

// Sort completed cards by completedAt (desc) - most recently completed first
function sortCompletedCards(cards: Card[]): Card[] {
  return [...cards].sort((a, b) => {
    const dateA = a.completedAt ? new Date(a.completedAt).getTime() : 0;
    const dateB = b.completedAt ? new Date(b.completedAt).getTime() : 0;
    return dateB - dateA;
  });
}

// Sort test and withdrawn cards by updatedAt (desc) - most recently updated first
function sortByRecentUpdate(cards: Card[]): Card[] {
  return [...cards].sort((a, b) => {
    const dateA = new Date(a.updatedAt).getTime();
    const dateB = new Date(b.updatedAt).getTime();
    return dateB - dateA;
  });
}
import { Column } from "./column";
import { TaskCard } from "./card";

interface KanbanBoardProps {
  // Cloud wrapper passes team pool activity here for Focus view's Today
  // panel, the same slot the bell's `extraSources` uses. Base never fills it.
  todaySources?: TodaySource[];
}

export function KanbanBoard({ todaySources }: KanbanBoardProps = {}) {
  const { cards, cardGroups, projects, activeProjectId, activeWorkspace, searchQuery, moveCard, completedFilter, boardView, staleThresholds, clearCardSelection } = useKanbanStore();
  useUndoShortcut();

  // A selection only means what's on screen. Once the project, a filter or
  // the view changes, some picked cards may be hidden — and a bulk delete
  // would take them out without the user seeing it happen.
  useEffect(() => {
    clearCardSelection();
  }, [activeProjectId, activeWorkspace, searchQuery, completedFilter, boardView, clearCardSelection]);

  const [activeCard, setActiveCard] = useState<Card | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const [showRightFade, setShowRightFade] = useState(false);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;

    const checkScroll = () => {
      const hasOverflow = el.scrollWidth > el.clientWidth;
      const isAtEnd = el.scrollLeft + el.clientWidth >= el.scrollWidth - 10;
      setShowRightFade(hasOverflow && !isAtEnd);
    };

    checkScroll();
    el.addEventListener('scroll', checkScroll);
    const observer = new ResizeObserver(checkScroll);
    observer.observe(el);

    return () => {
      el.removeEventListener('scroll', checkScroll);
      observer.disconnect();
    };
    // Focus unmounts the scroller, so the observer has to be re-attached to
    // the new node when the columns come back.
  }, [boardView]);

  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: {
        distance: 5,
      },
    }),
    useSensor(TouchSensor, {
      activationConstraint: {
        delay: 200,
        tolerance: 5,
      },
    })
  );

  // Summaries come from the unfiltered board on purpose: a search that hides
  // half a chain must not make the rollup say the chain got shorter.
  const groupSummaries = useMemo(
    () => summarizeCardGroups(cards, cardGroups),
    [cards, cardGroups]
  );

  const filteredCards = cards.filter((card) => {
    // Filter by active project. "All Projects" means every project in the
    // workspace that is showing, not every project there is.
    const matchesProject = activeProjectId
      ? card.projectId === activeProjectId
      : isCardInWorkspace(card, projects, activeWorkspace);
    // Filter by search query
    const matchesSearch =
      !searchQuery ||
      card.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
      card.description.toLowerCase().includes(searchQuery.toLowerCase());
    return matchesProject && matchesSearch;
  });

  if (boardView === "focus") {
    return <FocusView cards={filteredCards} todaySources={todaySources} />;
  }

  const handleDragStart = (event: DragStartEvent) => {
    const card = cards.find((c) => c.id === event.active.id);
    if (card) setActiveCard(card);
  };

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    setActiveCard(null);

    if (!over) return;

    const cardId = active.id as string;
    const overId = over.id as string;

    // Check if dropped on a column
    if (COLUMNS.some((col) => col.id === overId)) {
      moveCard(cardId, overId as Status);
      return;
    }

    // Check if dropped on another card - move to that card's column
    const overCard = cards.find((c) => c.id === overId);
    if (overCard) {
      moveCard(cardId, overCard.status);
    }
  };

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCenter}
      onDragStart={handleDragStart}
      onDragEnd={handleDragEnd}
    >
      <div className="relative overflow-hidden">
        <div
          ref={scrollRef}
          className="flex gap-4 p-6 overflow-x-auto min-h-[calc(100vh-80px)] snap-x snap-mandatory"
        >
          {getColumns(activeWorkspace).map((column) => {
            let columnCards = filteredCards.filter((card) => card.status === column.id);
            // Apply date filter only to completed column
            if (column.id === 'completed') {
              columnCards = filterByCompletedDate(columnCards, completedFilter);
            }
            // Use different sorting per column type
            const sortedCards = column.id === 'completed'
              ? sortCompletedCards(columnCards)
              : column.id === 'test' || column.id === 'withdrawn'
                ? sortByRecentUpdate(columnCards)
                : sortCards(columnCards);
            // Split after sorting, so the Stale row keeps the column's own
            // order rather than inventing a second one.
            const { live, stale } = partitionStaleCards(
              sortedCards,
              column.id,
              staleThresholds
            );
            return (
              <Column
                key={column.id}
                id={column.id}
                title={column.title}
                cards={live}
                groupSummaries={groupSummaries}
                stale={stale}
              />
            );
          })}
        </div>
        {showRightFade && (
          <div className="absolute right-0 top-0 bottom-0 w-16 pointer-events-none bg-gradient-to-l from-background to-transparent z-10" />
        )}
      </div>
      <DragOverlay
        dropAnimation={{
          duration: 200,
          easing: "cubic-bezier(0.18, 0.67, 0.6, 1.22)",
        }}
      >
        {activeCard && (
          <div className="w-[272px]">
            <TaskCard
              card={activeCard}
              group={
                activeCard.groupId
                  ? groupSummaries.get(activeCard.groupId)?.group ?? null
                  : null
              }
              isDragging
            />
          </div>
        )}
      </DragOverlay>
      <SelectionBar />
    </DndContext>
  );
}
