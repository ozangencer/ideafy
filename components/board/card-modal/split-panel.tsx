"use client";

import { useState, useCallback, useRef, useEffect } from "react";
import { PanelLeftClose, PanelLeftOpen } from "lucide-react";
import { Button } from "@/components/ui/button";

interface SplitPanelProps {
  leftPanel: React.ReactNode;
  rightPanel: React.ReactNode;
  defaultLeftWidth?: number; // percentage
  minLeftWidth?: number; // pixels
  minRightWidth?: number; // pixels
  showToggle?: boolean;
}

export function SplitPanel({
  leftPanel,
  rightPanel,
  defaultLeftWidth = 60,
  minLeftWidth = 300,
  minRightWidth = 280,
  showToggle = true,
}: SplitPanelProps) {
  const [leftWidth, setLeftWidth] = useState(defaultLeftWidth);
  const [isCollapsed, setIsCollapsed] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  const handleMouseDown = useCallback(() => {
    setIsDragging(true);
  }, []);

  const handleMouseUp = useCallback(() => {
    setIsDragging(false);
  }, []);

  const handleMouseMove = useCallback(
    (e: MouseEvent) => {
      if (!isDragging || !containerRef.current) return;

      const container = containerRef.current;
      const rect = container.getBoundingClientRect();
      const newLeftWidth = ((e.clientX - rect.left) / rect.width) * 100;

      // Calculate min percentages based on container width
      const minLeftPercent = (minLeftWidth / rect.width) * 100;
      const minRightPercent = (minRightWidth / rect.width) * 100;
      const maxLeftPercent = 100 - minRightPercent;

      if (newLeftWidth >= minLeftPercent && newLeftWidth <= maxLeftPercent) {
        setLeftWidth(newLeftWidth);
      }
    },
    [isDragging, minLeftWidth, minRightWidth]
  );

  useEffect(() => {
    if (isDragging) {
      window.addEventListener("mousemove", handleMouseMove);
      window.addEventListener("mouseup", handleMouseUp);
      document.body.style.cursor = "col-resize";
      document.body.style.userSelect = "none";
    }

    return () => {
      window.removeEventListener("mousemove", handleMouseMove);
      window.removeEventListener("mouseup", handleMouseUp);
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    };
  }, [isDragging, handleMouseMove, handleMouseUp]);

  const toggleCollapse = useCallback(() => {
    setIsCollapsed((prev) => !prev);
  }, []);

  return (
    <div ref={containerRef} className="flex h-full w-full overflow-hidden">
      {/* Left Panel (Editor) */}
      <div
        className="h-full overflow-y-auto"
        style={{
          width: isCollapsed ? "100%" : `${leftWidth}%`,
          transition: isDragging ? "none" : "width 200ms ease-out",
        }}
      >
        {leftPanel}
      </div>

      {/* Divider */}
      {!isCollapsed && (
        <div
          className="split-panel-divider group relative flex items-center justify-center w-1 cursor-col-resize bg-border hover:bg-accent/50 transition-colors"
          onMouseDown={handleMouseDown}
        >
          <div className="absolute w-4 h-full" /> {/* Larger hit area */}
          <div className="w-0.5 h-8 rounded-full bg-muted-foreground/30 group-hover:bg-accent/70 transition-colors" />
        </div>
      )}

      {/* Right Panel (Chat) */}
      {!isCollapsed && (
        <div
          className="h-full overflow-hidden flex flex-col"
          style={{
            width: `${100 - leftWidth}%`,
            transition: isDragging ? "none" : "width 200ms ease-out",
          }}
        >
          {rightPanel}
        </div>
      )}

      {/* Toggle Button */}
      {showToggle && (
        <Button
          variant="ghost"
          size="icon"
          onClick={toggleCollapse}
          className="absolute top-2 right-2 h-7 w-7 z-10 text-muted-foreground hover:text-foreground"
          title={isCollapsed ? "Show chat" : "Hide chat"}
        >
          {isCollapsed ? (
            <PanelLeftOpen className="h-4 w-4" />
          ) : (
            <PanelLeftClose className="h-4 w-4" />
          )}
        </Button>
      )}
    </div>
  );
}
