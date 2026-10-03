"use client";

import { CircleStop, RotateCcw } from "lucide-react";
import type { SectionType } from "@/lib/types";
import { useKanbanStore } from "@/lib/store";

/** Sent by the button: the work is gone, so it has to run again, not be asked about. */
export const RUN_AGAIN_MESSAGE =
  "Your last turn started background work that was stopped when the turn ended and produced no result. Run the same work again in the foreground, wait for it, then report.";

/**
 * Under the last reply when that turn left work running in the background:
 * the CLI exits with the turn and stops it, so the promised "I'll report when
 * it's done" never comes (IDE-392). One click runs it again in the foreground.
 */
export function BackgroundStopNotice({
  cardId,
  sectionType,
  disabled,
  onRunAgain,
}: {
  cardId: string;
  sectionType: SectionType;
  disabled?: boolean;
  onRunAgain: (content: string) => void;
}) {
  const notice = useKanbanStore((s) => s.backgroundStopNotices[`${cardId}-${sectionType}`]);
  if (!notice) return null;

  const summaries = notice.tasks.map((task) => task.summary).filter(Boolean);

  return (
    <div className="rounded border border-ink/15 bg-ink/[0.04] px-3 py-2 text-xs text-muted-foreground">
      <div className="flex items-start gap-2">
        <CircleStop className="mt-0.5 h-3.5 w-3.5 shrink-0" />
        <div className="min-w-0 flex-1 space-y-1.5">
          <p>
            Claude started work in the background. It was stopped when this turn ended, so nothing
            came back.
          </p>
          {summaries.length > 0 && (
            <ul className="list-disc space-y-0.5 pl-4">
              {summaries.map((summary, i) => (
                <li key={i}>{summary}</li>
              ))}
            </ul>
          )}
          <button
            type="button"
            disabled={disabled}
            onClick={() => onRunAgain(RUN_AGAIN_MESSAGE)}
            className="inline-flex items-center gap-1 rounded border border-ink/15 px-2 py-0.5 text-[11px] text-foreground transition-colors hover:bg-accent hover:text-accent-foreground disabled:pointer-events-none disabled:opacity-50"
          >
            <RotateCcw className="h-3 w-3" />
            Run it again in the foreground
          </button>
        </div>
      </div>
    </div>
  );
}
