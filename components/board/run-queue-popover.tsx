"use client";

import { useState } from "react";
import { ListVideo, MoreHorizontal, Pause, Play } from "lucide-react";
import type { QueueSnapshot } from "@/lib/card-queue";
import { useKanbanStore } from "@/lib/store";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

type QueueItem = QueueSnapshot["items"][number];

function statusLine(queue: QueueSnapshot): string {
  if (queue.running) {
    return queue.running.fromQueue
      ? `Running · ${queue.running.displayId}`
      : `Waiting for ${queue.running.displayId} to finish`;
  }
  if (queue.pausedReason) return `Paused — ${queue.pausedReason}`;
  return queue.armed ? "Starting the next card…" : "Paused";
}

/**
 * The run queue behind the In Progress header's "Queue · N" chip.
 *
 * A clone of the chain popover, on purpose: the order is corrected the same
 * way — "Move to start" and "Move after…", no drag handles and no position
 * numbers to count. The footer says what the queue is doing, which is the
 * question you come back with after walking away from it.
 */
export function RunQueueChip() {
  const queue = useKanbanStore((s) => s.queueState);
  const cards = useKanbanStore((s) => s.cards);
  const selectCard = useKanbanStore((s) => s.selectCard);
  const openModal = useKanbanStore((s) => s.openModal);
  const moveInQueue = useKanbanStore((s) => s.moveInQueue);
  const removeFromQueue = useKanbanStore((s) => s.removeFromQueue);
  const setQueuedCardWorktree = useKanbanStore((s) => s.setQueuedCardWorktree);
  const setQueueRunning = useKanbanStore((s) => s.setQueueRunning);
  const [open, setOpen] = useState(false);

  if (!queue || queue.items.length === 0) return null;
  const paused = !queue.armed;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        {/* Icon and count only: the header already holds the title, the WIP
            counter and the add button, and a worded chip truncated "In
            Progress" to "In Pr…". The tooltip says the rest. */}
        <button
          type="button"
          aria-label={`Run queue: ${queue.items.length} waiting${paused ? ", paused" : ""}`}
          title={`Run queue · ${queue.items.length} waiting${paused ? " · paused" : ""}`}
          className={`inline-flex items-center gap-1 text-xs px-1.5 py-0.5 rounded flex-shrink-0 font-mono tabular-nums transition-colors ${
            paused
              ? "bg-amber-500/15 text-amber-600 dark:text-amber-400 hover:bg-amber-500/25"
              : "bg-ink/[0.06] text-muted-foreground hover:text-foreground"
          }`}
        >
          <ListVideo className="h-3 w-3" />
          {queue.items.length}
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-80 p-1.5">
        <div className="px-1.5 pb-1.5 pt-0.5 text-[11px] text-muted-foreground">
          Run queue · starts when the run before it ends
        </div>
        <ol className="max-h-80 overflow-y-auto">
          {queue.items.map((item, index) => {
            // "After X" is a no-op when X already sits right in front.
            const anchors = queue.items.filter(
              (other, i) => other.cardId !== item.cardId && i !== index - 1
            );
            const overlapText = item.overlaps
              .map((o) => `${o.displayId}: ${o.files.join(", ")}`)
              .join("\n");
            return (
              <li key={item.cardId} className="group/row flex items-center gap-0.5">
                <button
                  type="button"
                  onClick={() => {
                    const card = cards.find((c) => c.id === item.cardId);
                    if (!card) return;
                    setOpen(false);
                    selectCard(card);
                    openModal();
                  }}
                  className={`flex min-w-0 flex-1 items-center gap-2 rounded px-1.5 py-1 text-left text-xs transition-colors hover:bg-accent hover:text-accent-foreground ${
                    index === 0 ? "bg-ink/[0.06]" : ""
                  }`}
                >
                  <span className="w-4 shrink-0 text-right font-mono text-[10px] tabular-nums text-current opacity-70">
                    {index + 1}
                  </span>
                  <span className="shrink-0 font-mono text-[10px] text-current">
                    {item.displayId}
                  </span>
                  <span className="min-w-0 flex-1 truncate">{item.title}</span>
                  {/* Isolated branch is the usual case; only the exception
                      gets a mark, so a plain row stays plain. */}
                  {!item.runsInWorktree && (
                    <span
                      title="Runs on the current branch, without a worktree"
                      className="shrink-0 rounded bg-ink/[0.06] px-1 font-mono text-[10px] text-current"
                    >
                      main
                    </span>
                  )}
                  {item.overlaps.length > 0 && (
                    <span
                      title={`Shares files with work ahead of it:\n${overlapText}`}
                      aria-label="Shares files with work ahead of it"
                      className="h-1.5 w-1.5 shrink-0 rounded-full bg-amber-500"
                    />
                  )}
                </button>
                <QueueRowMenu
                  item={item}
                  canMoveToStart={index > 0}
                  anchors={anchors}
                  onPlace={(afterCardId) => moveInQueue(item.cardId, afterCardId)}
                  onRemove={() => removeFromQueue(item.cardId)}
                  onToggleWorktree={() => setQueuedCardWorktree(item.cardId, !item.runsInWorktree)}
                />
              </li>
            );
          })}
        </ol>
        <div className="mt-1 flex items-center gap-2 border-t border-dashed border-ink/15 px-1.5 pt-1.5">
          <span
            className={`min-w-0 flex-1 truncate text-[11px] ${
              queue.pausedReason ? "text-amber-600 dark:text-amber-400" : "text-muted-foreground"
            }`}
            title={statusLine(queue)}
          >
            {statusLine(queue)}
          </span>
          <button
            type="button"
            onClick={() => setQueueRunning(paused)}
            className="inline-flex shrink-0 items-center gap-1 rounded border border-ink/15 px-1.5 py-0.5 text-[11px] transition-colors hover:bg-accent hover:text-accent-foreground"
          >
            {paused ? <Play className="h-3 w-3" /> : <Pause className="h-3 w-3" />}
            {paused ? "Resume" : "Pause"}
          </button>
        </div>
      </PopoverContent>
    </Popover>
  );
}

