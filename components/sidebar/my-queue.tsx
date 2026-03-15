"use client";

import { useState } from "react";
import { useKanbanStore } from "@/lib/store";
import { Button } from "@/components/ui/button";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { ChevronDown, ChevronRight, CloudDownload, Inbox } from "lucide-react";
import { toast } from "sonner";
import type { PoolCard } from "@/lib/team/types";
import { PoolCardSlideOver } from "@/components/board/pool-card-slide-over";

export function MyQueue() {
  const { currentUser, poolCards, pullFromPool, cards, teamMembers, selectCard, openModal } = useKanbanStore();
  const [isOpen, setIsOpen] = useState(true);
  const [pullingId, setPullingId] = useState<string | null>(null);
  const [selectedCard, setSelectedCard] = useState<PoolCard | null>(null);

  if (!currentUser) return null;

  const myCards = poolCards.filter((c) => c.assignedTo === currentUser.id);

  const handlePull = async (poolCardId: string) => {
    // Check if already pulled locally
    const alreadyPulled = cards.find((c) => c.poolCardId === poolCardId);
    if (alreadyPulled) {
      toast.info("Already pulled - card exists locally");
      return;
    }

    setPullingId(poolCardId);
    const result = await pullFromPool(poolCardId);
    setPullingId(null);

    if (result.error) {
      toast.error(result.error);
    } else {
      toast.success("Card pulled from pool");
    }
  };

  const getMemberName = (userId: string | undefined) => {
    if (!userId) return null;
    const member = teamMembers.find((m) => m.userId === userId);
    return member?.displayName || null;
  };

  const priorityColors: Record<string, string> = {
    high: "text-red-500",
    medium: "text-blue-500",
    low: "text-gray-400",
  };

  const statusColors: Record<string, string> = {
    ideation: "bg-status-ideation",
    backlog: "bg-status-backlog",
    bugs: "bg-status-bugs",
    progress: "bg-status-progress",
    test: "bg-status-test",
    completed: "bg-status-completed",
    withdrawn: "bg-status-withdrawn",
  };

  const priorityBgColors: Record<string, string> = {
    high: "text-red-500 bg-red-500/10",
    medium: "text-blue-500 bg-blue-500/10",
    low: "text-gray-400 bg-gray-500/10",
  };

  return (
    <>
      <Collapsible open={isOpen} onOpenChange={setIsOpen}>
        <CollapsibleTrigger className="flex items-center gap-2 px-4 py-2 w-full hover:bg-accent/50 transition-colors">
          {isOpen ? (
            <ChevronDown className="h-3 w-3 text-muted-foreground" />
          ) : (
            <ChevronRight className="h-3 w-3 text-muted-foreground" />
          )}
          <Inbox className="h-3.5 w-3.5 text-muted-foreground" />
          <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
            My Queue
          </span>
          {myCards.length > 0 && (
            <span className="ml-auto text-xs bg-primary/20 text-primary px-1.5 py-0.5 rounded-full font-mono">
              {myCards.length}
            </span>
          )}
        </CollapsibleTrigger>
        <CollapsibleContent>
          <div className="px-2 pb-2">
            {myCards.length === 0 ? (
              <p className="text-xs text-muted-foreground px-2 py-1">
                No tasks assigned
              </p>
            ) : (
              myCards.map((card) => {
                const localCard = cards.find((c) => c.poolCardId === card.id);
                const handleClick = () => {
                  if (localCard) {
                    // Already pulled → open local card modal
                    selectCard(localCard);
                    openModal();
                  } else {
                    // Not pulled → show pool slide-over
                    setSelectedCard(card);
                  }
                };
                return (
                  <div
                    key={card.id}
                    className="flex items-center gap-2 px-2 py-1.5 rounded hover:bg-accent/50 group cursor-pointer"
                    onClick={handleClick}
                  >
                    <span className={`text-[10px] ${priorityColors[card.priority] || ""}`}>
                      {card.priority === "high" ? "!!!" : card.priority === "medium" ? "!!" : "!"}
                    </span>
                    <span className="text-xs truncate flex-1" title={card.title}>
                      {card.title}
                    </span>
                    {card.pushedByName && (
                      <span className="text-[10px] text-muted-foreground shrink-0">
                        {card.pushedByName}
                      </span>
                    )}
                    {localCard ? (
                      <span className="text-[10px] text-green-500 shrink-0">pulled</span>
                    ) : (
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-5 w-5 shrink-0"
                        onClick={(e) => {
                          e.stopPropagation();
                          handlePull(card.id);
                        }}
                        disabled={pullingId === card.id}
                      >
                        <CloudDownload className="h-3 w-3" />
                      </Button>
                    )}
                  </div>
                );
              })
            )}
          </div>
        </CollapsibleContent>
      </Collapsible>

      {selectedCard && (
        <PoolCardSlideOver
          card={selectedCard}
          onClose={() => setSelectedCard(null)}
          getMemberName={getMemberName}
          statusColors={statusColors}
          priorityColors={priorityBgColors}
        />
      )}
    </>
  );
}
