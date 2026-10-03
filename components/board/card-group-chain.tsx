"use client";

import { useState } from "react";
import { ListOrdered, MoreHorizontal } from "lucide-react";
import { Card, getColumnTitle, getDisplayId, Project, STATUS_COLORS } from "@/lib/types";
import { CardGroupSummary, isFinished } from "@/lib/card-group";
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
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

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
 *
 * It is also where the order gets corrected. Each row has a "⋯" menu with
 * "Move to start" and "Move after…" — no drag handles and no position
 * numbers, because the order is a relation between cards ("after IDE-331"),
 * not a slot anyone should have to count to.
 */
export function CardGroupChain({ summary }: { summary: CardGroupSummary }) {
  const projects = useKanbanStore((s) => s.projects);
  const activeWorkspace = useKanbanStore((s) => s.activeWorkspace);
  const selectCard = useKanbanStore((s) => s.selectCard);
  const openModal = useKanbanStore((s) => s.openModal);
  const placeCardInChain = useKanbanStore((s) => s.placeCardInChain);
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
            // "After X" is a no-op when X already sits right in front.
            const anchors = members.filter(
              (member, i) => member.id !== card.id && i !== index - 1
            );
            return (
              <li key={card.id} className="group/row flex items-center gap-0.5">
                <button
                  type="button"
                  onClick={() => {
                    setOpen(false);
                    selectCard(card);
                    openModal();
                  }}
                  className={`flex min-w-0 flex-1 items-center gap-2 rounded px-1.5 py-1 text-left text-xs transition-colors hover:bg-accent hover:text-accent-foreground ${
                    isNext ? "bg-ink/[0.06]" : ""
                  } ${finished ? "opacity-50" : ""}`}
                >
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
                {(index > 0 || anchors.length > 0) && (
                  <ChainRowMenu
                    card={card}
                    project={project}
                    canMoveToStart={index > 0}
                    anchors={anchors}
                    projects={projects}
                    onPlace={(afterCardId) =>
                      placeCardInChain(group.id, card.id, afterCardId)
                    }
                  />
                )}
              </li>
            );
          })}
        </ol>
        <div className="border-t border-dashed border-ink/15 px-1.5 pt-1.5 mt-1 text-[10px] text-muted-foreground">
          Chain order: manual position first, then card number. Next is the
          first card that isn&apos;t completed or withdrawn.
        </div>
      </PopoverContent>
    </Popover>
  );
}

/**
 * The "⋯" reorder menu for one chain member. Shared with the Chains view's
 * matrix so the order has a single write path, `placeCardInChain`. Its row
 * has to carry `group/row` — the trigger only shows on that row's hover.
 */
export function ChainRowMenu({
  card,
  project,
  canMoveToStart,
  anchors,
  projects,
  onPlace,
}: {
  card: Card;
  project: Project | undefined;
  canMoveToStart: boolean;
  anchors: Card[];
  projects: Project[];
  onPlace: (afterCardId: string | null) => void;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          aria-label={`Reorder ${getDisplayId(card, project)}`}
          onClick={(event) => event.stopPropagation()}
          className="shrink-0 rounded p-0.5 text-muted-foreground opacity-0 transition-opacity hover:bg-accent hover:text-accent-foreground focus-visible:opacity-100 group-hover/row:opacity-100 data-[state=open]:opacity-100"
        >
          <MoreHorizontal className="h-3.5 w-3.5" />
        </button>
      </DropdownMenuTrigger>
      {/* The chain popover sits at z-[70]; the default z-50 would open this
          menu underneath it, where a click on "⋯" looks like it did nothing.
          Harmless in the Chains matrix, which sits in page flow. */}
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
                  key={anchor.id}
                  className="text-xs"
                  onSelect={() => onPlace(anchor.id)}
                >
                  <span className="shrink-0 font-mono text-[10px] text-current opacity-70">
                    {getDisplayId(anchor, projects.find((p) => p.id === anchor.projectId))}
                  </span>
                  <span className="min-w-0 flex-1 truncate">{anchor.title}</span>
                </DropdownMenuItem>
              ))}
            </DropdownMenuSubContent>
          </DropdownMenuSub>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
