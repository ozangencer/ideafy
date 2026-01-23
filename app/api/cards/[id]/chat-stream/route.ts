import { spawn } from "child_process";
import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { conversations, cards, projects } from "@/lib/db/schema";
import { eq, and, asc } from "drizzle-orm";
import { v4 as uuidv4 } from "uuid";
import { writeFileSync, mkdirSync, existsSync, readFileSync } from "fs";
import { join, dirname } from "path";
import { tmpdir } from "os";
import type { SectionType, ConversationMessage } from "@/lib/types";
import {
  registerProcess,
  unregisterProcess,
  getProcess,
  killProcess,
} from "@/lib/process-registry";
import { getClaudePath, getClaudeEnv } from "@/lib/claude-cli";

// Card context info
interface CardContext {
  uuid: string;
  displayId: string;
  title: string;
  projectName: string;
  sectionContent: string;
  narrativeContent?: string; // Product narrative for opinion context
}

// Build card context string
function buildCardContext(ctx: CardContext): string {
  return `
CURRENT CARD CONTEXT:
- Card ID: ${ctx.displayId}
- Card UUID: ${ctx.uuid}
- Title: "${ctx.title}"
- Project: ${ctx.projectName || "(none)"}

IMPORTANT: When updating this card, use the UUID "${ctx.uuid}" directly. Do NOT search for the card by display ID.
`;
}

// Section-specific system prompts
const SECTION_SYSTEM_PROMPTS: Record<SectionType, (ctx: CardContext) => string> = {
  detail: (ctx) => `You are helping improve a development task description.
${buildCardContext(ctx)}
Current description: ${ctx.sectionContent || "(empty)"}

Provide helpful suggestions, clarifications, or improvements. Be concise and practical.`,

  opinion: (ctx) => {
    let prompt = `You are a senior software architect evaluating a development task.
${buildCardContext(ctx)}
Current opinion: ${ctx.sectionContent || "(none)"}`;

    // Add product narrative context if available
    if (ctx.narrativeContent) {
      prompt += `

## Product Narrative (Brand Context)
Use this product narrative to understand the project vision, goals, and constraints when evaluating:

${ctx.narrativeContent}

---`;
    }

    prompt += `

Provide technical analysis, identify potential challenges, suggest approaches, and assess complexity. Be direct and constructive.`;
    return prompt;
  },

  solution: (ctx) => `You are helping plan the implementation of a development task.
${buildCardContext(ctx)}
Current solution plan: ${ctx.sectionContent || "(none)"}

Help refine the implementation approach, suggest patterns, identify dependencies, and structure the work. Be specific and actionable.`,

  tests: (ctx) => `You are a QA engineer helping write test scenarios for a development task.
${buildCardContext(ctx)}
Current test scenarios: ${ctx.sectionContent || "(none)"}

Suggest test cases covering happy paths, edge cases, and error conditions. Use checkbox format: - [ ] Test description`,
};

// Strip HTML tags for cleaner prompts
function stripHtml(html: string): string {
  if (!html) return "";
  return html.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
}

// Read product narrative file for a project
function readNarrativeContent(projectFolderPath: string, customNarrativePath?: string | null): string | undefined {
  try {
    // Use custom path if provided, otherwise default to docs/product-narrative.md
    const narrativePath = customNarrativePath
      ? join(projectFolderPath, customNarrativePath)
      : join(projectFolderPath, "docs", "product-narrative.md");

    if (existsSync(narrativePath)) {
      const content = readFileSync(narrativePath, "utf-8");
      // Limit content to prevent overly long prompts
      const maxLength = 3000;
      if (content.length > maxLength) {
        return content.slice(0, maxLength) + "\n\n[... narrative truncated for brevity ...]";
      }
      return content;
    }
  } catch (error) {
    console.error("Failed to read narrative:", error);
  }
  return undefined;
}

// Temp directory for images
const IMAGES_TEMP_DIR = join(tmpdir(), "ideafy-images");

