"use client";

import { useState, type ReactNode } from "react";
import { GitMerge, ListVideo, MoreHorizontal, Pause, Play } from "lucide-react";
import type { QueueOverlap, QueueSnapshot } from "@/lib/card-queue";
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
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { ToastAction } from "@/components/ui/toast";
import { toast } from "@/hooks/use-toast";
import { useQueuePlace } from "./use-card-queue-actions";

type QueueItem = QueueSnapshot["items"][number];

/** The word a card's queue chip carries next to its place: "1 · impl". */
export const QUEUE_KIND_SHORT: Record<QueueItem["kind"], string> = {
  implementation: "impl",
  verify: "verify",
};

/** The chip's word with a pre-verify's reach: "verify all" walks every group left. */
export function queueKindLabel(kind: QueueItem["kind"], verifyScope: QueueItem["verifyScope"]): string {
  return kind === "verify" && verifyScope === "all" ? "verify all" : QUEUE_KIND_SHORT[kind];
}

/**
 * Where a card stands in the queue, spelled out for its chip's tooltip:
 * "Queued #1 · pre-verify on main · starts after IDE-393".
 */
export function describeQueuePlace(queue: QueueSnapshot, cardId: string): string | null {
  const index = queue.items.findIndex((item) => item.cardId === cardId);
  if (index < 0) return null;
  const item = queue.items[index];
  const parts = [
    `Queued #${index + 1}`,
    `${item.kind === "verify" ? (item.verifyScope === "all" ? "pre-verify of all remaining groups" : "pre-verify") : "implementation"} ${
      item.runsInWorktree ? "on its own branch" : "on main"
    }`,
  ];
  const ahead = index > 0 ? queue.items[index - 1].displayId : queue.running?.displayId;
  parts.push(ahead ? `starts after ${ahead}` : "starts next");
  if (!queue.armed) parts.push("queue paused");
  return parts.join(" · ");
}

/**
 * The same line, live. Mount it only where it is seen (a tooltip's content):
 * it reads the whole snapshot, which the cards themselves must not.
 */
export function QueuePlaceText({ cardId }: { cardId: string }) {
  const queue = useKanbanStore((s) => s.queueState);
  return <>{queue ? describeQueuePlace(queue, cardId) : null}</>;
}

/**
 * A queued card's place, "1 · impl", in the violet the board uses for the
 * queue. The board card's footer, the Chains pills and matrix all draw this
 * one chip, so a queued card reads the same wherever it shows up. Renders
 * nothing when the card is not queued; the caller decides whether a running
 * card should hide it.
 */
