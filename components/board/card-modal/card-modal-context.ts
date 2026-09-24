"use client";

import { createContext, useContext } from "react";
import type { Dispatch, ReactNode, SetStateAction } from "react";
import type {
  AiPlatform,
  Card,
  Complexity,
  Priority,
  Project,
  SectionType,
  Status,
} from "@/lib/types";

type SaveStatus = "idle" | "saving" | "saved";

export interface CardModalContextValue {
  // Selected card + project metadata
  selectedCard: Card;
  projects: Project[];
  project: Project | undefined;
  displayId: string | null;
  isDraftMode: boolean;

  // Form state (read + write)
  title: string;
  setTitle: Dispatch<SetStateAction<string>>;
  description: string;
  setDescription: Dispatch<SetStateAction<string>>;
  solutionSummary: string;
  setSolutionSummary: Dispatch<SetStateAction<string>>;
  testScenarios: string;
  setTestScenarios: Dispatch<SetStateAction<string>>;
  aiOpinion: string;
  setAiOpinion: Dispatch<SetStateAction<string>>;
  status: Status;
  setStatus: Dispatch<SetStateAction<Status>>;
  complexity: Complexity;
  setComplexity: Dispatch<SetStateAction<Complexity>>;
  priority: Priority;
  setPriority: Dispatch<SetStateAction<Priority>>;
  projectId: string | null;
  setProjectId: Dispatch<SetStateAction<string | null>>;
  /** card_groups.id — the chain this card belongs to, or null. */
  groupId: string | null;
  setGroupId: Dispatch<SetStateAction<string | null>>;
  aiPlatform: AiPlatform | null;
  setAiPlatform: Dispatch<SetStateAction<AiPlatform | null>>;

  // Derived
  isTitleValid: boolean;
  canSave: boolean;

  // Navigation history — each entry remembers the tab the user was on when
  // they clicked through, so Back can restore both card AND section.
  cardHistory: Array<{ cardId: string; activeTab: SectionType }>;

  // Modal UI state
  isExpanded: boolean;
  setIsExpanded: Dispatch<SetStateAction<boolean>>;
  /** True for a read-only modal and while a run or terminal session holds the card. */
  readOnly: boolean;
  /** A run or terminal session holds the card; the form is read-only until it ends. */
  isRunLocked: boolean;
  /**
   * The card's next-phase buttons, ready to place. The default footer puts
   * them on its right; a replacement footerSlot should do the same, or the
   * buttons disappear from that build. Null for drafts and withdrawn cards.
   */
  phaseActions: ReactNode;

  // Auto-save
  saveStatus: SaveStatus;

  // Handlers
  handleBack: () => void;
  handleExport: () => void;
  handleClose: () => void;
  handleDelete: () => void;
  handleWithdraw: () => void;
  handleSave: () => void;
}

export const CardModalContext = createContext<CardModalContextValue | null>(null);

/**
 * Access CardModal's internal form + handler state. Must be called from a
 * component rendered inside `<CardModal>`. Returns `null` if called outside —
 * slot components should guard for SSR/testing.
 */
export function useCardModalContext(): CardModalContextValue {
  const ctx = useContext(CardModalContext);
  if (!ctx) {
    throw new Error(
      "useCardModalContext must be used within a <CardModal>. Slot components must be rendered via headerSlot/footerSlot."
    );
  }
  return ctx;
}
