"use client";

import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from "react";
import { FileText, File } from "lucide-react";

export interface DocumentMentionItem {
  id: string;
  name: string;
  relativePath: string;
  isClaudeMd: boolean;
}

interface DocumentMentionPopupProps {
  items: DocumentMentionItem[];
  command: (item: DocumentMentionItem) => void;
}

export interface DocumentMentionPopupRef {
  onKeyDown: (event: KeyboardEvent) => boolean;
}

export const DocumentMentionPopup = forwardRef<DocumentMentionPopupRef, DocumentMentionPopupProps>(
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
          <p className="text-sm text-muted-foreground">No documents found</p>
          <p className="text-xs text-muted-foreground mt-1">Select a project first</p>
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
            {item.isClaudeMd ? (
              <FileText className="w-4 h-4 flex-shrink-0 text-orange-400" />
            ) : (
              <File className="w-4 h-4 flex-shrink-0 text-cyan-400" />
            )}

            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2">
                <span className={`font-medium text-sm ${item.isClaudeMd ? "text-orange-400" : ""}`}>
                  {item.name}
                </span>
                {item.isClaudeMd && (
                  <span className="text-[10px] px-1.5 py-0.5 rounded bg-orange-500/20 text-orange-400 font-medium">
                    CLAUDE
                  </span>
                )}
              </div>
              {item.relativePath !== item.name && (
                <span className="text-xs text-muted-foreground truncate block">
                  {item.relativePath}
                </span>
              )}
            </div>
          </button>
        ))}
      </div>
    );
  }
);

DocumentMentionPopup.displayName = "DocumentMentionPopup";