export function QueueRankChip({
  cardId,
  size = "footer",
  className = "",
}: {
  cardId: string;
  size?: "footer" | "inline";
  className?: string;
}) {
  const { rank, kind, verifyScope } = useQueuePlace(cardId);
  if (rank === 0 || !kind) return null;
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span
          className={`inline-flex shrink-0 cursor-default items-center gap-1 rounded bg-violet-500/10 font-mono tabular-nums text-violet-600 dark:text-violet-400 ${
            size === "footer" ? "h-[22px] px-1.5 text-[10px]" : "px-1 text-[9.5px] leading-[14px]"
          } ${className}`}
        >
          <ListVideo className={size === "footer" ? "h-3 w-3" : "h-2.5 w-2.5"} />
          {rank} · {queueKindLabel(kind, verifyScope)}
        </span>
      </TooltipTrigger>
      <TooltipContent side="top">
        <QueuePlaceText cardId={cardId} />
      </TooltipContent>
    </Tooltip>
  );
}

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
export function RunQueueChip({
  trigger,
  align = "start",
}: {
  /**
   * Draws the button that opens the popover, for surfaces other than the
   * column header (Focus, Chains). It must render one element that takes a
   * ref, a <button>. Left out, the header's icon-and-count chip is drawn.
   */
  trigger?: (state: { count: number; paused: boolean }) => ReactNode;
  align?: "start" | "end";
} = {}) {
  const queue = useKanbanStore((s) => s.queueState);
  const cards = useKanbanStore((s) => s.cards);
  const selectCard = useKanbanStore((s) => s.selectCard);
  const openModal = useKanbanStore((s) => s.openModal);
  const moveInQueue = useKanbanStore((s) => s.moveInQueue);
  const removeFromQueue = useKanbanStore((s) => s.removeFromQueue);
  const setQueuedCardWorktree = useKanbanStore((s) => s.setQueuedCardWorktree);
  const setQueueRunning = useKanbanStore((s) => s.setQueueRunning);
  const clearQueue = useKanbanStore((s) => s.clearQueue);
  const restoreQueue = useKanbanStore((s) => s.restoreQueue);
  const [open, setOpen] = useState(false);

  if (!queue || queue.items.length === 0) return null;
  const paused = !queue.armed;

  // No confirm dialog: one opened over this popover fights it for focus and
  // outside clicks. Clear acts at once and the toast's Undo puts every card
  // back where it was. The popover closes with it — an empty queue draws no
  // chip to hang it on.
  const handleClear = async () => {
    const result = await clearQueue();
    if (!result || result.cleared.length === 0) return;
    setOpen(false);
    const { cleared, wasArmed, running } = result;
    toast({
      title:
        cleared.length === 1 ? `Cleared ${cleared[0].displayId} from the queue` : `Cleared ${cleared.length} cards from the queue`,
      description: running ? `${running.displayId} keeps running.` : undefined,
      // Longer than the default 5s: Undo is the only guard against a misclick.
      duration: 10000,
      action: (
        <ToastAction
          altText="Undo clearing the queue"
          onClick={() => restoreQueue(cleared.map((c) => c.cardId), wasArmed)}
        >
          Undo
        </ToastAction>
      ),
    });
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        {trigger ? (
          trigger({ count: queue.items.length, paused })
        ) : (
          // Icon and count only: the header already holds the title, the WIP
          // counter and the add button, and a worded chip truncated "In
          // Progress" to "In Pr…". The tooltip says the rest.
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
        )}
      </PopoverTrigger>
      <PopoverContent align={align} className="w-80 p-1.5">
        <div className="px-1.5 pb-1.5 pt-0.5 text-[11px] text-muted-foreground">
          Run queue · starts when the run before it ends
        </div>
        <ol className="max-h-80 overflow-y-auto">
          {queue.items.map((item, index) => {
            // "After X" is a no-op when X already sits right in front.
            const anchors = queue.items.filter(
              (other, i) => other.cardId !== item.cardId && i !== index - 1
            );
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
                  className={`group/item flex min-w-0 flex-1 items-center gap-2 rounded px-1.5 py-1 text-left text-xs transition-colors hover:bg-accent hover:text-accent-foreground ${
                    index === 0 ? "bg-ink/[0.06]" : ""
                  }`}
                >
                  {/* Violet ties the row to the queued card's chip and dashed
                      border on the board; on hover it hands over to the accent. */}
                  <span className="w-4 shrink-0 text-right font-mono text-[10px] tabular-nums text-violet-600 dark:text-violet-400 group-hover/item:text-current">
                    {index + 1}
                  </span>
                  <span className="shrink-0 font-mono text-[10px] text-current">
                    {item.displayId}
                  </span>
                  <span className="min-w-0 flex-1 truncate">{item.title}</span>
                  {item.kind === "verify" && (
                    <span
                      title="Pre-verify: walks the core flow of its Human Test checklist"
                      className="shrink-0 rounded bg-violet-500/10 px-1 font-mono text-[10px] text-violet-600 dark:text-violet-400 group-hover/item:bg-accent-foreground/15 group-hover/item:text-current"
                    >
                      verify
                    </span>
                  )}
                  {/* Isolated branch is the usual case; only the exception
                      gets a mark, so a plain row stays plain. */}
                  {!item.runsInWorktree && (
                    <span
                      title={
                        item.kind === "verify"
                          ? "Tested in the project folder: the card has no active worktree"
                          : "Runs on the current branch, without a worktree"
                      }
                      className="shrink-0 rounded bg-violet-500/10 px-1 font-mono text-[10px] text-violet-600 dark:text-violet-400 group-hover/item:bg-accent-foreground/15 group-hover/item:text-current"
                    >
                      main
                    </span>
                  )}
                  {item.overlaps.length > 0 && (
                    <OverlapMark
                      overlaps={item.overlaps}
                      titleOf={(id) => cards.find((c) => c.id === id)?.title}
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
          {/* A single card has Remove in its row; Clear earns its place from two. */}
          {queue.items.length > 1 && (
            <button
              type="button"
              onClick={handleClear}
              title="Take every waiting card out of the queue. A run already going keeps going."
              className="shrink-0 rounded px-1.5 py-0.5 text-[11px] text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
            >
              Clear
            </button>
          )}
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

/**
 * A queued implementation whose plan names files that code-writing work
 * ahead of it also changes. The queue still starts it; the mark is there so
 * the merge conflict waiting at Human Test is no surprise. The tooltip says
 * what that means in words, then which card and which files.
 */
function OverlapMark({
  overlaps,
  titleOf,
}: {
  overlaps: QueueOverlap[];
  titleOf: (cardId: string) => string | undefined;
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span
          aria-label="May conflict with work ahead of it"
          className="-m-1 inline-flex shrink-0 p-1 text-amber-600 dark:text-amber-400 group-hover/item:text-current"
        >
          <GitMerge className="h-3 w-3" />
        </span>
      </TooltipTrigger>
      <TooltipContent side="right" align="start" className="max-w-72 space-y-1.5">
        <div className="font-medium">May conflict when merged</div>
        <p className="text-muted-foreground">
          Work ahead of it changes the same files, so one of the two will need a hand
          merge. The queue still starts it.
        </p>
        {overlaps.map((overlap) => {
          const title = titleOf(overlap.cardId);
          return (
            <div key={overlap.cardId} className="min-w-0">
              <div className="truncate">
                <span className="font-mono text-[10px]">{overlap.displayId}</span>
                {title && <span className="text-muted-foreground"> · {title}</span>}
              </div>
              <ul className="mt-0.5 space-y-0.5">
                {overlap.files.map((file) => (
                  <li key={file} className="truncate pl-2 font-mono text-[10px] text-muted-foreground">
                    {file}
                  </li>
                ))}
              </ul>
            </div>
          );
        })}
      </TooltipContent>
    </Tooltip>
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
        {/* A pre-verify has no branch to pick: it runs where the card was
            implemented. */}
        {item.kind !== "verify" && (
          <>
            <DropdownMenuItem className="text-xs" onSelect={onToggleWorktree}>
              {item.runsInWorktree ? "Run on current branch" : "Run on isolated branch"}
            </DropdownMenuItem>
            <DropdownMenuSeparator />
          </>
        )}
        <DropdownMenuItem className="text-xs" onSelect={onRemove}>
          Remove
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
