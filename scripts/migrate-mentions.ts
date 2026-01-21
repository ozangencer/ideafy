import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { eq } from "drizzle-orm";
import path from "path";
import * as schema from "../lib/db/schema";

const dbPath = path.join(process.cwd(), "data", "kanban.db");
const sqlite = new Database(dbPath);
const db = drizzle(sqlite, { schema });

/**
 * Converts old skill/mcp mentions to unified mentions
 *
 * Old formats:
 * - skillMention: <span data-type="skillMention" data-id="..." data-label="...">/label</span>
 * - mcpMention: <span data-type="mcpMention" data-id="..." data-label="...">@label</span>
 *
 * New format:
 * - unifiedMention: <span data-type="unifiedMention" data-id="..." data-label="..." data-item-type="skill|mcp|plugin">/label</span>
 */
function convertMentions(html: string): string {
  if (!html) return html;

  let result = html;

  // Convert skillMention to unifiedMention with itemType="skill"
  result = result.replace(
    /<span\s+data-type="skillMention"([^>]*)>([^<]*)<\/span>/g,
    (match, attrs, content) => {
      // Extract existing attributes
      const idMatch = attrs.match(/data-id="([^"]*)"/);
      const labelMatch = attrs.match(/data-label="([^"]*)"/);

      const id = idMatch ? idMatch[1] : "";
      const label = labelMatch ? labelMatch[1] : "";

      return `<span data-type="unifiedMention" data-id="${id}" data-label="${label}" data-item-type="skill" class="mention unified-mention unified-mention--skill">/${label}</span>`;
    }
  );

  // Convert mcpMention to unifiedMention with itemType="mcp"
  result = result.replace(
    /<span\s+data-type="mcpMention"([^>]*)>([^<]*)<\/span>/g,
    (match, attrs, content) => {
      // Extract existing attributes
      const idMatch = attrs.match(/data-id="([^"]*)"/);
      const labelMatch = attrs.match(/data-label="([^"]*)"/);

      const id = idMatch ? idMatch[1] : "";
      const label = labelMatch ? labelMatch[1] : "";

      // Note: MCPs now also use / prefix instead of @
      return `<span data-type="unifiedMention" data-id="${id}" data-label="${label}" data-item-type="mcp" class="mention unified-mention unified-mention--mcp">/${label}</span>`;
    }
  );

  return result;
}

async function migrateMentions() {
  console.log("Starting mention migration...");

  // Get all cards
  const allCards = db.select().from(schema.cards).all();
  console.log(`Found ${allCards.length} cards`);

  let updatedCount = 0;

  for (const card of allCards) {
    const updates: Partial<typeof card> = {};
    let hasChanges = false;

    // Check and convert description
    if (card.description && (card.description.includes('skillMention') || card.description.includes('mcpMention'))) {
      updates.description = convertMentions(card.description);
      hasChanges = true;
    }

    // Check and convert solutionSummary
    if (card.solutionSummary && (card.solutionSummary.includes('skillMention') || card.solutionSummary.includes('mcpMention'))) {
      updates.solutionSummary = convertMentions(card.solutionSummary);
      hasChanges = true;
    }

    // Check and convert testScenarios
    if (card.testScenarios && (card.testScenarios.includes('skillMention') || card.testScenarios.includes('mcpMention'))) {
      updates.testScenarios = convertMentions(card.testScenarios);
      hasChanges = true;
    }

    // Check and convert aiOpinion
    if (card.aiOpinion && (card.aiOpinion.includes('skillMention') || card.aiOpinion.includes('mcpMention'))) {
      updates.aiOpinion = convertMentions(card.aiOpinion);
      hasChanges = true;
    }

    if (hasChanges) {
      console.log(`Updating card: ${card.title}`);
      db.update(schema.cards)
        .set(updates)
        .where(eq(schema.cards.id, card.id))
        .run();
      updatedCount++;
    }
  }

  // Also migrate conversations
  const allConversations = db.select().from(schema.conversations).all();
  console.log(`Found ${allConversations.length} conversations`);

  let conversationUpdatedCount = 0;

  for (const conv of allConversations) {
    let hasChanges = false;
    const updates: Partial<typeof conv> = {};

    // Check and convert content
    if (conv.content && (conv.content.includes('skillMention') || conv.content.includes('mcpMention'))) {
      updates.content = convertMentions(conv.content);
      hasChanges = true;
    }

    // Check and convert mentions JSON
    if (conv.mentions) {
      try {
        const mentions = JSON.parse(conv.mentions);
        let mentionsChanged = false;

        for (const mention of mentions) {
          // Already using new format
          if (mention.type === 'plugin') continue;

          // No changes needed for card/document mentions
          if (mention.type === 'card' || mention.type === 'document') continue;
        }

        if (mentionsChanged) {
          updates.mentions = JSON.stringify(mentions);
          hasChanges = true;
        }
      } catch (e) {
        // Invalid JSON, skip
      }
    }

    if (hasChanges) {
      console.log(`Updating conversation: ${conv.id}`);
      db.update(schema.conversations)
        .set(updates)
        .where(eq(schema.conversations.id, conv.id))
        .run();
      conversationUpdatedCount++;
    }
  }

  console.log(`\nMigration completed!`);
  console.log(`- Updated ${updatedCount} cards`);
  console.log(`- Updated ${conversationUpdatedCount} conversations`);
}

migrateMentions().catch(console.error);
