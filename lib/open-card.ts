"use client";

import { toast } from "@/hooks/use-toast";
import { useKanbanStore } from "@/lib/store";
import type { SectionType } from "@/lib/types";

/**
 * Opens a card's modal on the given section — the jump the activity bell and
 * the OS banner both make. Returns false (after a "Card not found" toast) when
 * the card is no longer on the board.
 */
export function openCardById(cardId: string, section: SectionType | null): boolean {
  const { cards, selectCard, openModal, setPendingCardSection } = useKanbanStore.getState();
  const card = cards.find((c) => c.id === cardId);
  if (!card) {
    toast({
      title: "Card not found",
      description: "This card was deleted. The activity entry stays for history.",
      variant: "destructive",
    });
    return false;
  }
  if (section) setPendingCardSection(section);
  selectCard(card);
  openModal();
  return true;
}
