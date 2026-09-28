"use client";

import { useState } from "react";
import { ListOrdered } from "lucide-react";
import { getColumnTitle, getDisplayId, STATUS_COLORS } from "@/lib/types";
import { CardGroupSummary, isFinished } from "@/lib/card-group";
import { useKanbanStore } from "@/lib/store";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";

/**
 * The whole chain, board-wide, in the order "next" is picked from.
 *
 * The group row only opens the members that sit in its own column, so a
 * ten-card chain spread over four columns showed a quarter of itself and left
 * the rest to a board scan — which is where "why is that one next?" had no
 * answer. This is the answer, one click from the row that raises the question.
 *
 * A popover rather than a hover card: there is no hover-card primitive here,
 * and a list you click through to open cards wants a surface that stays put.
 */
export function CardGroupChain({ summary }: { summary: CardGroupSummary }) {
  const projects = useKanbanStore((s) => s.projects);
  const activeWorkspace = useKanbanStore((s) => s.activeWorkspace);
  const selectCard = useKanbanStore((s) => s.selectCard);
  const openModal = useKanbanStore((s) => s.openModal);
  const [open, setOpen] = useState(false);

  const { group, members, nextCard } = summary;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label={`Show ${group.code} chain order`}
          className="inline-flex items-center gap-0.5 underline decoration-dotted underline-offset-2 transition-colors hover:text-foreground"
        >
          <ListOrdered className="h-2.5 w-2.5" />
          chain
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-80 p-1.5">
        <div className="px-1.5 pb-1.5 pt-0.5 text-[11px] text-muted-foreground">
          {group.name} · chain order
        </div>
        <ol className="max-h-80 overflow-y-auto">
          {members.map((card, index) => {
            const project = projects.find((p) => p.id === card.projectId);
            const isNext = nextCard?.id === card.id;
            const finished = isFinished(card);
            return (
              <li key={card.id}>
                <button
                  type="button"
                  onClick={() => {
                    setOpen(false);
                    selectCard(card);
                    openModal();
                  }}
                  className={`flex w-full items-center gap-2 rounded px-1.5 py-1 text-left text-xs transition-colors hover:bg-accent hover:text-accent-foreground ${
                    isNext ? "bg-ink/[0.06]" : ""
                  } ${finished ? "opacity-50" : ""}`}
                >
                  <span className="w-4 shrink-0 text-right font-mono text-[10px] tabular-nums text-current opacity-60">
                    {index + 1}
                  </span>
                  <span className="shrink-0 font-mono text-[10px] text-current">
                    {getDisplayId(card, project)}
                  </span>
                  <span className="min-w-0 flex-1 truncate">{card.title}</span>
                  {isNext && (
                    <span className="shrink-0 rounded bg-primary/15 px-1 font-mono text-[9px] uppercase text-current">
                      next
                    </span>
                  )}
                  <span className="flex shrink-0 items-center gap-1 text-[10px] text-current opacity-70">
                    <span className={`h-1.5 w-1.5 rounded-full ${STATUS_COLORS[card.status]}`} />
                    {getColumnTitle(card.status, activeWorkspace)}
                  </span>
                </button>
              </li>
            );
          })}
        </ol>
        <div className="border-t border-dashed border-ink/15 px-1.5 pt-1.5 mt-1 text-[10px] text-muted-foreground">
          Ordered by card number. Next is the first card that isn&apos;t
          completed or withdrawn.
        </div>
      </PopoverContent>
    </Popover>
  );
}
