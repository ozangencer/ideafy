import type { Card, SectionType, Status } from "./types";

// Which tab a card opens on, by column. A card's column says what you came to
// look at: the plan while it's being built, the checklist while it's tested.
const STATUS_INITIAL_TAB: Record<Status, SectionType> = {
  ideation: "detail",
  backlog: "detail",
  bugs: "detail",
  progress: "solution",
  test: "tests",
  completed: "detail",
  withdrawn: "detail",
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

// An empty target tab falls back to Detail rather than opening a blank
// editor. Human Test is the exception: it has always opened on Tests, even
// before the checklist is written.
export function getInitialTabForCard(card: Card): SectionType {
  const target = STATUS_INITIAL_TAB[card.status] ?? "detail";
  if (target === "detail" || card.status === "test") return target;
  return hasContent(sectionValue(card, target)) ? target : "detail";
}
