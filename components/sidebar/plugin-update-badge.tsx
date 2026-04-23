"use client";

import { useEffect, useState } from "react";
import { Check, Sparkles, AlertCircle, RefreshCw } from "lucide-react";

interface PluginUpdateBadgeProps {
  /** Plugin is installed for the relevant scope. Skip the fetch when false. */
  installed: boolean;
  /** Scope to check — matches the install scope used elsewhere. */
  scope: "user" | "project";
  /** Required when scope === 'project'. */
  projectPath?: string;
  /** Current installed version, used as a cache-bust key so the badge
   *  re-checks after an Update click refreshes status upstream. */
  currentVersion: string | null;
  /** Optional className for layout tweaks by the parent. */
  className?: string;
}

interface UpdateCheckResponse {
  installed: boolean;
  currentVersion: string | null;
  latestVersion: string | null;
  hasUpdate: boolean;
  error?: string;
}

type UiState =
  | { kind: "hidden" }
  | { kind: "checking" }
  | { kind: "up-to-date"; version: string }
  | { kind: "update-available"; version: string }
  | { kind: "check-failed"; message: string };

export function PluginUpdateBadge({
  installed,
  scope,
  projectPath,
  currentVersion,
  className,
}: PluginUpdateBadgeProps) {
  const [state, setState] = useState<UiState>({ kind: "hidden" });

  useEffect(() => {
    if (!installed) {
      setState({ kind: "hidden" });
      return;
    }
    if (scope === "project" && !projectPath) {
      setState({ kind: "hidden" });
      return;
    }

    let cancelled = false;
    setState({ kind: "checking" });

    fetch("/api/integrations/claude-code", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "check-updates", scope, projectPath }),
    })
      .then(async (r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return (await r.json()) as UpdateCheckResponse;
      })
      .then((data) => {
        if (cancelled) return;
        if (data.error) {
          setState({ kind: "check-failed", message: data.error });
          return;
        }
        if (!data.installed) {
          setState({ kind: "hidden" });
          return;
        }
        if (data.hasUpdate && data.latestVersion) {
          setState({ kind: "update-available", version: data.latestVersion });
          return;
        }
        setState({
          kind: "up-to-date",
          version: data.currentVersion ?? data.latestVersion ?? "",
        });
      })
      .catch((err) => {
        if (cancelled) return;
        setState({
          kind: "check-failed",
          message: err instanceof Error ? err.message : String(err),
        });
      });

    return () => {
      cancelled = true;
    };
  }, [installed, scope, projectPath, currentVersion]);

  if (state.kind === "hidden") return null;

  const baseClass = `text-xs flex items-center gap-1 ${className ?? ""}`;

  if (state.kind === "checking") {
    return (
      <span className={`${baseClass} text-muted-foreground`}>
        <RefreshCw className="h-3.5 w-3.5 animate-spin" />
        Checking for updates…
      </span>
    );
  }

  if (state.kind === "up-to-date") {
    return (
      <span className={`${baseClass} text-green-600 dark:text-green-500`}>
        <Check className="h-3.5 w-3.5" />
        You are up to date{state.version ? ` (v${state.version})` : ""}
      </span>
    );
  }

  if (state.kind === "update-available") {
    return (
      <span className={`${baseClass} text-amber-600 dark:text-amber-500`}>
        <Sparkles className="h-3.5 w-3.5" />
        v{state.version} available — click Update to pull it in
      </span>
    );
  }

  return (
    <span
      className={`${baseClass} text-muted-foreground`}
      title={state.message}
    >
      <AlertCircle className="h-3.5 w-3.5" />
      Could not check for updates
    </span>
  );
}
