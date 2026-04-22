import { spawn } from "child_process";
import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { conversations, cards, projects, chatSessions } from "@/lib/db/schema";
import { eq, and, asc } from "drizzle-orm";
import { v4 as uuidv4 } from "uuid";
import { existsSync, readFileSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import type { SectionType, ConversationMessage } from "@/lib/types";
import {
  registerProcess,
  completeProcess,
  getProcess,
  killProcess,
} from "@/lib/process-registry";
import { getProviderForCard } from "@/lib/platform/active";
import { resolveSessionId } from "@/lib/platform/session-resolver";
import { extractConversationImages, generateImageReferences } from "@/lib/prompts";
import {
  type CardContext,
  getAllowedTools,
  SECTION_SYSTEM_PROMPTS,
  stripHtml,
  buildConversationContext,
} from "@/lib/ai/prompt-builder";

function processMentions(
  message: string,
  mentions: Array<{ type: string; id: string; label: string }> | undefined
): string {
  if (!mentions?.length) return message;

  let processed = message;

  // Only strip / from MCP and plugin mentions — these are NOT CLI skills
  // Skill mentions keep their / prefix so Claude CLI can invoke them
  for (const mention of mentions) {
    if (mention.type === "mcp" || mention.type === "plugin") {
      const slashPattern = new RegExp(`/${mention.label}\\b`, "g");
      processed = processed.replace(slashPattern, mention.label);
    }
  }

  // Add context for MCP mentions so Claude uses the right tools
  const mcpMentions = mentions.filter(m => m.type === "mcp");
  if (mcpMentions.length > 0) {
    const names = mcpMentions.map(m => m.id).join(", ");
    processed = `[Referenced MCP tools: ${names} — use the corresponding mcp__* tools]\n\n${processed}`;
  }

  return processed;
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
  let projectForSession: { idPrefix: string } | null = null;

  if (card.projectId) {
    const [project] = await db.select().from(projects).where(eq(projects.id, card.projectId));
    if (project) {
      displayId = `${project.idPrefix}-${card.taskNumber}`;
      projectName = project.name;
      projectFolderPath = project.folderPath;
      projectNarrativePath = project.narrativePath;
      projectForSession = project;
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

  // Extract base64 images from content, save to temp files
  const { cleanContent, savedImages } = extractConversationImages(content, cardId, 0);
  let userMessage = stripHtml(cleanContent) || stripHtml(content);
  if (savedImages.length > 0) {
    userMessage = `${userMessage}\n\n${generateImageReferences(savedImages)}`;
  }

  // Process mentions: strip / from MCP mentions to prevent CLI skill interpretation
  userMessage = processMentions(userMessage, mentions);

  // Check for existing CLI session to resume
  const provider = getProviderForCard(card);
  const [existingSession] = await db.select().from(chatSessions)
    .where(and(eq(chatSessions.cardId, cardId), eq(chatSessions.sectionType, sectionType)));

  const canResume = !!(existingSession
    && provider.capabilities.supportsSessionResume
    && existingSession.provider === provider.id);

  // Build full prompt only when not resuming (fresh session needs full context)
  let fullPrompt = "";
  if (!canResume) {
    const cardContext: CardContext = {
      uuid: cardId,
      displayId,
      title: card.title,
      projectName,
      sectionContent: stripHtml(currentSectionContent || ""),
      narrativeContent,
      status: card.status,
      description: stripHtml(card.description || ""),
      solutionSummary: stripHtml(card.solutionSummary || ""),
      testScenarios: stripHtml(card.testScenarios || ""),
    };
    const systemPrompt = SECTION_SYSTEM_PROMPTS[sectionType as SectionType](cardContext);
    const conversationContext = buildConversationContext(parsedHistory, (content, msgIndex) => {
      const { cleanContent, savedImages } = extractConversationImages(content, cardId, msgIndex);
      return { cleanContent, imageRefs: generateImageReferences(savedImages) };
    });
    fullPrompt = `${systemPrompt}${conversationContext}\n\nUser: ${userMessage}`;
  }

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
  let streamSessionId: string | null = null;
  const toolCalls: Array<{ name: string; input: Record<string, unknown> }> = [];

  // Generate assistant message ID for database
  const assistantMessageId = uuidv4();

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

  // Prepare session ID for fresh sessions (Claude uses --session-id to control it)
  const newSessionId = (!canResume && provider.capabilities.supportsSessionResume && provider.id === "claude")
    ? uuidv4() : undefined;

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

      const isTestAction = sectionType === "tests" && ["progress", "test", "completed"].includes(card.status);

      let cliArgs: string[];
      if (canResume && existingSession) {
        // RESUME MODE — only send the new user message, no system prompt or history
        cliArgs = provider.buildStreamArgs({
          prompt: userMessage,
          skipPermissions: isTestAction,
          addDirs: [tmpdir()],
          resumeSessionId: existingSession.cliSessionId,
        });
        console.log(`[chat-stream] resuming session ${existingSession.cliSessionId} for ${cardId}/${sectionType} (skipPermissions=${isTestAction})`);
      } else {
        // FRESH MODE — full context (system prompt + conversation history + user message)
        cliArgs = provider.buildStreamArgs({
          prompt: fullPrompt,
          skipPermissions: isTestAction,
          allowedTools: isTestAction ? undefined : getAllowedTools(mentions),
          addDirs: [tmpdir()],
          newSessionId,
        });
      }

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
        stdoutBuffer += raw;
        const lines = stdoutBuffer.split('\n');
        stdoutBuffer = lines.pop() || "";

        for (const line of lines) {
          if (!line.trim()) continue;

          const events = provider.parseStreamLine(line);
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
              case "session_id":
                if (!streamSessionId) {
                  streamSessionId = String(event.data);
                }
                break;
            }
          }
        }
      });

      cliProcess.stderr?.on("data", (data: Buffer) => {
        const text = data.toString();
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
              case "session_id":
                if (!streamSessionId) {
                  streamSessionId = String(event.data);
                }
                break;
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

        // Session management after process completes
        try {
          if (code === 0) {
            if (canResume && existingSession) {
              // Successful resume — update lastUsedAt
              await db.update(chatSessions)
                .set({ lastUsedAt: new Date().toISOString() })
                .where(eq(chatSessions.id, existingSession.id));
            } else if (provider.capabilities.supportsSessionResume) {
              // Fresh session succeeded — save session ID
              // Claude: we set it upfront via --session-id
              // Codex/Gemini: captured from stream events (thread.started / init)
              // Filesystem resolver kept as a last-resort fallback
              let sessionId = newSessionId ?? streamSessionId ?? undefined;
              if (!sessionId) {
                sessionId = resolveSessionId(provider.id, cwd) ?? undefined;
              }
              if (sessionId) {
                await db.insert(chatSessions).values({
                  id: uuidv4(),
                  cardId,
                  sectionType,
                  cliSessionId: sessionId,
                  provider: provider.id,
                  createdAt: new Date().toISOString(),
                  lastUsedAt: new Date().toISOString(),
                }).onConflictDoUpdate({
                  target: [chatSessions.cardId, chatSessions.sectionType],
                  set: {
                    cliSessionId: sessionId,
                    provider: provider.id,
                    lastUsedAt: new Date().toISOString(),
                  },
                });
                console.log(`[chat-stream] saved session ${sessionId} for ${cardId}/${sectionType}`);
              }
            }
          } else if (canResume && existingSession) {
            // Resume failed — delete stale session, send error so client can retry
            await db.delete(chatSessions).where(eq(chatSessions.id, existingSession.id));
            console.log(`[chat-stream] resume failed (code ${code}), deleted stale session ${existingSession.cliSessionId}`);
            sendEvent("resume_failed", { message: "Session expired, retrying with full context" });
          }
        } catch (sessionError) {
          console.error("[chat-stream] session management error:", sessionError);
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
