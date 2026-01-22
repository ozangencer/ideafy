import TurndownService from "turndown";
import { gfm } from "turndown-plugin-gfm";

// Create a configured Turndown instance
function createTurndownService(): TurndownService {
  const turndownService = new TurndownService({
    headingStyle: "atx",
    bulletListMarker: "-",
    codeBlockStyle: "fenced",
    emDelimiter: "_",
    strongDelimiter: "**",
    linkStyle: "inlined",
  });

  // Use GFM plugin for tables, strikethrough, etc.
  turndownService.use(gfm);

  // Handle task lists (checkboxes)
  turndownService.addRule("taskListItems", {
    filter: function (node) {
      return (
        node.nodeName === "LI" &&
        node.getAttribute("data-type") === "taskItem"
      );
    },
    replacement: function (content, node) {
      const element = node as HTMLElement;
      const isChecked = element.getAttribute("data-checked") === "true";
      const checkbox = isChecked ? "[x]" : "[ ]";
      // Clean up content - remove leading/trailing whitespace
      const cleanContent = content.replace(/^\s+|\s+$/g, "");
      return `- ${checkbox} ${cleanContent}\n`;
    },
  });

  // Handle task list containers
  turndownService.addRule("taskList", {
    filter: function (node) {
      return (
        node.nodeName === "UL" &&
        node.getAttribute("data-type") === "taskList"
      );
    },
    replacement: function (content) {
      return content;
    },
  });

  // Handle paragraphs inside list items better
  turndownService.addRule("paragraphInListItem", {
    filter: function (node, options) {
      return (
        node.nodeName === "P" &&
        node.parentNode !== null &&
        node.parentNode.nodeName === "LI"
      );
    },
    replacement: function (content) {
      return content;
    },
  });

  return turndownService;
}

// Singleton instance
let turndownInstance: TurndownService | null = null;

function getTurndownService(): TurndownService {
  if (!turndownInstance) {
    turndownInstance = createTurndownService();
  }
  return turndownInstance;
}

/**
 * Convert HTML content to Markdown
 * Handles Tiptap's task lists, basic formatting, links, etc.
 */
export function htmlToMarkdown(html: string): string {
  if (!html || html.trim() === "") {
    return "";
  }

  const turndown = getTurndownService();

  try {
    let markdown = turndown.turndown(html);

    // Clean up excessive newlines
    markdown = markdown.replace(/\n{3,}/g, "\n\n");

    // Trim trailing whitespace
    markdown = markdown.trim();

    return markdown;
  } catch (error) {
    console.error("Error converting HTML to Markdown:", error);
    // Fallback: strip HTML tags
    return html.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
  }
}
