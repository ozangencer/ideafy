"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { Bell } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { useKanbanStore } from "@/lib/store";
import type { Notification } from "@/lib/team/types";
import type { RealtimeChannel } from "@supabase/supabase-js";

function getAuthHeader(): Promise<string | null> {
  return (async () => {
    try {
      const { getSupabaseClient } = await import("@/lib/team/supabase");
      const supabase = getSupabaseClient();
      if (!supabase) return null;
      const { data: { session } } = await supabase.auth.getSession();
      return session?.access_token ? `Bearer ${session.access_token}` : null;
    } catch {
      return null;
    }
  })();
}

async function fetchWithAuth(url: string, options: RequestInit = {}): Promise<Response> {
  const authHeader = await getAuthHeader();
  return fetch(url, {
    ...options,
    headers: {
      ...options.headers,
      "Content-Type": "application/json",
      ...(authHeader ? { Authorization: authHeader } : {}),
    },
  });
}

function formatRelativeTime(iso: string): string {
  const d = new Date(iso);
  const now = new Date();
  const diffMs = now.getTime() - d.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  if (diffMins < 1) return "just now";
  if (diffMins < 60) return `${diffMins}m ago`;
  const diffHours = Math.floor(diffMins / 60);
  if (diffHours < 24) return `${diffHours}h ago`;
  const diffDays = Math.floor(diffHours / 24);
  return `${diffDays}d ago`;
}

/** Map Supabase row (snake_case) to client Notification (camelCase) */
function mapNotification(row: Record<string, unknown>): Notification {
  return {
    id: row.id as string,
    recipientUserId: row.recipient_user_id as string,
    teamId: row.team_id as string,
    type: row.type as string,
    title: row.title as string,
    message: (row.message as string) || undefined,
    referenceId: (row.reference_id as string) || undefined,
    actorUserId: (row.actor_user_id as string) || undefined,
    actorName: (row.actor_name as string) || undefined,
    isRead: row.is_read as boolean,
    createdAt: row.created_at as string,
  };
}

