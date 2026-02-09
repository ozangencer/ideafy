"use client";

import { useDroppable } from "@dnd-kit/core";
import { Card as CardType, Status, STATUS_COLORS, COMPLETED_FILTER_OPTIONS, CompletedFilter } from "@/lib/types";
import { useKanbanStore } from "@/lib/store";
import { TaskCard } from "./card";
import { ChevronLeft, ChevronRight } from "lucide-react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

interface ColumnProps {
  id: Status;
  title: string;
  cards: CardType[];
}

export function Column({ id, title, cards }: ColumnProps) {
  const { openNewCardModal, activeProjectId, collapsedColumns, toggleColumnCollapse, completedFilter, setCompletedFilter } = useKanbanStore();
  const { setNodeRef, isOver } = useDroppable({ id });

  const isCollapsed = collapsedColumns.includes(id);

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
          isOver ? "ring-2 ring-primary ring-opacity-50" : ""
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
      ref={setNodeRef}
      className={`flex flex-col w-72 min-w-72 bg-surface rounded-lg transition-all duration-200 snap-start ${
        isOver ? "ring-2 ring-primary ring-opacity-50 scale-[1.02]" : ""
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
        {cards.map((card) => (
          <TaskCard key={card.id} card={card} />
        ))}
        {cards.length === 0 && (
          <div
            className={`text-center py-8 text-muted-foreground text-sm transition-colors ${
              isOver ? "bg-primary/10 rounded-md text-primary" : ""
            }`}
          >
            {isOver ? "Drop here" : "No tasks"}
          </div>
        )}
      </div>
    </div>
  );
}
