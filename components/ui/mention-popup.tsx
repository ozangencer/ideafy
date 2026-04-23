"use client";

import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from "react";
import { Terminal, Server, Puzzle, Bot, FolderTree, ChevronLeft } from "lucide-react";
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
  pluginKey?: string | null;
  children?: UnifiedMentionItem[];
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
                item.prefix === "/" ? "text-ink/70" : "text-ink/60"
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
    iconClass: "text-ink",
    borderClass: "border-l-ink",
  },
  agent: {
    icon: Bot,
    label: "Agent",
    iconClass: "text-amber-400",
    borderClass: "border-l-amber-500",
  },
  plugin: {
    icon: Puzzle,
    label: "Plugin",
    iconClass: "text-[#71717a]",
    borderClass: "border-l-[#71717a]",
  },
  skillGroup: {
    icon: FolderTree,
    label: "Group",
    iconClass: "text-sky-500",
    borderClass: "border-l-sky-500",
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
    const [activeGroup, setActiveGroup] = useState<UnifiedMentionItem | null>(null);
    const itemRefs = useRef<(HTMLButtonElement | null)[]>([]);

    const visibleItems = activeGroup?.children?.length
      ? activeGroup.children
      : items;

    useEffect(() => {
      itemRefs.current[selectedIndex]?.scrollIntoView({ block: "nearest" });
    }, [selectedIndex, visibleItems]);

    const selectItem = (index: number) => {
      const item = visibleItems[index];
      if (item) {
        if (item.type === "skillGroup") {
          setActiveGroup(item);
          setSelectedIndex(0);
          return;
        }
        command(item);
      }
    };

    const upHandler = () => {
      setSelectedIndex((selectedIndex + visibleItems.length - 1) % visibleItems.length);
    };

    const downHandler = () => {
      setSelectedIndex((selectedIndex + 1) % visibleItems.length);
    };

    const enterHandler = () => {
      selectItem(selectedIndex);
    };

    useEffect(() => {
      setSelectedIndex(0);
      setActiveGroup(null);
    }, [items]);

    useImperativeHandle(ref, () => ({
      onKeyDown: (event: KeyboardEvent) => {
        if (event.key === "ArrowLeft" && activeGroup) {
          setActiveGroup(null);
          setSelectedIndex(0);
          return true;
        }
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

    if (visibleItems.length === 0) {
      return null;
    }

    const selectedItem = visibleItems[selectedIndex] || null;
    const showingGroupHint = !activeGroup && selectedItem?.type === "skillGroup";

    return (
      <div className="bg-popover border border-border rounded-lg shadow-lg overflow-hidden min-w-[260px] max-h-[320px] flex flex-col">
        {activeGroup && (
          <button
            onClick={() => {
              setActiveGroup(null);
              setSelectedIndex(0);
            }}
            className="flex w-full items-center gap-2 border-b border-border px-3 py-2 text-left text-xs uppercase tracking-[0.14em] text-muted-foreground transition-colors hover:bg-muted"
          >
            <ChevronLeft className="h-3.5 w-3.5" />
            <span className="truncate">{activeGroup.label}</span>
          </button>
        )}

        <div className="max-h-[300px] overflow-y-auto">
          {visibleItems.map((item, index) => {
            const config = TYPE_CONFIG[item.type];
            const Icon = config.icon;
            const isSelected = index === selectedIndex;

            const isPluginItem = Boolean(item.pluginKey);
            const borderClass = isPluginItem
              ? "border-l-accent-blue/80"
              : config.borderClass;
            const iconClass = isPluginItem
              ? "text-accent-blue"
              : config.iconClass;
            const LeadingIcon = isPluginItem ? Puzzle : Icon;

            return (
              <button
                key={`${item.type}-${item.id}`}
                ref={(el) => { itemRefs.current[index] = el; }}
                onClick={() => selectItem(index)}
                className={`w-full text-left px-3 py-2 text-sm flex items-center gap-2.5 transition-colors border-l-2 ${
                  isSelected
                    ? "border-l-primary bg-muted/90 text-foreground"
                    : `${borderClass} text-foreground/90 hover:bg-muted hover:text-foreground`
                }`}
                title={isPluginItem ? `Plugin: ${item.pluginKey}` : undefined}
              >
                <LeadingIcon
                  className={`h-3.5 w-3.5 shrink-0 ${
                    isSelected ? "text-foreground/85" : iconClass
                  }`}
                />
                <span className="truncate flex-1">{item.label}</span>
                {isPluginItem ? (
                  <span
                    className={`shrink-0 rounded-sm px-1.5 py-[1px] text-[10px] font-medium uppercase tracking-wide ${
                      isSelected
                        ? "bg-accent-blue/15 text-accent-blue"
                        : "bg-accent-blue/10 text-accent-blue/90"
                    }`}
                  >
                    Plugin
                  </span>
                ) : (
                  <span
                    className={`shrink-0 text-xs ${
                      isSelected ? "text-muted-foreground/90" : "text-muted-foreground"
                    }`}
                  >
                    {config.label}
                  </span>
                )}
              </button>
            );
          })}
        </div>

        {showingGroupHint && (
          <div className="flex items-center justify-between gap-3 border-t border-border bg-muted/40 px-3 py-2 text-[11px] text-muted-foreground">
            <span>Enter or Tab to open group</span>
            <span className="shrink-0">Then choose a skill</span>
          </div>
        )}

        {activeGroup && (
          <div className="border-t border-border bg-muted/30 px-3 py-2 text-[11px] text-muted-foreground">
            Press Left Arrow to go back
          </div>
        )}
      </div>
    );
  }
);

UnifiedMentionPopup.displayName = "UnifiedMentionPopup";
