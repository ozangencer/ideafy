"use client";

import { useEffect, useMemo, useState } from "react";
import { Bell, ChevronRight } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useToast } from "@/hooks/use-toast";
import { useKanbanStore } from "@/lib/store";
import { getDisplayId } from "@/lib/types";
import type {
  ActivityEvent,
  ActivityHistoryEntry,
  ActivitySource,
  ActivityType,
  Card,
  Project,
  SectionType,
} from "@/lib/types";

// Map an activity event to the card-modal section it should land on. For
// "apply" events the field name in payload is authoritative; for everything
// else we fall back to a per-type default. Returns null when there is no
// useful target (e.g. team/sync events with no card binding).
function sectionForEvent(event: ActivityEvent): SectionType | null {
  if (event.type === "apply") {
    const field = event.payload?.field as string | undefined;
    if (field === "description") return "detail";
    if (field === "solutionSummary") return "solution";
    if (field === "aiOpinion") return "opinion";
    if (field === "testScenarios") return "tests";
    return null;
  }
  const map: Partial<Record<ActivityType, SectionType>> = {
    opinion: "opinion",
    plan: "solution",
    implementation: "solution",
    autonomous: "solution",
    quickfix: "solution",
    "chat-detail": "detail",
    "chat-opinion": "opinion",
    "chat-solution": "solution",
    "chat-tests": "tests",
  };
  return map[event.type] ?? null;
}

interface ActivityBellProps {
  // Cloud wrapper passes Supabase team notifications here. Each source is
  // rendered as its own group inside the popover and contributes to the
  // unread badge. Base never reads these from the store directly so it
  // stays cloud-agnostic.
  extraSources?: ActivitySource[];
}

