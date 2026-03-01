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
  completeProcess,
  getProcess,
  killProcess,
} from "@/lib/process-registry";
import { getProviderForCard } from "@/lib/platform/active";

// Card context info
interface CardContext {
  uuid: string;
  displayId: string;
  title: string;
  projectName: string;
  sectionContent: string;
  narrativeContent?: string; // Product narrative for opinion context
  status: string;
  description?: string;
  solutionSummary?: string;
  testScenarios?: string;
}

// Get allowed tools based on card status AND section type
function getAllowedTools(status: string, sectionType: string): string[] {
  // Only "tests" section on active cards gets full code execution tools
  if (sectionType === "tests" && ["progress", "test", "completed"].includes(status)) {
    return ["Read", "Edit", "Write", "Bash", "Grep", "Glob"];
  }
  // All other sections: read-only (card field updates happen via MCP tools)
  return ["Read"];
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

// Build section behavior context based on section type and card status
function buildSectionBehaviorContext(ctx: CardContext, sectionType: string): string {
  // Tests section on active cards: action mode (can edit code)
  if (sectionType === "tests" && ["progress", "test", "completed"].includes(ctx.status)) {
    let actionContext = `

## Action Mode
This card is currently in "${ctx.status}" status. The user expects you to TAKE ACTION, not just suggest or plan.
- If the user asks you to fix something, fix it directly
- If the user asks you to implement something, implement it
- Only ask clarifying questions if the request is genuinely ambiguous
- Do NOT respond with "here's a plan" — actually do the work
- You have access to Bash, Grep, and Glob tools in addition to Read, Edit, and Write

## IMPORTANT: Test Scenarios - Append Only
When you make code changes and need to update test scenarios, you MUST only APPEND new test scenarios to the existing ones.
- NEVER remove or overwrite existing test scenarios unless the user explicitly asks you to
- Preserve the EXACT markdown format of existing test scenarios (headings, checkbox syntax, grouping)
- Preserve the checked state of completed items: items marked as [x] MUST remain [x], do NOT reset them to [ ]
- Add new test cases at the end of the existing list
- If you call save_tests, include ALL existing test scenarios plus your new additions`;

    if (ctx.description) {
      actionContext += `\n\nCard Description: ${ctx.description}`;
    }
    if (ctx.solutionSummary) {
      actionContext += `\nImplementation Plan: ${ctx.solutionSummary}`;
    }
    if (ctx.testScenarios) {
      actionContext += `\nTest Scenarios: ${ctx.testScenarios}`;
    }

    return actionContext;
  }

  // All other sections: advisory only, no code changes
  return `

## IMPORTANT: No Code Changes Allowed
You are in the "${sectionType}" section. In this section you can ONLY:
- Discuss, analyze, and help improve the ${sectionType === "detail" ? "description" : sectionType === "opinion" ? "AI opinion/evaluation" : "solution plan"} for this card
- Update the card field using the appropriate MCP tool (update_card, save_plan, save_opinion)
- Read files for context if needed

You MUST NOT edit, write, or modify any code files. If the user asks you to make code changes, politely explain that code changes can only be made from the "Tests" tab chat. Redirect them there.`;
}

// Shared MCP tool usage instructions
function buildToolUsageContext(section: SectionType): string {
  return `

## Available MCP Tools
You have access to these MCP tools for updating this card:
- save_plan: Save solution plan (markdown) and move card to In Progress
- save_tests: Save test scenarios (markdown with checkboxes) and move card to Human Test
- save_opinion: Save AI opinion with verdict (positive/negative)
- update_card: Update any card field (title, description, status, complexity, priority, solutionSummary, testScenarios)

## CRITICAL: Persisting Content
When you produce substantive content for a card field, you MUST save it using the appropriate MCP tool.
Do NOT just respond with text — persist it to the card so it appears in the UI.
Only call save tools when you've produced a complete or substantially improved version of the field content, not for general discussion or clarifying questions.
${section === "solution" ? `
After saving a solution plan via save_plan, you MUST also generate test scenarios and save them via save_tests.
Test scenarios should cover:
- Happy path tests for each implementation step
- Edge cases and error conditions
- Regression tests for existing functionality
Format: Use markdown checkboxes (- [ ] Test description)` : ""}${section === "detail" ? `
When you refine or improve the description, call update_card with the updated description field.` : ""}${section === "opinion" ? `
When you produce a complete evaluation/opinion, call save_opinion with the opinion content and verdict.` : ""}${section === "tests" ? `
When you produce test scenarios, call save_tests with the test content in markdown checkbox format.
IMPORTANT: Always APPEND new test scenarios to the existing ones. Never remove existing test scenarios unless the user explicitly asks. Preserve the EXACT markdown format and checked state ([x]) of existing items. Include all existing scenarios plus new additions when calling save_tests.` : ""}`;
}

// Section-specific system prompts
const SECTION_SYSTEM_PROMPTS: Record<SectionType, (ctx: CardContext) => string> = {
  detail: (ctx) => `You are helping improve a development task description.
${buildCardContext(ctx)}
Current description: ${ctx.sectionContent || "(empty)"}

Provide helpful suggestions, clarifications, or improvements. Be concise and practical.${buildSectionBehaviorContext(ctx, "detail")}${buildToolUsageContext("detail")}`,

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

Provide technical analysis, identify potential challenges, suggest approaches, and assess complexity. Be direct and constructive.${buildSectionBehaviorContext(ctx, "opinion")}${buildToolUsageContext("opinion")}`;
    return prompt;
  },

  solution: (ctx) => `You are helping plan the implementation of a development task.
${buildCardContext(ctx)}
Current solution plan: ${ctx.sectionContent || "(none)"}

Help refine the implementation approach, suggest patterns, identify dependencies, and structure the work. Be specific and actionable.${buildSectionBehaviorContext(ctx, "solution")}${buildToolUsageContext("solution")}`,

  tests: (ctx) => `You are a QA engineer helping write test scenarios for a development task.
${buildCardContext(ctx)}
Current test scenarios: ${ctx.sectionContent || "(none)"}

Suggest test cases covering happy paths, edge cases, and error conditions. Use checkbox format: - [ ] Test description${buildSectionBehaviorContext(ctx, "tests")}${buildToolUsageContext("tests")}`,
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
    status: card.status,
    description: stripHtml(card.description || ""),
    solutionSummary: stripHtml(card.solutionSummary || ""),
    testScenarios: stripHtml(card.testScenarios || ""),
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

  const provider = getProviderForCard(card);

  // Check if streaming is supported by the active platform
  if (!provider.capabilities.supportsStreamJson) {
    return new Response(
      JSON.stringify({
        error: `${provider.displayName} does not support streaming chat`,
        suggestion: "Use interactive terminal instead",
      }),
      { status: 400, headers: { "Content-Type": "application/json" } }
    );
  }

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

      const cliArgs = provider.buildStreamArgs({
        prompt: fullPrompt,
        allowedTools: getAllowedTools(card.status, sectionType),
        addDirs: [IMAGES_TEMP_DIR],
      });

      const spawnEnv = provider.getEnv();
      console.log(`[chat-stream] spawning ${provider.id}:`, provider.getCliPath(), JSON.stringify(cliArgs.slice(0, 3)), `(${cliArgs.length} args, cwd: ${cwd}, HOME: ${spawnEnv.HOME}, OPENAI_API_KEY: ${spawnEnv.OPENAI_API_KEY ? 'SET' : 'unset'})`);

      const cliProcess = spawn(provider.getCliPath(), cliArgs, {
        cwd,
        stdio: ["ignore", "pipe", "pipe"],
        env: spawnEnv,
      });

      // Register process with metadata
      registerProcess(processKey, cliProcess, {
        cardId,
        sectionType: sectionType as SectionType,
        processType: "chat",
        cardTitle: card.title,
        displayId: displayId !== cardId ? displayId : null,
        startedAt: new Date().toISOString(),
      });
      sendEvent("start", { pid: cliProcess.pid, messageId: assistantMessageId });

      let stdoutBuffer = "";

      cliProcess.stdout?.on("data", (data: Buffer) => {
        const raw = data.toString();
        console.log(`[chat-stream] stdout (${provider.id}):`, raw.slice(0, 300));
        stdoutBuffer += raw;
        const lines = stdoutBuffer.split('\n');
        stdoutBuffer = lines.pop() || "";

        for (const line of lines) {
          if (!line.trim()) continue;

          const events = provider.parseStreamLine(line);
          console.log(`[chat-stream] parsed ${events.length} events from line:`, line.slice(0, 100));
          for (const event of events) {
            switch (event.type) {
              case "text":
                fullResponse += event.data as string;
                sendEvent("text", event.data);
                break;
              case "thinking":
                sendEvent("thinking", event.data);
                break;
              case "tool_use":
                toolCalls.push(event.data as { name: string; input: Record<string, unknown> });
                sendEvent("tool_use", event.data);
                break;
              case "tool_result":
                sendEvent("tool_result", event.data);
                break;
              case "result": {
                const resultText = String(event.data);
                if (resultText.trim() && !fullResponse.includes(resultText.trim())) {
                  fullResponse += (fullResponse ? '\n' : '') + resultText;
                  sendEvent("text", resultText);
                }
                break;
              }
              case "system":
                sendEvent("system", event.data);
                break;
            }
          }
        }
      });

      cliProcess.stderr?.on("data", (data: Buffer) => {
        const text = data.toString();
        console.log(`[chat-stream] stderr (${provider.id}):`, text.slice(0, 500));
        if (text.includes("error") || text.includes("Error")) {
          sendEvent("stderr", text);
        }
      });

      cliProcess.on("close", async (code) => {
        console.log(`[chat-stream] ${provider.id} closed with code ${code}, fullResponse length: ${fullResponse.length}`);
        // Process any remaining data in stdout buffer
        if (stdoutBuffer.trim()) {
          const events = provider.parseStreamLine(stdoutBuffer);
          for (const event of events) {
            switch (event.type) {
              case "text":
                fullResponse += event.data as string;
                sendEvent("text", event.data);
                break;
              case "tool_use":
                toolCalls.push(event.data as { name: string; input: Record<string, unknown> });
                sendEvent("tool_use", event.data);
                break;
              case "result": {
                const resultText = String(event.data);
                if (resultText.trim() && !fullResponse.includes(resultText.trim())) {
                  fullResponse += (fullResponse ? '\n' : '') + resultText;
                  sendEvent("text", resultText);
                }
                break;
              }
            }
          }
          stdoutBuffer = "";
        }

        completeProcess(processKey);

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

      cliProcess.on("error", (error) => {
        completeProcess(processKey);
        sendEvent("error", error.message);
        if (!isClosed) {
          isClosed = true;
          controller.close();
        }
      });

      request.signal.addEventListener("abort", () => {
        isClosed = true;
        if (cliProcess && !cliProcess.killed) {
          cliProcess.kill();
          completeProcess(processKey);
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
