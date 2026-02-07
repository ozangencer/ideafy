import { Complexity, Priority, Status } from "./types";

export interface QuickEntryResult {
  title: string;
  projectMatch: string | null;
  priority: Priority;
  status: Status;
  complexity: Complexity;
}

const STATUS_MAP: Record<string, Status> = {
  "/idea": "ideation",
  "/ideation": "ideation",
  "/backlog": "backlog",
  "/bug": "bugs",
  "/bugs": "bugs",
  "/progress": "progress",
  "/test": "test",
};

const COMPLEXITY_MAP: Record<string, Complexity> = {
  "c:low": "low",
  "c:medium": "medium",
  "c:high": "high",
};

export function parseQuickEntry(input: string): QuickEntryResult {
  let remaining = input;
  let projectMatch: string | null = null;
  let priority: Priority = "medium";
  let status: Status = "backlog";
  let complexity: Complexity = "medium";

  // Extract @ProjectName (word characters, hyphens, dots)
  const projectRegex = /@([\w\-.]+)/;
  const projectHit = remaining.match(projectRegex);
  if (projectHit) {
    projectMatch = projectHit[1];
    remaining = remaining.replace(projectHit[0], "");
  }

  // Extract priority: !! before ! to avoid partial match
  if (/(?<!\S)!!(?!\S|!)/.test(remaining)) {
    priority = "high";
    remaining = remaining.replace(/(?<!\S)!!(?!\S|!)/, "");
  } else if (/(?<!\S)!(?!\S|!)/.test(remaining)) {
    priority = "medium";
    // medium is default, but still strip the token
    remaining = remaining.replace(/(?<!\S)!(?!\S|!)/, "");
  }

  // Extract /status tokens
  for (const [token, statusValue] of Object.entries(STATUS_MAP)) {
    const regex = new RegExp(`(?<=\\s|^)${token.replace("/", "\\/")}(?=\\s|$)`);
    if (regex.test(remaining)) {
      status = statusValue;
      remaining = remaining.replace(regex, "");
      break;
    }
  }

  // Extract c:complexity tokens
  for (const [token, complexityValue] of Object.entries(COMPLEXITY_MAP)) {
    const regex = new RegExp(`(?<=\\s|^)${token.replace(":", "\\:")}(?=\\s|$)`);
    if (regex.test(remaining)) {
      complexity = complexityValue;
      remaining = remaining.replace(regex, "");
      break;
    }
  }

  // Clean up remaining text: collapse spaces, trim
  const title = remaining.replace(/\s+/g, " ").trim();

  return { title, projectMatch, priority, status, complexity };
}
