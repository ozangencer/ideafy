"use client";

import { useEffect, useState } from "react";
import { Lock, Pause } from "lucide-react";
import { useKanbanStore } from "@/lib/store";
import type { ChatWriteBlock } from "@/lib/card-queue";

/**
 * One line above the Tests chat input while a run or the queue holds the
 * card's folder: the next turn answers but cannot edit. Pause sits right in
 * it, since pausing is how you hand the folder back to the chat. Re-asked
 * whenever the queue or process polls change, which is when the answer can.
 */
export function TestsChatReadOnlyNotice({ cardId }: { cardId: string }) {
  const queueState = useKanbanStore((s) => s.queueState);
  const backgroundProcesses = useKanbanStore((s) => s.backgroundProcesses);
  const setQueueRunning = useKanbanStore((s) => s.setQueueRunning);
  const [block, setBlock] = useState<ChatWriteBlock | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/cards/${cardId}/chat-write-block`)
      .then((response) => (response.ok ? response.json() : { block: null }))
      .then((data: { block: ChatWriteBlock | null }) => {
        if (!cancelled) setBlock(data.block);
      })
      .catch(() => {
        if (!cancelled) setBlock(null);
      });
    return () => {
      cancelled = true;
    };
  }, [cardId, queueState, backgroundProcesses]);

  if (!block) return null;

  return (
    <div className="mb-2 flex items-center gap-2 rounded border border-ink/15 bg-ink/[0.04] px-2 py-1.5 text-[11px] text-muted-foreground">
      <Lock className="h-3 w-3 shrink-0" />
      <span className="min-w-0 flex-1">{block.message}</span>
      {block.pausable && (
        <button
          type="button"
          onClick={() => setQueueRunning(false)}
          className="inline-flex shrink-0 items-center gap-1 rounded border border-ink/15 px-1.5 py-0.5 text-[11px] text-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
        >
          <Pause className="h-3 w-3" />
          Pause
        </button>
      )}
    </div>
  );
}