export function ActivityBell({ extraSources = [] }: ActivityBellProps) {
  const {
    activityEvents,
    activityUnreadCount,
    fetchActivity,
    fetchActivityUnreadCount,
    markActivityRead,
    markAllActivityRead,
    cards,
    projects,
    selectCard,
    openModal,
    setPendingCardSection,
  } = useKanbanStore();

  const [isOpen, setIsOpen] = useState(false);
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());
  const { toast } = useToast();

  // Initial fetch + polling. Runs only when the bell is mounted; the panel is
  // visible across the whole app so the cadence drives the topbar badge for
  // every screen.
  useEffect(() => {
    fetchActivity();
    const interval = setInterval(() => fetchActivity(), 30000);
    return () => clearInterval(interval);
  }, [fetchActivity]);

  // Refresh on tab focus so a user returning to the window sees fresh state
  // without waiting for the next polling tick.
  useEffect(() => {
    const handler = () => {
      if (document.visibilityState === "visible") {
        fetchActivity();
      }
    };
    document.addEventListener("visibilitychange", handler);
    return () => document.removeEventListener("visibilitychange", handler);
  }, [fetchActivity]);

  const totalUnread = useMemo(() => {
    const extra = extraSources.reduce((sum, s) => sum + s.unreadCount, 0);
    return activityUnreadCount + extra;
  }, [activityUnreadCount, extraSources]);

  const handleRowClick = (event: ActivityEvent) => {
    if (!event.isRead) {
      markActivityRead([event.id]);
    }
    if (!event.cardId) return;
    const card = cards.find((c) => c.id === event.cardId);
    if (!card) {
      toast({
        title: "Card not found",
        description: "This card was deleted. The activity entry stays for history.",
        variant: "destructive",
      });
      return;
    }
    const section = sectionForEvent(event);
    if (section) setPendingCardSection(section);
    selectCard(card);
    openModal();
    setIsOpen(false);
  };

  const toggleExpand = (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const handleMarkAll = async () => {
    await markAllActivityRead();
    for (const source of extraSources) {
      if (source.onMarkAllRead) await source.onMarkAllRead();
    }
  };

  // Refresh local feed whenever the popover opens so the user sees the
  // current state, not a 30s-stale snapshot.
  const handleOpenChange = (open: boolean) => {
    setIsOpen(open);
    if (open) {
      fetchActivity();
      fetchActivityUnreadCount();
    }
  };

  const localGroups = useMemo(() => groupByDate(activityEvents), [activityEvents]);

  return (
    <Popover open={isOpen} onOpenChange={handleOpenChange}>
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          size="sm"
          className="relative h-9 w-9 p-0"
          aria-label="Notifications"
        >
          <Bell
            className={`w-5 h-5 ${totalUnread > 0 ? "text-foreground" : "text-muted-foreground"}`}
          />
          {totalUnread > 0 && (
            <span className="absolute -top-0.5 -right-0.5 h-4 min-w-4 px-1 rounded-full bg-ink text-[10px] font-medium text-background flex items-center justify-center">
              {totalUnread > 99 ? "99+" : totalUnread}
            </span>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-96 p-0">
        <div className="flex items-center justify-between px-4 py-3 border-b border-border">
          <span className="text-sm font-medium">Activity</span>
          {totalUnread > 0 && (
            <Button
              variant="ghost"
              size="sm"
              onClick={handleMarkAll}
              className="h-7 text-xs text-muted-foreground hover:text-foreground"
            >
              Mark all read
            </Button>
          )}
        </div>
        <ScrollArea className="max-h-96">
          {activityEvents.length === 0 && extraSources.every((s) => s.events.length === 0) ? (
            <div className="px-4 py-8 text-center text-sm text-muted-foreground">
              No activity yet. Completed AI work will show up here.
            </div>
          ) : (
            <div className="py-1">
              {localGroups.map(({ label, events }) => (
                <ActivityGroup
                  key={`local-${label}`}
                  label={label}
                  events={events}
                  cards={cards}
                  projects={projects}
                  expandedIds={expandedIds}
                  onRowClick={handleRowClick}
                  onToggleExpand={toggleExpand}
                />
              ))}
              {extraSources.map((source) =>
                source.events.length > 0 ? (
                  <ActivityGroup
                    key={`extra-${source.key}`}
                    label={source.key}
                    events={source.events}
                    cards={cards}
                    projects={projects}
                    expandedIds={expandedIds}
                    onRowClick={(event) => {
                      if (!event.isRead && source.onMarkRead) {
                        source.onMarkRead([event.id]);
                      }
                      handleRowClick(event);
                    }}
                    onToggleExpand={toggleExpand}
                  />
                ) : null
              )}
            </div>
          )}
        </ScrollArea>
      </PopoverContent>
    </Popover>
  );
}

interface ActivityGroupProps {
  label: string;
  events: ActivityEvent[];
  cards: Card[];
  projects: Project[];
  expandedIds: Set<string>;
  onRowClick: (event: ActivityEvent) => void;
  onToggleExpand: (id: string, e: React.MouseEvent) => void;
}

function ActivityGroup({
  label,
  events,
  cards,
  projects,
  expandedIds,
  onRowClick,
  onToggleExpand,
}: ActivityGroupProps) {
  return (
    <div className="mb-1">
      <div className="px-4 py-1.5 text-[11px] uppercase tracking-wide text-muted-foreground">
        {label}
      </div>
      {events.map((event) => {
        const runCount = (event.payload?.runCount as number | undefined) ?? 1;
        const history = Array.isArray(event.payload?.history)
          ? (event.payload.history as ActivityHistoryEntry[])
          : [];
        const isExpanded = expandedIds.has(event.id);
        const card = event.cardId ? cards.find((c) => c.id === event.cardId) : null;
        const project = card ? projects.find((p) => p.id === card.projectId) : null;
        const displayId = card ? getDisplayId(card, project) : null;
        return (
          <div
            key={event.id}
            className={`px-4 py-2 border-b border-border last:border-b-0 cursor-pointer hover:bg-muted/50 transition-colors ${event.isRead ? "" : "bg-muted/20"}`}
            onClick={() => onRowClick(event)}
          >
            <div className="flex items-start gap-2">
              <span
                className={`mt-1.5 h-1.5 w-1.5 rounded-full shrink-0 ${event.isRead ? "bg-transparent" : "bg-ink"}`}
              />
              <div className="min-w-0 flex-1">
                {(displayId || card) && (
                  <div className="flex items-baseline gap-1.5 mb-0.5">
                    {displayId && (
                      <span className="text-[11px] font-medium text-muted-foreground shrink-0">
                        {displayId}
                      </span>
                    )}
                    {card && (
                      <span className="text-[11px] text-muted-foreground truncate">
                        {card.title}
                      </span>
                    )}
                  </div>
                )}
                <div className="flex items-baseline gap-2">
                  <span className="text-sm font-medium truncate">{event.title}</span>
                  {runCount > 1 && (
                    <button
                      type="button"
                      onClick={(e) => onToggleExpand(event.id, e)}
                      className="text-[10px] px-1.5 py-0.5 rounded bg-secondary text-muted-foreground hover:text-foreground inline-flex items-center gap-0.5"
                    >
                      <ChevronRight
                        className={`w-2.5 h-2.5 transition-transform ${isExpanded ? "rotate-90" : ""}`}
                      />
                      ×{runCount}
                    </button>
                  )}
                </div>
                {event.summary && (
                  <div className="text-xs text-muted-foreground mt-0.5">{event.summary}</div>
                )}
                <div className="text-[11px] text-muted-foreground mt-0.5">
                  {formatRelative(event.updatedAt)}
                </div>
                {isExpanded && history.length > 0 && (
                  <div className="mt-2 pl-2 border-l border-border space-y-1.5">
                    {history.map((entry, idx) => (
                      <div key={idx} className="text-xs text-muted-foreground">
                        <span className="opacity-70">{formatRelative(entry.at)} — </span>
                        {entry.summary || "(no summary)"}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

function groupByDate(events: ActivityEvent[]): { label: string; events: ActivityEvent[] }[] {
  const today: ActivityEvent[] = [];
  const yesterday: ActivityEvent[] = [];
  const earlier: ActivityEvent[] = [];
  const now = new Date();
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const startOfYesterday = startOfToday - 24 * 60 * 60 * 1000;

  for (const event of events) {
    const t = new Date(event.updatedAt).getTime();
    if (t >= startOfToday) today.push(event);
    else if (t >= startOfYesterday) yesterday.push(event);
    else earlier.push(event);
  }

  const groups: { label: string; events: ActivityEvent[] }[] = [];
  if (today.length) groups.push({ label: "Today", events: today });
  if (yesterday.length) groups.push({ label: "Yesterday", events: yesterday });
  if (earlier.length) groups.push({ label: "Earlier", events: earlier });
  return groups;
}

function formatRelative(iso: string): string {
  const d = new Date(iso);
  const now = new Date();
  const diffMs = now.getTime() - d.getTime();
  const mins = Math.floor(diffMs / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  return d.toLocaleDateString();
}
