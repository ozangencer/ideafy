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
import { useState, useRef, useEffect } from "react";
import { useKanbanStore } from "@/lib/store";
import { COLUMNS, Card, Status, Priority, Complexity, CompletedFilter } from "@/lib/types";

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
import { Column } from "./column";
import { TaskCard } from "./card";

export function KanbanBoard() {
  const { cards, activeProjectId, searchQuery, moveCard, completedFilter } = useKanbanStore();
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
  }, []);

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

  const filteredCards = cards.filter((card) => {
    // Filter by active project
    const matchesProject = !activeProjectId || card.projectId === activeProjectId;
    // Filter by search query
    const matchesSearch =
      !searchQuery ||
      card.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
      card.description.toLowerCase().includes(searchQuery.toLowerCase());
    return matchesProject && matchesSearch;
  });

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
          {COLUMNS.map((column) => {
            let columnCards = filteredCards.filter((card) => card.status === column.id);
            // Apply date filter only to completed column
            if (column.id === 'completed') {
              columnCards = filterByCompletedDate(columnCards, completedFilter);
            }
            // Use different sorting for completed vs other columns
            const sortedCards = column.id === 'completed'
              ? sortCompletedCards(columnCards)
              : sortCards(columnCards);
            return (
              <Column
                key={column.id}
                id={column.id}
                title={column.title}
                cards={sortedCards}
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
            <TaskCard card={activeCard} isDragging />
          </div>
        )}
      </DragOverlay>
    </DndContext>
  );
}
