"use client";

import { useState, useCallback, useRef, useEffect } from "react";
import { useKanbanStore } from "@/lib/store";
import { ProjectList } from "./project-list";
import { SkillList } from "./skill-list";
import { McpList } from "./mcp-list";
import { DocumentList } from "./document-list";
import { MyQueue } from "./my-queue";
import { SettingsModal } from "./settings-modal";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { ChevronLeft, ChevronRight, FolderKanban, Settings } from "lucide-react";

const MIN_WIDTH = 200;
const MAX_WIDTH = 400;
const COLLAPSED_WIDTH = 48;

export function Sidebar() {
  const {
    isSidebarCollapsed,
    sidebarWidth,
    toggleSidebar,
    setSidebarWidth,
    activeProjectId,
    fetchProjectExtensions,
    teamMode,
    currentUser,
  } = useKanbanStore();
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [settingsDefaultTab, setSettingsDefaultTab] = useState<"general" | "team">();
  const [pendingInviteCode, setPendingInviteCode] = useState<string>();
  const [isDragging, setIsDragging] = useState(false);

  // Deep link: ?join=CODE opens Settings > Team with invite code pre-filled
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const joinCode = params.get("join");
    if (joinCode) {
      setPendingInviteCode(joinCode.toUpperCase());
      setSettingsDefaultTab("team");
      setIsSettingsOpen(true);
      // Clean URL without reload
      window.history.replaceState({}, "", window.location.pathname);
    }
  }, []);
  const sidebarRef = useRef<HTMLDivElement>(null);

  // Handle drag resize
  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    setIsDragging(true);
  }, []);

  useEffect(() => {
    if (!isDragging) return;

    const handleMouseMove = (e: MouseEvent) => {
      const newWidth = e.clientX;
      const clampedWidth = Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, newWidth));
      setSidebarWidth(clampedWidth);
    };

    const handleMouseUp = () => {
      setIsDragging(false);
    };

    document.addEventListener("mousemove", handleMouseMove);
    document.addEventListener("mouseup", handleMouseUp);

    return () => {
      document.removeEventListener("mousemove", handleMouseMove);
      document.removeEventListener("mouseup", handleMouseUp);
    };
  }, [isDragging, setSidebarWidth]);

  // Add cursor style to body during drag
  useEffect(() => {
    if (isDragging) {
      document.body.style.cursor = "col-resize";
      document.body.style.userSelect = "none";
    } else {
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    }
  }, [isDragging]);

  // Auto-collapse sidebar on small screens (< 1024px)
  useEffect(() => {
    const mql = window.matchMedia('(max-width: 1024px)');

    const handleChange = (e: MediaQueryListEvent | MediaQueryList) => {
      if (e.matches && !useKanbanStore.getState().isSidebarCollapsed) {
        toggleSidebar();
      }
    };

    // Check on mount
    handleChange(mql);

    mql.addEventListener('change', handleChange);
    return () => mql.removeEventListener('change', handleChange);
  }, [toggleSidebar]);

  // Fetch project-specific extensions when project changes
  useEffect(() => {
    fetchProjectExtensions(activeProjectId);
  }, [activeProjectId, fetchProjectExtensions]);

  if (isSidebarCollapsed) {
    return (
      <TooltipProvider>
        <div
          className="border-r border-border bg-card flex flex-col items-center py-4 shrink-0 transition-[width] duration-200 ease-out"
          style={{ width: COLLAPSED_WIDTH }}
        >
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                onClick={toggleSidebar}
                className="h-8 w-8"
              >
                <ChevronRight className="h-4 w-4" />
              </Button>
            </TooltipTrigger>
            <TooltipContent side="right">
              <p>Expand sidebar</p>
            </TooltipContent>
          </Tooltip>

          <Separator className="my-3 w-6" />

          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className="h-8 w-8"
                onClick={toggleSidebar}
              >
                <FolderKanban className="h-4 w-4" />
              </Button>
            </TooltipTrigger>
            <TooltipContent side="right">
              <p>Projects</p>
            </TooltipContent>
          </Tooltip>

          <div className="flex-1" />

          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className="h-8 w-8"
                onClick={() => setIsSettingsOpen(true)}
              >
                <Settings className="h-4 w-4" />
              </Button>
            </TooltipTrigger>
            <TooltipContent side="right">
              <p>Settings</p>
            </TooltipContent>
          </Tooltip>
        </div>

        {isSettingsOpen && (
          <SettingsModal
            onClose={() => { setIsSettingsOpen(false); setSettingsDefaultTab(undefined); setPendingInviteCode(undefined); }}
            defaultTab={settingsDefaultTab}
            defaultInviteCode={pendingInviteCode}
          />
        )}
      </TooltipProvider>
    );
  }

  return (
    <TooltipProvider delayDuration={0}>
      <div
        ref={sidebarRef}
        className="relative border-r border-border bg-card flex flex-col h-full shrink-0 transition-[width] duration-200 ease-out"
        style={{
          width: isDragging ? undefined : sidebarWidth,
          minWidth: isDragging ? sidebarWidth : undefined,
          maxWidth: isDragging ? sidebarWidth : undefined,
        }}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-border">
          <div className="flex items-center gap-2">
            <FolderKanban className="h-4 w-4 text-muted-foreground" />
            <span className="text-sm font-medium text-foreground">Projects</span>
          </div>
          <div className="flex items-center gap-1">
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() => setIsSettingsOpen(true)}
                  className="h-7 w-7"
                >
                  <Settings className="h-4 w-4" />
                </Button>
              </TooltipTrigger>
              <TooltipContent side="bottom">
                <p>Settings</p>
              </TooltipContent>
            </Tooltip>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={toggleSidebar}
                  className="h-7 w-7"
                >
                  <ChevronLeft className="h-4 w-4" />
                </Button>
              </TooltipTrigger>
              <TooltipContent side="right">
                <p>Collapse sidebar</p>
              </TooltipContent>
            </Tooltip>
          </div>
        </div>

        {/* Project List - outside ScrollArea to avoid overflow issues */}
        <div className="py-2">
          <ProjectList />
        </div>

        {/* Scrollable Content */}
        <ScrollArea className="flex-1">
          <div className="py-2">
            {/* My Queue - team mode only */}
            {teamMode && currentUser && (
              <>
                <MyQueue />
                <Separator className="my-3 mx-4" />
              </>
            )}

            {/* Skills Section */}
            <SkillList />

            {/* MCPs Section */}
            <McpList />

            {/* Documents Section - only show when project selected */}
            {activeProjectId && (
              <>
                <Separator className="my-3 mx-4" />
                <DocumentList />
              </>
            )}
          </div>
        </ScrollArea>

        {/* Resize Handle */}
        <div
          className="absolute top-0 right-0 w-1 h-full cursor-col-resize hover:bg-primary/20 active:bg-primary/30 transition-colors z-10"
          onMouseDown={handleMouseDown}
        />
      </div>

      {isSettingsOpen && (
        <SettingsModal onClose={() => setIsSettingsOpen(false)} />
      )}
    </TooltipProvider>
  );
}
