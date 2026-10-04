import type { Card, SectionType, Status } from "./types";

// Which tab a card opens on, by column: the newest filled content of that
// stage. Each column lists its tabs newest first and the card opens on the
// first one with content — a planned Backlog card on its plan, an evaluated
// one on the opinion. Detail is always the last resort, so it isn't listed.
const STATUS_INITIAL_TABS: Record<Status, SectionType[]> = {
  ideation: ["opinion"],
  backlog: ["solution", "opinion"],
  bugs: [],
  progress: ["solution"],
  test: ["tests"],
  completed: [],
  withdrawn: [],
};

// Check if HTML content has meaningful text
export function hasContent(html: string): boolean {
  if (!html) return false;
  // Strip HTML tags and check if there's actual text
  const text = html.replace(/<[^>]*>/g, "").trim();
  return text.length > 0;
}

function sectionValue(card: Card, section: SectionType): string {
  switch (section) {
    case "detail":
      return card.description;
    case "opinion":
      return card.aiOpinion;
    case "solution":
      return card.solutionSummary;
    case "tests":
      return card.testScenarios;
  }
}

// Empty tabs fall back to Detail rather than opening a blank editor. Human
// Test is the exception: it has always opened on Tests, even before the
// checklist is written.
export function getInitialTabForCard(card: Card): SectionType {
  if (card.status === "test") return "tests";
  const tabs = STATUS_INITIAL_TABS[card.status] ?? [];
  return tabs.find((tab) => hasContent(sectionValue(card, tab))) ?? "detail";
}
