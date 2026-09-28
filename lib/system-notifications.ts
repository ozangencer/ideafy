"use client";

import type { BackgroundProcess, ProcessType, SectionType } from "@/lib/types";
import { PROCESS_LABEL, SECTION_LABEL } from "@/lib/process-labels";

// Renderer side of the OS-banner bridge in electron/notifications.js. Every
// export is a no-op in a plain browser: there is no electronAPI there, and a
// Web Notification fallback is deliberately not offered.

export interface NotifyPayload {
  title: string;
  body: string;
  cardId: string | null;
  section: SectionType | null;
}

export interface OpenCardPayload {
  cardId: string | null;
  section: string | null;
}

/** Main's outcome for a test banner; see showNotification in electron/notifications.js. */
export type TestNotifyResult = "shown" | "focused" | "unsupported";

interface NotificationBridge {
  notify?: (payload: NotifyPayload) => void;
  testNotify?: () => Promise<TestNotifyResult>;
  onOpenCard?: (callback: (payload: OpenCardPayload) => void) => () => void;
}

function bridge(): NotificationBridge | undefined {
  if (typeof window === "undefined") return undefined;
  return (window as unknown as { electronAPI?: NotificationBridge }).electronAPI;
}

export function hasSystemNotifications(): boolean {
  return typeof bridge()?.notify === "function";
}

/** False in builds whose preload predates the test button. */
export function canTestSystemNotifications(): boolean {
  return typeof bridge()?.testNotify === "function";
}

/** Raises a banner even with the window focused, and reports main's outcome. */
export async function sendTestNotification(): Promise<TestNotifyResult | "unavailable"> {
  const testNotify = bridge()?.testNotify;
  if (!testNotify) return "unavailable";
  return testNotify();
}

/** Subscribes to banner clicks; the payload is checked before it reaches `callback`. */
export function onNotificationOpenCard(
  callback: (cardId: string, section: SectionType | null) => void
): () => void {
  const subscribe = bridge()?.onOpenCard;
  if (!subscribe) return () => {};
  return subscribe(({ cardId, section }) => {
    if (typeof cardId !== "string" || !cardId) return;
    callback(cardId, section && section in SECTION_LABEL ? (section as SectionType) : null);
  });
}

function runLabel(processType: ProcessType, sectionType: SectionType | null): string {
  if (processType === "chat") return `Chat (${SECTION_LABEL[sectionType ?? "detail"]})`;
  return PROCESS_LABEL[processType];
}

function sectionFor(process: BackgroundProcess): SectionType | null {
  if (process.processType === "chat") return process.sectionType;
  if (process.processType === "evaluate") return "opinion";
  return "solution";
}

/**
 * Raises one banner for every run that finished in the same poll. A batch of
 * ten autonomous cards would otherwise stack ten banners, and the first thing
 * people do with a noisy app is turn its notifications off. Only "completed"
 * and "failed" count: a kill never reaches here with a completed entry, and an
 * "aborted" run was stopped on purpose.
 */
export function notifyFinishedRuns(finished: BackgroundProcess[]): void {
  const notify = bridge()?.notify;
  if (!notify) {
    console.debug("[notify] no electronAPI.notify bridge, skipping", finished.length, "finished run(s)");
    return;
  }

  const runs = finished.filter((p) => p.endReason === "completed" || p.endReason === "failed");
  if (runs.length === 0) {
    console.debug("[notify] every finished run was aborted, no banner", finished.map((p) => p.id));
    return;
  }

  if (runs.length === 1) {
    const run = runs[0];
    const displayName = run.displayId || run.cardId.slice(0, 8);
    const label = runLabel(run.processType, run.sectionType);
    let outcome: string;
    if (run.endReason === "failed") {
      outcome = `${label} failed`;
    } else if (run.processType === "chat") {
      outcome = "AI replied";
    } else {
      outcome = run.warning ? `${label} finished with a warning` : `${label} completed`;
    }
    notify({
      title: `${displayName}: ${outcome}`,
      body: run.warning && run.endReason !== "failed" ? `${run.cardTitle} — ${run.warning}` : run.cardTitle,
      cardId: run.cardId,
      section: sectionFor(run),
    });
    return;
  }

  // Clicking the summary opens the run that needs attention first.
  const failed = runs.filter((p) => p.endReason === "failed");
  const done = runs.length - failed.length;
  const parts: string[] = [];
  if (done > 0) parts.push(`${done} ${done === 1 ? "run" : "runs"} finished`);
  if (failed.length > 0) parts.push(`${failed.length} failed`);
  const target = failed[0] ?? runs[0];
  notify({
    title: parts.join(", "),
    body: runs.map((p) => p.displayId || p.cardId.slice(0, 8)).join(", "),
    cardId: target.cardId,
    section: sectionFor(target),
  });
}
