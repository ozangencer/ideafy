"use client";

import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from "react";
import { Status, STATUS_COLORS } from "@/lib/types";

export interface CardMentionItem {
  id: string;
  displayId: string | null;
  title: string;
  status: Status;
  projectName?: string;
}

interface CardMentionPopupProps {
  items: CardMentionItem[];
  command: (item: CardMentionItem) => void;
}

export interface CardMentionPopupRef {
  onKeyDown: (event: KeyboardEvent) => boolean;
}

const STATUS_DOT_COLORS: Record<Status, string> = {
  ideation: "bg-purple-500",
  backlog: "bg-gray-500",
  bugs: "bg-red-500",
  progress: "bg-yellow-500",
  test: "bg-blue-500",
  completed: "bg-green-500",
  withdrawn: "bg-gray-500",
};

export const CardMentionPopup = forwardRef<CardMentionPopupRef, CardMentionPopupProps>(
  ({ items, command }, ref) => {
    const [selectedIndex, setSelectedIndex] = useState(0);
    const itemRefs = useRef<(HTMLButtonElement | null)[]>([]);

    useEffect(() => {
      itemRefs.current[selectedIndex]?.scrollIntoView({ block: "nearest" });
    }, [selectedIndex, items]);

    const selectItem = (index: number) => {
      const item = items[index];
      if (item) {
        command(item);
      }
    };

    const upHandler = () => {
      setSelectedIndex((selectedIndex + items.length - 1) % items.length);
    };

    const downHandler = () => {
      setSelectedIndex((selectedIndex + 1) % items.length);
    };

    const enterHandler = () => {
      selectItem(selectedIndex);
    };

    useEffect(() => setSelectedIndex(0), [items]);

    useImperativeHandle(ref, () => ({
      onKeyDown: (event: KeyboardEvent) => {
        if (event.key === "ArrowUp") {
          upHandler();
          return true;
        }
        if (event.key === "ArrowDown") {
          downHandler();
          return true;
        }
        if (event.key === "Enter" || event.key === "Tab") {
          enterHandler();
          return true;
        }
        return false;
      },
    }));

    if (items.length === 0) {
      return (
        <div className="bg-popover border border-border rounded-lg shadow-lg overflow-hidden min-w-[280px] p-3">
          <p className="text-sm text-muted-foreground">No cards found</p>
        </div>
      );
    }

    return (
      <div className="bg-popover border border-border rounded-lg shadow-lg overflow-hidden min-w-[280px] max-h-[300px] overflow-y-auto">
        {items.map((item, index) => (
          <button
            key={item.id}
            ref={(el) => { itemRefs.current[index] = el; }}
            onClick={() => selectItem(index)}
            className={`w-full text-left px-3 py-2 flex items-center gap-3 transition-colors ${
              index === selectedIndex
                ? "bg-accent text-accent-foreground"
                : "hover:bg-muted"
            }`}
          >
            {/* Status dot */}
            <span
              className={`w-2 h-2 rounded-full flex-shrink-0 ${STATUS_DOT_COLORS[item.status]}`}
            />

            {/* Content */}
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2">
                {item.displayId && (
                  <span
                    className={`font-mono text-xs flex-shrink-0 ${
                      index === selectedIndex
                        ? "text-current opacity-80"
                        : "text-ink/70"
                    }`}
                  >
                    {item.displayId}
                  </span>
                )}
                <span className="truncate text-sm">{item.title}</span>
              </div>
              {item.projectName && (
                <span
                  className={`text-xs truncate block ${
                    index === selectedIndex
                      ? "text-current opacity-75"
                      : "text-gray-400"
                  }`}
                >
                  {item.projectName}
                </span>
              )}
            </div>
          </button>
        ))}
      </div>
    );
  }
);

CardMentionPopup.displayName = "CardMentionPopup";