export function NotificationBell() {
  const { teamMode } = useKanbanStore();
  const [unreadCount, setUnreadCount] = useState(0);
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [isOpen, setIsOpen] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const channelRef = useRef<RealtimeChannel | null>(null);
  const isOpenRef = useRef(false);

  // Keep ref in sync with state for realtime callbacks
  useEffect(() => {
    isOpenRef.current = isOpen;
  }, [isOpen]);

  const fetchUnreadCount = useCallback(async () => {
    if (!teamMode) return;
    try {
      const res = await fetchWithAuth("/api/team/notifications/unread-count");
      const data = await res.json();
      if (typeof data.count === "number") {
        setUnreadCount(data.count);
      }
    } catch {
      // Silently fail
    }
  }, [teamMode]);

  // Supabase Realtime subscription with polling fallback
  useEffect(() => {
    if (!teamMode) {
      setUnreadCount(0);
      return;
    }

    // Initial fetch
    fetchUnreadCount();

    let cancelled = false;

    (async () => {
      try {
        const { getSupabaseClient } = await import("@/lib/team/supabase");
        const supabase = getSupabaseClient();
        if (!supabase || cancelled) {
          // No Supabase — fall back to polling
          if (!cancelled) {
            intervalRef.current = setInterval(fetchUnreadCount, 30000);
          }
          return;
        }

        const { data: { session } } = await supabase.auth.getSession();
        const userId = session?.user?.id;
        if (!userId || cancelled) {
          if (!cancelled) {
            intervalRef.current = setInterval(fetchUnreadCount, 30000);
          }
          return;
        }

        const channel = supabase
          .channel("notifications-realtime")
          .on(
            "postgres_changes",
            {
              event: "INSERT",
              schema: "public",
              table: "notifications",
              filter: `recipient_user_id=eq.${userId}`,
            },
            (payload) => {
              const mapped = mapNotification(payload.new);
              setNotifications((prev) => [mapped, ...prev]);
              setUnreadCount((prev) => prev + 1);
            }
          )
          .on(
            "postgres_changes",
            {
              event: "UPDATE",
              schema: "public",
              table: "notifications",
              filter: `recipient_user_id=eq.${userId}`,
            },
            (payload) => {
              const mapped = mapNotification(payload.new);
              setNotifications((prev) =>
                prev.map((n) => (n.id === mapped.id ? mapped : n))
              );
              // If marked as read, decrement
              if (payload.old && !(payload.old as Record<string, unknown>).is_read && mapped.isRead) {
                setUnreadCount((prev) => Math.max(0, prev - 1));
              }
            }
          )
          .on(
            "postgres_changes",
            {
              event: "DELETE",
              schema: "public",
              table: "notifications",
              filter: `recipient_user_id=eq.${userId}`,
            },
            (payload) => {
              const oldId = (payload.old as Record<string, unknown>).id as string;
              setNotifications((prev) => {
                const deleted = prev.find((n) => n.id === oldId);
                if (deleted && !deleted.isRead) {
                  setUnreadCount((c) => Math.max(0, c - 1));
                }
                return prev.filter((n) => n.id !== oldId);
              });
            }
          )
          .subscribe((status) => {
            if (status === "SUBSCRIBED") {
              console.log("Notification realtime connected");
              // Stop polling fallback if running
              if (intervalRef.current) {
                clearInterval(intervalRef.current);
                intervalRef.current = null;
              }
            } else if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") {
              console.warn("Notification realtime failed, falling back to polling");
              if (!intervalRef.current && !cancelled) {
                intervalRef.current = setInterval(fetchUnreadCount, 30000);
              }
            }
          });

        channelRef.current = channel;
      } catch {
        // Realtime setup failed — fall back to polling
        if (!cancelled && !intervalRef.current) {
          intervalRef.current = setInterval(fetchUnreadCount, 30000);
        }
      }
    })();

    return () => {
      cancelled = true;
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
      if (channelRef.current) {
        (async () => {
          try {
            const { getSupabaseClient } = await import("@/lib/team/supabase");
            const supabase = getSupabaseClient();
            if (supabase && channelRef.current) {
              supabase.removeChannel(channelRef.current);
            }
          } catch {
            // Ignore cleanup errors
          }
          channelRef.current = null;
        })();
      }
    };
  }, [teamMode, fetchUnreadCount]);

  const handleOpen = async (open: boolean) => {
    setIsOpen(open);
    if (open) {
      setIsLoading(true);
      try {
        const res = await fetchWithAuth("/api/team/notifications");
        const data = await res.json();
        setNotifications(data.notifications || []);

        // Mark all as read
        if (unreadCount > 0) {
          await fetchWithAuth("/api/team/notifications", { method: "PUT" });
          setUnreadCount(0);
        }
      } catch {
        // Silently fail
      } finally {
        setIsLoading(false);
      }
    }
  };

  if (!teamMode) return null;

  return (
    <Popover open={isOpen} onOpenChange={handleOpen}>
      <PopoverTrigger asChild>
        <Button variant="ghost" size="icon" className="relative h-8 w-8">
          <Bell className="h-4 w-4" />
          {unreadCount > 0 && (
            <span className="absolute -top-0.5 -right-0.5 flex items-center justify-center min-w-[16px] h-4 px-1 rounded-full bg-red-500 text-white text-[10px] font-medium">
              {unreadCount > 9 ? "9+" : unreadCount}
            </span>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-80 p-0" align="end">
        <div className="px-4 py-3 border-b border-border">
          <h4 className="text-sm font-medium">Notifications</h4>
        </div>
        <div className="max-h-[320px] overflow-y-auto">
          {isLoading ? (
            <div className="flex items-center justify-center py-8 text-sm text-muted-foreground">
              Loading...
            </div>
          ) : notifications.length === 0 ? (
            <div className="flex items-center justify-center py-8 text-sm text-muted-foreground">
              No notifications
            </div>
          ) : (
            notifications.map((n) => (
              <div
                key={n.id}
                className={`px-4 py-3 border-b border-border last:border-b-0 ${
                  !n.isRead ? "bg-primary/5" : ""
                }`}
              >
                <p className="text-sm font-medium">{n.title}</p>
                {n.message && (
                  <p className="text-xs text-muted-foreground mt-0.5 line-clamp-1">
                    {n.message}
                  </p>
                )}
                <p className="text-[10px] text-muted-foreground mt-1">
                  {formatRelativeTime(n.createdAt)}
                </p>
              </div>
            ))
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}
