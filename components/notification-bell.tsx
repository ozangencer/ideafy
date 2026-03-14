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

export function NotificationBell() {
  const { teamMode } = useKanbanStore();
  const [unreadCount, setUnreadCount] = useState(0);
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [isOpen, setIsOpen] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

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

  // Poll unread count every 30 seconds
  useEffect(() => {
    if (!teamMode) {
      setUnreadCount(0);
      return;
    }

    fetchUnreadCount();
    intervalRef.current = setInterval(fetchUnreadCount, 30000);

    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
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
