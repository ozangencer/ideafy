import { Card, Project, getColumnTitle, getDisplayId, Status, COMPLEXITY_OPTIONS, PRIORITY_OPTIONS } from "./types";
import { htmlToMarkdown } from "./html-to-markdown";

/**
 * Format a date string for display
 */
function formatDate(dateString: string): string {
  if (!dateString) return "";
  const date = new Date(dateString);
  return date.toISOString().split("T")[0]; // YYYY-MM-DD format
}

/**
 * Get complexity label
 */
function getComplexityLabel(complexity: string): string {
  const opt = COMPLEXITY_OPTIONS.find((o) => o.value === complexity);
  return opt?.label || "Medium";
}

/**
 * Get priority label
 */
function getPriorityLabel(priority: string): string {
  const opt = PRIORITY_OPTIONS.find((o) => o.value === priority);
  return opt?.label || "Medium";
}

/**
 * Create a URL-friendly slug from a title
 */
function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "")
    .slice(0, 50);
}

/**
 * Convert a card to Markdown format
 */
export function cardToMarkdown(card: Card, project?: Project): string {
  const displayId = getDisplayId(card, project);
  const titleWithId = displayId ? `[${displayId}] ${card.title}` : card.title;

  const lines: string[] = [];

  // Title
  lines.push(`# ${titleWithId}`);
  lines.push("");

  // Metadata line
  const statusTitle = getColumnTitle(card.status as Status, project?.mode);
  const priorityLabel = getPriorityLabel(card.priority);
  const complexityLabel = getComplexityLabel(card.complexity);

  lines.push(`**Status:** ${statusTitle} | **Priority:** ${priorityLabel} | **Complexity:** ${complexityLabel}`);

  // Dates
  const createdDate = formatDate(card.createdAt);
  const updatedDate = formatDate(card.updatedAt);
  lines.push(`**Created:** ${createdDate} | **Updated:** ${updatedDate}`);

  // Project info if available
  if (project) {
    lines.push(`**Project:** ${project.name} (${project.idPrefix})`);
  }

  lines.push("");
  lines.push("---");
  lines.push("");

  // Description
  if (card.description) {
    lines.push("## Description");
    lines.push("");
    lines.push(htmlToMarkdown(card.description));
    lines.push("");
  }

  // AI Opinion
  if (card.aiOpinion) {
    lines.push("## AI Opinion");
    lines.push("");
    lines.push(htmlToMarkdown(card.aiOpinion));
    lines.push("");
  }

  // Solution Summary
  if (card.solutionSummary) {
    lines.push("## Solution Summary");
    lines.push("");
    lines.push(htmlToMarkdown(card.solutionSummary));
    lines.push("");
  }

  // Test Scenarios
  if (card.testScenarios) {
    lines.push("## Test Scenarios");
    lines.push("");
    lines.push(htmlToMarkdown(card.testScenarios));
    lines.push("");
  }

  return lines.join("\n");
}

/**
 * Generate filename for markdown export
 */
export function getExportFilename(card: Card, project?: Project): string {
  const displayId = getDisplayId(card, project);
  const slug = slugify(card.title);

  if (displayId) {
    return `${displayId.toLowerCase()}-${slug}.md`;
  }
  return `${slug}.md`;
}

/**
 * Download a card as a Markdown file
 */
export function downloadCardAsMarkdown(card: Card, project?: Project): void {
  const markdown = cardToMarkdown(card, project);
  const filename = getExportFilename(card, project);

  // Create blob and download
  const blob = new Blob([markdown], { type: "text/markdown;charset=utf-8" });
  const url = URL.createObjectURL(blob);

  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);

  // Clean up the URL object
  URL.revokeObjectURL(url);
}
