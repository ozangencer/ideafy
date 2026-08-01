"use client";

import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { AlertTriangle, Sparkles } from "lucide-react";
import { useUpdates } from "./update-provider";

/**
 * The discovery half of the update story. The mechanics have always worked;
 * what was missing was any reason to look at them — the old plugin badge only
 * rendered once Settings was already open, so a stale install stayed stale.
 *
 * Renders nothing unless there is something to act on.
 */
export function UpdateIndicator({
  collapsed = false,
  onOpenSettings,
}: {
  collapsed?: boolean;
  onOpenSettings: () => void;
}) {
  const updates = useUpdates();
  if (!updates?.hasActionableUpdate) return null;

  const { app, plugin } = updates;
  const urgent = plugin.installed && plugin.belowMinimum;

  const label = urgent
    ? "Plugin too old for this Ideafy build"
    : app.status === "ready"
      ? `Ideafy v${app.latestVersion} ready to install`
      : app.status === "available"
        ? `Ideafy v${app.latestVersion} available`
        : `Claude Code plugin v${plugin.latestVersion} available`;

  const Icon = urgent ? AlertTriangle : Sparkles;
  const tone = urgent
    ? "text-destructive"
    : "text-amber-600 dark:text-amber-500";

  if (collapsed) {
    return (
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            type="button"
            onClick={onOpenSettings}
            aria-label={label}
            className={`flex h-8 w-8 items-center justify-center rounded-md hover:bg-accent ${tone}`}
          >
            <Icon className="h-4 w-4" />
          </button>
        </TooltipTrigger>
        <TooltipContent side="right">
          <p>{label}</p>
        </TooltipContent>
      </Tooltip>
    );
  }

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          onClick={onOpenSettings}
          className={`flex items-center gap-1 rounded-full border border-current/30 px-2 py-0.5 text-xs hover:bg-accent ${tone}`}
        >
          <Icon className="h-3 w-3" />
          Update
        </button>
      </TooltipTrigger>
      <TooltipContent side="bottom">
        <p>{label}</p>
      </TooltipContent>
    </Tooltip>
  );
}
