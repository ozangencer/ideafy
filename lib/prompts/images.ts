import { writeFileSync, mkdirSync, existsSync } from "fs";
import { join } from "path";
import { tmpdir, homedir } from "os";

export interface SavedImage {
  id: string;
  path: string;
  fieldName: string;
}

/**
 * Per-card persistent directory for chat attachments. `tmpdir()` is
 * periodically cleaned up by macOS and is scoped to a single Next.js dev
 * run — both break resumed chat sessions that reference old image paths
 * in their conversation history.
 */
export function getCardImageDir(cardId: string): string {
  const dir = join(homedir(), ".ideafy", "images", cardId);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
  return dir;
}

/**
 * Save embedded base64 images from card HTML fields to temp files.
 * Returns an array of saved image metadata that prompts can reference.
 */
export function saveCardImagesToTemp(
  cardId: string,
  card: { description: string; solutionSummary?: string | null; testScenarios?: string | null },
): SavedImage[] {
  const savedImages: SavedImage[] = [];
  const timestamp = Date.now();

  const imgRegex = /<img[^>]*src=["']data:(image\/[^;]+);base64,([^"']+)["'][^>]*>/gi;

  const fields = [
    { name: "description", value: card.description },
    { name: "solutionSummary", value: card.solutionSummary },
    { name: "testScenarios", value: card.testScenarios },
  ];

  for (const field of fields) {
    if (!field.value) continue;

    let match;
    let index = 0;
    while ((match = imgRegex.exec(field.value)) !== null) {
      const mimeType = match[1];
      const base64Data = match[2];
      const ext = mimeType.split("/")[1] || "png";

      const filename = `kanban-${cardId.slice(0, 8)}-${field.name}-${index}-${timestamp}.${ext}`;
      const filepath = join(tmpdir(), filename);

      const buffer = Buffer.from(base64Data, "base64");
      writeFileSync(filepath, buffer);

      savedImages.push({ id: `${field.name}_image_${index}`, path: filepath, fieldName: field.name });
      index++;
    }
    imgRegex.lastIndex = 0; // reset regex state between fields
  }

  return savedImages;
}

/**
 * Extract base64 images from a conversation message content string, save
 * them to temp files, and return the content with images replaced by file
 * path references. Reduces token usage when chat history is pasted into
 * prompts.
 */
export function extractConversationImages(
  content: string,
  cardId: string,
  messageIndex: number,
): { cleanContent: string; savedImages: SavedImage[] } {
  const savedImages: SavedImage[] = [];
  const timestamp = Date.now();
  const imgRegex = /<img[^>]*src=["']data:(image\/[^;]+);base64,([^"']+)["'][^>]*>/gi;

  let index = 0;
  const imageDir = getCardImageDir(cardId);
  const cleanContent = content.replace(imgRegex, (_match, mimeType: string, base64Data: string) => {
    const ext = mimeType.split("/")[1] || "png";
    const filename = `chat-${messageIndex}-${index}-${timestamp}.${ext}`;
    const filepath = join(imageDir, filename);

    const buffer = Buffer.from(base64Data, "base64");
    writeFileSync(filepath, buffer);

    const imgId = `chat_image_${messageIndex}_${index}`;
    savedImages.push({ id: imgId, path: filepath, fieldName: "conversation" });
    index++;

    return `[Image: see ${filepath}]`;
  });

  return { cleanContent, savedImages };
}

/**
 * Generate a markdown reference section for saved images.
 * Tells Claude to use the Read tool to view them.
 */
export function generateImageReferences(images: SavedImage[]): string {
  if (images.length === 0) return "";

  return [
    "## Attached Images",
    "",
    ...images.map((img) => `- **${img.id}** (${img.fieldName}): Read file at \`${img.path}\``),
    "",
    "Use the Read tool to view these images for visual context.",
    "",
  ].join("\n");
}
