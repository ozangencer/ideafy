"use client";

import { useState, useCallback, useRef, useEffect } from "react";
import { PanelLeftClose, PanelLeftOpen, MessageSquare, ChevronDown, ArrowLeft } from "lucide-react";
import { Button } from "@/components/ui/button";

interface SplitPanelProps {
  leftPanel: React.ReactNode;
  rightPanel: React.ReactNode;
  defaultLeftWidth?: number; // percentage
  minLeftWidth?: number; // pixels
  minRightWidth?: number; // pixels
  showToggle?: boolean;
}

function useIsMobile() {
  const [isMobile, setIsMobile] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia("(max-width: 639px)");
    setIsMobile(mq.matches);
    const handler = (e: MediaQueryListEvent) => setIsMobile(e.matches);
    mq.addEventListener("change", handler);
    return () => mq.removeEventListener("change", handler);
  }, []);
  return isMobile;
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
  const [isChatOpen, setIsChatOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const isMobile = useIsMobile();

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

  // Mobile layout: full-width section + full-screen chat overlay
  if (isMobile) {
    return (
      <div ref={containerRef} className="flex flex-col h-full w-full overflow-hidden relative">
        {/* Section content */}
        <div className="w-full flex-1 overflow-y-auto">
          {leftPanel}
        </div>

        {/* Chat toggle bar */}
        <button
          onClick={() => setIsChatOpen(true)}
          className="shrink-0 flex items-center justify-between w-full px-4 py-3 border-t border-border bg-surface/80 backdrop-blur-sm"
        >
          <div className="flex items-center gap-2">
            <MessageSquare className="w-4 h-4 text-muted-foreground" />
            <span className="text-sm font-medium text-muted-foreground">Chat</span>
          </div>
          <ChevronDown className="w-4 h-4 text-muted-foreground rotate-180" />
        </button>

        {/* Full-screen chat overlay */}
        {isChatOpen && (
          <div className="fixed inset-0 z-50 flex flex-col bg-background animate-in slide-in-from-bottom duration-200">
            {/* Chat header */}
            <div className="shrink-0 flex items-center gap-3 px-4 py-3 border-b border-border">
              <button
                onClick={() => setIsChatOpen(false)}
                className="p-1.5 -ml-1.5 rounded-md hover:bg-muted transition-colors"
              >
                <ArrowLeft className="w-5 h-5" />
              </button>
              <div className="flex items-center gap-2">
                <MessageSquare className="w-4 h-4 text-muted-foreground" />
                <span className="text-sm font-semibold">Chat</span>
              </div>
            </div>

            {/* Chat content */}
            <div className="flex-1 flex flex-col overflow-hidden">
              {rightPanel}
            </div>
          </div>
        )}
      </div>
    );
  }

  // Desktop layout: side-by-side split
  return (
    <div ref={containerRef} className="relative flex h-full w-full overflow-hidden">
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
          className="absolute top-2 right-2 h-9 w-9 md:h-7 md:w-7 z-10 text-muted-foreground hover:text-foreground bg-surface/80 hover:bg-muted border border-border/50 rounded-md"
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
