"use client";

import { Button } from "@/components/ui/button";
import {
  AlertCircle,
  AlertTriangle,
  Check,
  Download,
  RefreshCw,
  Sparkles,
} from "lucide-react";
import { useUpdates } from "./update-provider";

/** One "status line + action button" row, shared by the app and plugin. */
function UpdateRow({
  label,
  status,
  action,
  note,
}: {
  label: string;
  status: React.ReactNode;
  action?: React.ReactNode;
  note?: React.ReactNode;
}) {
  return (
    <div className="grid gap-1.5">
      <div className="flex items-center justify-between gap-3">
        <span className="text-sm font-medium shrink-0">{label}</span>
        <div className="flex items-center gap-2 min-w-0">
          <span className="text-xs truncate">{status}</span>
          {action}
        </div>
      </div>
      {note}
    </div>
  );
}

export function UpdateCenter() {
  const updates = useUpdates();
  if (!updates) return null;

  const { app, plugin, pluginBusy, checkApp, downloadApp, installApp, updatePlugin } =
    updates;

  // ── Ideafy app ──────────────────────────────────────────────────────
  let appStatus: React.ReactNode;
  let appAction: React.ReactNode = null;
  let appNote: React.ReactNode = null;

  if (!app.supported) {
    appStatus = (
      <span className="text-muted-foreground">
        {app.currentVersion ? `v${app.currentVersion} · ` : ""}
        auto-update runs in the packaged app
      </span>
    );
  } else if (app.status === "checking") {
    appStatus = (
      <span className="text-muted-foreground flex items-center gap-1">
        <RefreshCw className="h-3.5 w-3.5 animate-spin" />
        Checking…
      </span>
    );
  } else if (app.status === "available") {
    appStatus = (
      <span className="text-amber-600 dark:text-amber-500 flex items-center gap-1">
        <Sparkles className="h-3.5 w-3.5" />
        v{app.latestVersion} available
      </span>
    );
    appAction = (
      <Button type="button" variant="outline" size="sm" onClick={downloadApp} className="gap-1.5">
        <Download className="h-3.5 w-3.5" />
        Download
      </Button>
    );
  } else if (app.status === "downloading") {
    appStatus = <span className="text-muted-foreground">Downloading… {app.percent}%</span>;
    appNote = (
      <div className="h-1 w-full rounded-full bg-secondary overflow-hidden">
        <div
          className="h-full bg-amber-500 transition-[width] duration-200"
          style={{ width: `${app.percent}%` }}
        />
      </div>
    );
  } else if (app.status === "ready") {
    appStatus = (
      <span className="text-green-600 dark:text-green-500 flex items-center gap-1">
        <Check className="h-3.5 w-3.5" />
        v{app.latestVersion} ready
      </span>
    );
    appAction = (
      <Button type="button" variant="outline" size="sm" onClick={installApp}>
        Install and Relaunch
      </Button>
    );
    appNote = (
      <p className="text-xs text-muted-foreground">
        Ideafy restarts to install. In-flight Claude sessions and background tasks
        will stop, so finish or park them first.
      </p>
    );
  } else if (app.status === "installing") {
    appStatus = (
      <span className="text-muted-foreground flex items-center gap-1">
        <RefreshCw className="h-3.5 w-3.5 animate-spin" />
        Installing…
      </span>
    );
    appNote = (
      <p className="text-xs text-muted-foreground">
        Unpacking v{app.latestVersion}. Ideafy quits and reopens on its own —
        this takes a few seconds.
      </p>
    );
  } else if (app.status === "error") {
    appStatus = (
      <span className="text-muted-foreground flex items-center gap-1" title={app.error ?? ""}>
        <AlertCircle className="h-3.5 w-3.5" />
        Could not check
      </span>
    );
    appAction = (
      <Button type="button" variant="outline" size="sm" onClick={checkApp} className="gap-1.5">
        <RefreshCw className="h-3.5 w-3.5" />
        Retry
      </Button>
    );
  } else {
    appStatus =
      app.status === "up-to-date" ? (
        <span className="text-green-600 dark:text-green-500 flex items-center gap-1">
          <Check className="h-3.5 w-3.5" />
          v{app.currentVersion} · up to date
        </span>
      ) : (
        <span className="text-muted-foreground">v{app.currentVersion}</span>
      );
    appAction = (
      <Button type="button" variant="outline" size="sm" onClick={checkApp} className="gap-1.5">
        <RefreshCw className="h-3.5 w-3.5" />
        Check
      </Button>
    );
  }

  // A failed download or install drops the row back to an actionable state and
  // keeps the reason in `error` alone. Without surfacing it here the button
  // reads as having done nothing at all, which is exactly how a stale "ready"
  // state used to present itself.
  if (app.error && app.status !== "error") {
    appNote = <p className="text-xs text-destructive">Last attempt failed: {app.error}</p>;
  }

  // ── Claude Code plugin ──────────────────────────────────────────────
  // Only the update path lives here; install / enable / uninstall stay on the
  // plugin row above so this block reads as one thing: what needs updating.
  let pluginStatus: React.ReactNode;
  let pluginAction: React.ReactNode = null;
  let pluginNote: React.ReactNode = null;

  const pluginUpdateButton = (
    <Button
      type="button"
      variant="outline"
      size="sm"
      onClick={updatePlugin}
      disabled={pluginBusy}
      className="gap-1.5"
    >
      <RefreshCw className={`h-3.5 w-3.5 ${pluginBusy ? "animate-spin" : ""}`} />
      {pluginBusy ? "Updating…" : "Update"}
    </Button>
  );

  if (plugin.loading) {
    pluginStatus = (
      <span className="text-muted-foreground flex items-center gap-1">
        <RefreshCw className="h-3.5 w-3.5 animate-spin" />
        Checking…
      </span>
    );
  } else if (plugin.belowMinimum) {
    // Deliberately a warning, not a block: the MCP tools keep working and
    // stopping someone mid-task over a version number would be worse than the
    // schema drift it guards against.
    pluginStatus = (
      <span className="text-destructive flex items-center gap-1">
        <AlertTriangle className="h-3.5 w-3.5" />
        v{plugin.currentVersion} too old
      </span>
    );
    pluginAction = pluginUpdateButton;
    pluginNote = (
      <p className="text-xs text-destructive">
        This Ideafy build expects plugin v{plugin.minimumVersion} or newer. Until
        you update, the plugin&apos;s MCP tools read a database schema they may no
        longer match.
      </p>
    );
  } else if (plugin.hasUpdate) {
    pluginStatus = (
      <span className="text-amber-600 dark:text-amber-500 flex items-center gap-1">
        <Sparkles className="h-3.5 w-3.5" />
        v{plugin.latestVersion} available
      </span>
    );
    pluginAction = pluginUpdateButton;
  } else if (plugin.error) {
    pluginStatus = (
      <span className="text-muted-foreground flex items-center gap-1" title={plugin.error}>
        <AlertCircle className="h-3.5 w-3.5" />
        Could not check
      </span>
    );
  } else {
    pluginStatus = (
      <span className="text-green-600 dark:text-green-500 flex items-center gap-1">
        <Check className="h-3.5 w-3.5" />
        v{plugin.currentVersion} · up to date
      </span>
    );
  }

  if (!pluginNote && (plugin.hasUpdate || plugin.belowMinimum)) {
    pluginNote = (
      <p className="text-xs text-muted-foreground">
        Updating swaps the plugin&apos;s MCP server on disk. Already-running Claude
        Code sessions keep the old one until you restart them.
      </p>
    );
  }

  return (
    <div className="grid gap-3 rounded-md border border-border p-3">
      <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
        Updates
      </span>
      <UpdateRow label="Ideafy" status={appStatus} action={appAction} note={appNote} />
      {/* No row when the plugin isn't installed — the install affordance lives
          on the plugin row above, and "not installed" is not an update. */}
      {(plugin.loading || plugin.installed) && (
        <UpdateRow
          label="Claude Code plugin"
          status={pluginStatus}
          action={pluginAction}
          note={pluginNote}
        />
      )}
    </div>
  );
}