function QueueRowMenu({
  item,
  canMoveToStart,
  anchors,
  onPlace,
  onRemove,
  onToggleWorktree,
}: {
  item: QueueItem;
  canMoveToStart: boolean;
  anchors: QueueItem[];
  onPlace: (afterCardId: string | null) => void;
  onRemove: () => void;
  onToggleWorktree: () => void;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          aria-label={`Reorder ${item.displayId}`}
          onClick={(event) => event.stopPropagation()}
          className="shrink-0 rounded p-0.5 text-muted-foreground opacity-0 transition-opacity hover:bg-accent hover:text-accent-foreground focus-visible:opacity-100 group-hover/row:opacity-100 data-[state=open]:opacity-100"
        >
          <MoreHorizontal className="h-3.5 w-3.5" />
        </button>
      </DropdownMenuTrigger>
      {/* The popover sits at z-[70]; the default z-50 would open this menu
          underneath it, where a click on "⋯" looks like it did nothing. */}
      <DropdownMenuContent align="end" className="z-[80] w-44">
        {canMoveToStart && (
          <DropdownMenuItem className="text-xs" onSelect={() => onPlace(null)}>
            Move to start
          </DropdownMenuItem>
        )}
        {anchors.length > 0 && (
          <DropdownMenuSub>
            <DropdownMenuSubTrigger className="text-xs">Move after…</DropdownMenuSubTrigger>
            <DropdownMenuSubContent className="z-[80] max-h-72 w-64 overflow-y-auto">
              {anchors.map((anchor) => (
                <DropdownMenuItem
                  key={anchor.cardId}
                  className="text-xs"
                  onSelect={() => onPlace(anchor.cardId)}
                >
                  <span className="shrink-0 font-mono text-[10px] text-current opacity-70">
                    {anchor.displayId}
                  </span>
                  <span className="min-w-0 flex-1 truncate">{anchor.title}</span>
                </DropdownMenuItem>
              ))}
            </DropdownMenuSubContent>
          </DropdownMenuSub>
        )}
        {(canMoveToStart || anchors.length > 0) && <DropdownMenuSeparator />}
        <DropdownMenuItem className="text-xs" onSelect={onToggleWorktree}>
          {item.runsInWorktree ? "Run on current branch" : "Run on isolated branch"}
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem className="text-xs" onSelect={onRemove}>
          Remove
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
