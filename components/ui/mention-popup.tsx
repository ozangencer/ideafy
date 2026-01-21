"use client";

import { forwardRef, useEffect, useImperativeHandle, useState } from "react";
import { Terminal, Server, Puzzle } from "lucide-react";
import { UnifiedItemType } from "@/lib/types";

export interface MentionItem {
  id: string;
  label: string;
  prefix: string;
}

// Unified mention item for / trigger
export interface UnifiedMentionItem {
  id: string;
  label: string;
  type: UnifiedItemType;
  description?: string;
}

interface MentionPopupProps {
  items: MentionItem[];
  command: (item: MentionItem) => void;
}

export interface MentionPopupRef {
  onKeyDown: (event: KeyboardEvent) => boolean;
}

export const MentionPopup = forwardRef<MentionPopupRef, MentionPopupProps>(
  ({ items, command }, ref) => {
    const [selectedIndex, setSelectedIndex] = useState(0);

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
      return null;
    }

    return (
      <div className="bg-popover border border-border rounded-lg shadow-lg overflow-hidden min-w-[200px] max-h-[300px] overflow-y-auto">
        {items.map((item, index) => (
          <button
            key={item.id}
            onClick={() => selectItem(index)}
            className={`w-full text-left px-3 py-2 text-sm flex items-center gap-2 transition-colors ${
              index === selectedIndex
                ? "bg-accent text-accent-foreground"
                : "hover:bg-muted"
            }`}
          >
            <span
              className={`font-mono text-xs ${
                item.prefix === "/" ? "text-primary/70" : "text-blue-500/70"
              }`}
            >
              {item.prefix}
            </span>
            <span className="truncate">{item.label}</span>
          </button>
        ))}
      </div>
    );
  }
);

MentionPopup.displayName = "MentionPopup";

// Type configuration for unified popup
const TYPE_CONFIG: Record<UnifiedItemType, {
  icon: typeof Terminal;
  label: string;
  iconClass: string;
  borderClass: string;
}> = {
  skill: {
    icon: Terminal,
    label: "Skill",
    iconClass: "text-zinc-400",
    borderClass: "border-l-zinc-500",
  },
  mcp: {
    icon: Server,
    label: "MCP",
    iconClass: "text-blue-400",
    borderClass: "border-l-blue-500",
  },
  plugin: {
    icon: Puzzle,
    label: "Plugin",
    iconClass: "text-purple-400",
    borderClass: "border-l-purple-500",
  },
};

// Unified mention popup for / trigger
interface UnifiedMentionPopupProps {
  items: UnifiedMentionItem[];
  command: (item: UnifiedMentionItem) => void;
}

export interface UnifiedMentionPopupRef {
  onKeyDown: (event: KeyboardEvent) => boolean;
}

export const UnifiedMentionPopup = forwardRef<UnifiedMentionPopupRef, UnifiedMentionPopupProps>(
  ({ items, command }, ref) => {
    const [selectedIndex, setSelectedIndex] = useState(0);

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
      return null;
    }

    return (
      <div className="bg-popover border border-border rounded-lg shadow-lg overflow-hidden min-w-[240px] max-h-[300px] overflow-y-auto">
        {items.map((item, index) => {
          const config = TYPE_CONFIG[item.type];
          const Icon = config.icon;

          return (
            <button
              key={`${item.type}-${item.id}`}
              onClick={() => selectItem(index)}
              className={`w-full text-left px-3 py-2 text-sm flex items-center gap-2.5 transition-colors border-l-2 ${
                config.borderClass
              } ${
                index === selectedIndex
                  ? "bg-accent text-accent-foreground"
                  : "hover:bg-muted"
              }`}
            >
              <Icon className={`h-3.5 w-3.5 shrink-0 ${config.iconClass}`} />
              <span className="truncate flex-1">{item.label}</span>
              <span className="text-xs text-muted-foreground shrink-0">
                {config.label}
              </span>
            </button>
          );
        })}
      </div>
    );
  }
);

UnifiedMentionPopup.displayName = "UnifiedMentionPopup";
