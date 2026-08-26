"use client";

import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { Check, Copy, Loader2, SquareTerminal, Terminal } from "lucide-react";
import { PlatformIcon } from "@/components/icons/platform-icons";
import { useToast } from "@/hooks/use-toast";
import { AI_PLATFORM_OPTIONS, type AiPlatform } from "@/lib/types";

interface CardSession {
  sessionId: string;
  provider: string;
  cwd: string | null;
  sectionType: string | null;
  lastUsedAt: string;
  source: "chat" | "terminal";
  command: string | null;
  providerLabel: string;
}

function isKnownPlatform(id: string): id is AiPlatform {
  return AI_PLATFORM_OPTIONS.some((o) => o.value === id);
}

function shortId(sessionId: string): string {
  return sessionId.length > 12 ? `${sessionId.slice(0, 8)}…` : sessionId;
}

function relativeTime(iso: string): string {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return "unknown";
  const minutes = Math.round((Date.now() - then) / 60000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  if (days < 30) return `${days}d ago`;
  return new Date(iso).toLocaleDateString();
}

// Every CLI session recorded against this card, including ones started in a
// plain terminal rather than from Ideafy. Lives at card level rather than in
// the chat panel because terminal-born sessions have no section.
export function CardSessionsPopover({ cardId }: { cardId: string }) {
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [sessions, setSessions] = useState<CardSession[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [resumingId, setResumingId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setIsLoading(true);
    try {
      const res = await fetch(`/api/cards/${cardId}/sessions`);
      const data = await res.json();
      setSessions(res.ok ? data.sessions ?? [] : []);
    } catch {
      setSessions([]);
    } finally {
      setIsLoading(false);
    }
  }, [cardId]);

  // Load once so the trigger can show a count — the badge is the whole point
  // of discoverability, and it cannot wait for the user to open the popover.
  useEffect(() => {
    load();
  }, [load]);

  // Refresh on open too: a session bound from the terminal while the modal
  // sits there should appear without a reload.
  useEffect(() => {
    if (open) load();
  }, [open, load]);

  const handleCopy = async (session: CardSession) => {
    if (!session.command) return;
    try {
      await navigator.clipboard.writeText(session.command);
      setCopiedId(session.sessionId);
      setTimeout(() => setCopiedId(null), 1500);
    } catch {
      toast({
        variant: "destructive",
        title: "Copy failed",
        description: "Could not write to the clipboard",
      });
    }
  };

  const handleResume = async (session: CardSession) => {
    setResumingId(session.sessionId);
    try {
      const res = await fetch(`/api/cards/${cardId}/resume-cli`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionId: session.sessionId }),
      });
      const data = await res.json();
      if (!res.ok) {
        toast({ variant: "destructive", title: "Resume Failed", description: data.error });
        return;
      }
      toast({ title: "Resumed in CLI", description: data.message });
      setOpen(false);
    } catch (error) {
      toast({
        variant: "destructive",
        title: "Error",
        description: error instanceof Error ? error.message : "Failed to resume",
      });
    } finally {
      setResumingId(null);
    }
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <Tooltip>
        <TooltipTrigger asChild>
          <PopoverTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className="text-muted-foreground relative"
            >
              <Terminal className="h-5 w-5" />
              {sessions.length > 0 && (
                <span className="absolute top-1 right-1 min-w-[14px] h-[14px] px-[3px] rounded-full bg-primary text-primary-foreground text-[9px] font-medium leading-[14px]">
                  {sessions.length}
                </span>
              )}
            </Button>
          </PopoverTrigger>
        </TooltipTrigger>
        <TooltipContent side="bottom">CLI sessions</TooltipContent>
      </Tooltip>

      <PopoverContent align="end" className="w-[360px] p-0">
        <div className="px-3 py-2 border-b border-border">
          <span className="text-sm font-medium">CLI Sessions</span>
        </div>

        {isLoading ? (
          <div className="flex items-center gap-2 px-3 py-6 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            Loading…
          </div>
        ) : sessions.length === 0 ? (
          <p className="px-3 py-6 text-sm text-muted-foreground">
            No CLI session recorded for this card yet.
          </p>
        ) : (
          <ul className="max-h-[320px] overflow-y-auto py-1">
            {sessions.map((session) => (
              <li
                key={session.sessionId}
                className="flex items-center gap-2 px-3 py-2 hover:bg-accent hover:text-accent-foreground group"
              >
                {isKnownPlatform(session.provider) ? (
                  <PlatformIcon
                    platform={session.provider}
                    size={14}
                    className="shrink-0 text-muted-foreground group-hover:text-current"
                  />
                ) : (
                  <SquareTerminal className="h-3.5 w-3.5 shrink-0 text-muted-foreground group-hover:text-current" />
                )}

                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-1.5">
                    <span className="text-xs font-mono truncate">
                      {shortId(session.sessionId)}
                    </span>
                    <span className="text-[10px] text-muted-foreground group-hover:text-current shrink-0">
                      {session.source === "terminal" ? "terminal" : session.sectionType}
                    </span>
                  </div>
                  <span className="text-[11px] text-muted-foreground group-hover:text-current">
                    {session.providerLabel} · {relativeTime(session.lastUsedAt)}
                  </span>
                </div>

                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-7 w-7 shrink-0"
                      disabled={!session.command}
                      onClick={() => handleCopy(session)}
                    >
                      {copiedId === session.sessionId ? (
                        <Check className="h-3.5 w-3.5" />
                      ) : (
                        <Copy className="h-3.5 w-3.5" />
                      )}
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent side="bottom">
                    {session.command ?? "No resume command for this provider"}
                  </TooltipContent>
                </Tooltip>

                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-7 w-7 shrink-0"
                      disabled={resumingId === session.sessionId}
                      onClick={() => handleResume(session)}
                    >
                      {resumingId === session.sessionId ? (
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      ) : (
                        <SquareTerminal className="h-3.5 w-3.5" />
                      )}
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent side="bottom">Open in terminal</TooltipContent>
                </Tooltip>
              </li>
            ))}
          </ul>
        )}
      </PopoverContent>
    </Popover>
  );
}
