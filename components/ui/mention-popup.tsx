"use client";

import { Fragment, forwardRef, useEffect, useImperativeHandle, useRef, useState } from "react";
import { Terminal, Server, Puzzle, Bot, Pin, Folder, Library } from "lucide-react";
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
  pinned?: boolean;
  folder?: string | null;
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
                index === selectedIndex
                  ? "text-current opacity-80"
                  : item.prefix === "/" ? "text-ink/70" : "text-ink/60"
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
};

type SectionHeading = { icon: typeof Folder; label: string };

// Once the list holds Toolkit pins it reads as sections: loose pins under
// "Toolkit", each folder under its name, everything else under "Library". A
// list with no pins stays a plain list.
function sectionHeadingAt(items: UnifiedMentionItem[], index: number): SectionHeading | null {
  if (!items.some((item) => item.pinned)) return null;
  const item = items[index];
  const previous = items[index - 1];
  if (!item.pinned) {
    return !previous || previous.pinned ? { icon: Library, label: "Library" } : null;
  }
  const folder = item.folder ?? null;
  if (previous?.pinned && (previous.folder ?? null) === folder) return null;
  return folder ? { icon: Folder, label: folder } : { icon: Pin, label: "Toolkit" };
}

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

    useEffect(() => {
      setSelectedIndex(0);
    }, [items]);

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
      <div className="bg-popover border border-border rounded-lg shadow-lg overflow-hidden min-w-[260px] max-h-[320px] flex flex-col">
        <div className="max-h-[300px] overflow-y-auto">
          {items.map((item, index) => {
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
            // Headings are not selectable rows, so the keyboard index still
            // walks items only.
            const heading = sectionHeadingAt(items, index);
            const HeadingIcon = heading?.icon;
            const inFolder = !!(item.pinned && item.folder);

            return (
              <Fragment key={`${item.type}-${item.id}`}>
                {heading && HeadingIcon && (
                  <div
                    className={`flex items-center gap-1.5 px-3 pb-1 pt-2 text-[10px] font-medium uppercase tracking-[0.12em] text-muted-foreground ${
                      index > 0 ? "mt-1 border-t border-border/60" : ""
                    }`}
                  >
                    <HeadingIcon className="h-3 w-3" />
                    <span className="truncate">{heading.label}</span>
                  </div>
                )}
                <button
                  ref={(el) => { itemRefs.current[index] = el; }}
                  onClick={() => selectItem(index)}
                  className={`w-full text-left ${inFolder ? "pl-7" : "pl-3"} pr-3 py-2 text-sm flex items-center gap-2.5 transition-colors border-l-2 ${
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
                  {item.pinned && (
                    <Pin
                      aria-label="Pinned to Toolkit"
                      className={`h-3 w-3 shrink-0 ${
                        isSelected ? "text-current opacity-70" : "text-muted-foreground"
                      }`}
                    />
                  )}
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
              </Fragment>
            );
          })}
        </div>
      </div>
    );
  }
);

UnifiedMentionPopup.displayName = "UnifiedMentionPopup";