// Extract base64 images from HTML content and save to temp files
function extractAndSaveImages(content: string): { textContent: string; imagePaths: string[] } {
  const imagePaths: string[] = [];
  const tempDir = IMAGES_TEMP_DIR;

  // Create temp directory if it doesn't exist
  if (!existsSync(tempDir)) {
    mkdirSync(tempDir, { recursive: true });
  }

  // Match base64 images in img tags
  const imgRegex = /<img[^>]*src="data:image\/([^;]+);base64,([^"]+)"[^>]*>/gi;
  let match;
  let imageIndex = 0;

  while ((match = imgRegex.exec(content)) !== null) {
    const extension = match[1] || "png";
    const base64Data = match[2];
    const filename = `chat-image-${Date.now()}-${imageIndex}.${extension}`;
    const filepath = join(tempDir, filename);

    try {
      // Save base64 to file
      const buffer = Buffer.from(base64Data, "base64");
      writeFileSync(filepath, buffer);
      imagePaths.push(filepath);
      imageIndex++;
    } catch (error) {
      console.error("Failed to save image:", error);
    }
  }

  // Strip HTML to get clean text content
  const textContent = stripHtml(content);

  return { textContent, imagePaths };
}

// Build conversation context from history
function buildConversationContext(messages: ConversationMessage[]): string {
  if (messages.length === 0) return "";

  const context = messages
    .slice(-10) // Last 10 messages for context
    .map((msg) => `${msg.role === "user" ? "User" : "Assistant"}: ${msg.content}`)
    .join("\n\n");

  return `\n\nPrevious conversation:\n${context}`;
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: cardId } = await params;
  const body = await request.json();
  const { sectionType, content, mentions, projectPath, currentSectionContent } = body;

  if (!sectionType || !content) {
    return new Response("Missing sectionType or content", { status: 400 });
  }

  // Get card info for context
  const [card] = await db.select().from(cards).where(eq(cards.id, cardId));
  if (!card) {
    return new Response("Card not found", { status: 404 });
  }

  // Get project info for display ID and narrative
  let displayId = cardId; // fallback to UUID
  let projectName = "";
  let narrativeContent: string | undefined;
  let projectFolderPath = projectPath || "";
  let projectNarrativePath: string | null = null;

  if (card.projectId) {
    const [project] = await db.select().from(projects).where(eq(projects.id, card.projectId));
    if (project) {
      displayId = `${project.idPrefix}-${card.taskNumber}`;
      projectName = project.name;
      projectFolderPath = project.folderPath;
      projectNarrativePath = project.narrativePath;
    }
  }

  // Read narrative content for opinion section
  if (sectionType === "opinion" && projectFolderPath) {
    narrativeContent = readNarrativeContent(projectFolderPath, projectNarrativePath);
  }

  // Get conversation history for context
  const history = await db
    .select()
    .from(conversations)
    .where(
      and(
        eq(conversations.cardId, cardId),
        eq(conversations.sectionType, sectionType)
      )
    )
    .orderBy(asc(conversations.createdAt));

  const parsedHistory: ConversationMessage[] = history.map((msg) => ({
    id: msg.id,
    cardId: msg.cardId,
    sectionType: msg.sectionType as SectionType,
    role: msg.role as "user" | "assistant",
    content: msg.content,
    mentions: msg.mentions ? JSON.parse(msg.mentions) : [],
    toolCalls: msg.toolCalls ? JSON.parse(msg.toolCalls) : undefined,
    createdAt: msg.createdAt,
  }));

  // Save user message to database
  const userMessageId = uuidv4();
  await db.insert(conversations).values({
    id: userMessageId,
    cardId,
    sectionType,
    role: "user",
    content,
    mentions: mentions ? JSON.stringify(mentions) : null,
    toolCalls: null,
    createdAt: new Date().toISOString(),
  });

  // Extract images from content and save to temp files
  const { textContent, imagePaths } = extractAndSaveImages(content);

  // Build the prompt with system context and conversation history
  const cardContext: CardContext = {
    uuid: cardId,
    displayId,
    title: card.title,
    projectName,
    sectionContent: stripHtml(currentSectionContent || ""),
    narrativeContent, // Include narrative for opinion section
  };
  const systemPrompt = SECTION_SYSTEM_PROMPTS[sectionType as SectionType](cardContext);
  const conversationContext = buildConversationContext(parsedHistory);

  // Build user message with image references
  let userMessage = textContent || content;
  if (imagePaths.length > 0) {
    const imageRefs = imagePaths.map((p, i) => `[Image ${i + 1}: ${p}]`).join("\n");
    userMessage = `${userMessage}\n\nThe user has attached ${imagePaths.length} image(s). Please use the Read tool to view them:\n${imageRefs}`;
  }

  const fullPrompt = `${systemPrompt}${conversationContext}\n\nUser: ${userMessage}`;

  const cwd = projectPath || process.cwd();

  // Kill any existing process for this card+section
  const processKey = `${cardId}-${sectionType}`;
  const existing = getProcess(processKey);
  if (existing) {
    killProcess(processKey);
  }

  const encoder = new TextEncoder();
  let isClosed = false;
  let fullResponse = "";
  const toolCalls: Array<{ name: string; input: Record<string, unknown> }> = [];

  // Generate assistant message ID for database
  const assistantMessageId = uuidv4();

  const stream = new ReadableStream({
    start(controller) {
      const sendEvent = (type: string, data: unknown) => {
        if (isClosed) return;
        try {
          const event = `data: ${JSON.stringify({ type, data })}\n\n`;
          controller.enqueue(encoder.encode(event));
        } catch {
          isClosed = true;
        }
      };

      const claudeArgs = [
        "-p", fullPrompt,
        "--print",
        "--output-format", "stream-json",
        "--verbose",
        "--allowedTools", "Read",
        "--add-dir", IMAGES_TEMP_DIR
      ];

      const claudeProcess = spawn(getClaudePath(), claudeArgs, {
        cwd,
        stdio: ["ignore", "pipe", "pipe"],
        env: getClaudeEnv(),
      });

      // Register process with metadata
      registerProcess(processKey, claudeProcess, {
        cardId,
        sectionType: sectionType as SectionType,
        processType: "chat",
        cardTitle: card.title,
        displayId: displayId !== cardId ? displayId : null,
        startedAt: new Date().toISOString(),
      });
      sendEvent("start", { pid: claudeProcess.pid, messageId: assistantMessageId });

      let stdoutBuffer = "";

      claudeProcess.stdout?.on("data", (data: Buffer) => {
        stdoutBuffer += data.toString();
        const lines = stdoutBuffer.split('\n');
        stdoutBuffer = lines.pop() || "";

        for (const line of lines) {
          if (!line.trim()) continue;

          try {
            const json = JSON.parse(line);

            // Handle assistant message with content
            if (json.type === 'assistant' && json.message?.content) {
              for (const block of json.message.content) {
                if (block.type === 'text' && block.text) {
                  fullResponse += block.text;
                  sendEvent("text", block.text);
                }
                if (block.type === 'thinking' && block.thinking) {
                  sendEvent("thinking", block.thinking);
                }
                if (block.type === 'tool_use') {
                  toolCalls.push({ name: block.name, input: block.input });
                  sendEvent("tool_use", { name: block.name, input: block.input });
                }
              }
            }

            // Handle streaming content
            if (json.type === 'content_block_delta') {
              if (json.delta?.text) {
                fullResponse += json.delta.text;
                sendEvent("text", json.delta.text);
              }
              if (json.delta?.thinking) {
                sendEvent("thinking", json.delta.thinking);
              }
            }

            // Handle tool results
            if (json.type === 'tool_result') {
              sendEvent("tool_result", { name: json.name, output: json.output?.slice?.(0, 200) });
            }
          } catch {
            // Invalid JSON, skip
          }
        }
      });

      claudeProcess.stderr?.on("data", (data: Buffer) => {
        const text = data.toString();
        if (text.includes("error") || text.includes("Error")) {
          sendEvent("stderr", text);
        }
      });

      claudeProcess.on("close", async (code) => {
        unregisterProcess(processKey);

        // Save assistant message to database
        if (fullResponse.trim()) {
          try {
            await db.insert(conversations).values({
              id: assistantMessageId,
              cardId,
              sectionType,
              role: "assistant",
              content: fullResponse.trim(),
              mentions: null,
              toolCalls: toolCalls.length > 0 ? JSON.stringify(toolCalls) : null,
              createdAt: new Date().toISOString(),
            });
          } catch (error) {
            console.error("Failed to save assistant message:", error);
          }
        }

        sendEvent("close", { code, messageId: assistantMessageId });
        if (!isClosed) {
          isClosed = true;
          controller.close();
        }
      });

      claudeProcess.on("error", (error) => {
        unregisterProcess(processKey);
        sendEvent("error", error.message);
        if (!isClosed) {
          isClosed = true;
          controller.close();
        }
      });

      request.signal.addEventListener("abort", () => {
        isClosed = true;
        if (claudeProcess && !claudeProcess.killed) {
          claudeProcess.kill();
          unregisterProcess(processKey);
        }
      });
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      "Connection": "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: cardId } = await params;
  const searchParams = request.nextUrl.searchParams;
  const sectionType = searchParams.get("sectionType") || "";

  const processKey = `${cardId}-${sectionType}`;
  const killed = killProcess(processKey);

  if (killed) {
    return Response.json({ success: true, message: "Stream stopped" });
  }

  return Response.json({ success: false, message: "No active stream found" });
}
