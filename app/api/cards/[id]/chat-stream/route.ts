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
import {
  startLiveStream,
  pushLiveStreamEvent,
  completeLiveStream,
  liveStreamKey,
} from "@/lib/live-stream-buffer";
import { extractConversationImages, generateImageReferences, getCardImageDir } from "@/lib/prompts";
import {
  type CardContext,
  getAllowedTools,
  SECTION_SYSTEM_PROMPTS,
  stripHtml,
  buildConversationContext,
} from "@/lib/ai/prompt-builder";
import { testScenariosToMarkdown } from "@/lib/markdown";

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

  // Check for existing CLI session to resume. Sessions are provider-specific:
  // switching AI platforms must not wipe another platform's session row.
  const provider = getProviderForCard(card);
  const [existingSession] = await db.select().from(chatSessions)
    .where(and(
      eq(chatSessions.cardId, cardId),
      eq(chatSessions.sectionType, sectionType),
      eq(chatSessions.provider, provider.id),
    ));

  const canResume = !!(existingSession && provider.capabilities.supportsSessionResume);

  // Always precompute the full prompt. When canResume is true we send only
  // the new user message to the resumed CLI; if that resume turns out to be
  // stale the close handler falls back to a fresh spawn using this prompt,
  // avoiding a second HTTP round-trip and a duplicated user message.
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
    testScenariosHtml: card.testScenarios || "",
  };
  const systemPrompt = SECTION_SYSTEM_PROMPTS[sectionType as SectionType](cardContext);
  const conversationContext = buildConversationContext(parsedHistory, (content, msgIndex) => {
    const { cleanContent, savedImages } = extractConversationImages(content, cardId, msgIndex);
    return { cleanContent, imageRefs: generateImageReferences(savedImages) };
  });
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
  let wasAborted = false;
  let fullResponse = "";
  let streamSessionId: string | null = null;
  let stderrBuffer = "";
  const toolCalls: Array<{ name: string; input: Record<string, unknown> }> = [];

  // Gemini emits each chunk as a full snapshot of the *current* message; when
  // the assistant starts a new message after a tool call, the next snapshot
  // is short and unrelated. Track frozen prior messages so a fresh snapshot
  // doesn't blow away the response we already streamed.
  const frozenSnapshots: string[] = [];
  let currentSnapshot = "";
  const applyTextReplace = (snapshot: string): string => {
    if (snapshot.startsWith(currentSnapshot)) {
      currentSnapshot = snapshot;
    } else {
      if (currentSnapshot) frozenSnapshots.push(currentSnapshot);
      currentSnapshot = snapshot;
    }
    return [...frozenSnapshots, currentSnapshot].filter(Boolean).join("\n\n");
  };

  const isSessionNotFoundError = (stderr: string): boolean => {
    if (!stderr) return false;
    return /session\s+(not\s+found|expired|invalid|does\s+not\s+exist)|no\s+(such\s+)?(session|conversation)|conversation\s+not\s+found|could\s+not\s+resume|failed\s+to\s+resume/i.test(
      stderr,
    );
  };

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

  // Prepare session ID for the first fresh spawn (Claude uses --session-id to control it)
  const initialNewSessionId = (!canResume && provider.capabilities.supportsSessionResume && provider.id === "claude")
    ? uuidv4() : undefined;

  const isTestAction = sectionType === "tests" && ["progress", "test", "completed"].includes(card.status);

  const bufferKey = liveStreamKey(cardId, sectionType);
  startLiveStream(bufferKey);

  const stream = new ReadableStream({
    start(controller) {
      const sendEvent = (type: string, data: unknown) => {
        // Mirror to the live buffer first so reopened modals can replay even
        // events the original POST connection never delivered.
        pushLiveStreamEvent(bufferKey, { type, data });
        if (isClosed) return;
        try {
          const event = `data: ${JSON.stringify({ type, data })}\n\n`;
          controller.enqueue(encoder.encode(event));
        } catch {
          isClosed = true;
        }
      };

      // Emit the session-decision trail before the LLM starts streaming so
      // the UI can show "Checking… / Session found / Resuming" instead of a
      // silent gap between the user message and the first token.
      const shortId = (id: string) => id.slice(0, 8);
      sendEvent("status", { step: "checking" });
      if (existingSession) {
        sendEvent("status", { step: "session_found", sessionId: shortId(existingSession.cliSessionId) });
      } else {
        sendEvent("status", { step: "session_missing" });
      }

      let activeProcess: ReturnType<typeof spawn> | null = null;
      let didFreshRetry = false;
      let freshRetrySessionId: string | undefined;

      const runSpawn = (mode: "resume" | "fresh") => {
        let cliArgs: string[];
        let resumeTargetSessionId: string | undefined;
        let freshSpawnSessionId: string | undefined;

        if (mode === "resume" && existingSession) {
          resumeTargetSessionId = existingSession.cliSessionId;
          // Resumed sessions only receive the new user message, so the AI
          // still sees the testScenarios snapshot captured when the session
          // first spawned. If the user toggled checkboxes (or save_tests ran
          // via merge) since then, the cached view is stale and the AI
          // answers questions like "which items are checked?" incorrectly.
          // Prepend a fresh snapshot on the tests tab so state stays current.
          let resumeMessage = userMessage;
          if (sectionType === "tests") {
            const snapshot = testScenariosToMarkdown(card.testScenarios || "");
            if (snapshot) {
              resumeMessage = `[Current test scenarios state — use this, not any earlier version you remember]\n${snapshot}\n\n---\n\n${userMessage}`;
            }
          }
          cliArgs = provider.buildStreamArgs({
            prompt: resumeMessage,
            skipPermissions: isTestAction,
            addDirs: [tmpdir(), getCardImageDir(cardId)],
            resumeSessionId: existingSession.cliSessionId,
          });
          sendEvent("status", { step: "resuming", sessionId: shortId(existingSession.cliSessionId) });
          console.log(`[chat-stream] resuming session ${existingSession.cliSessionId} for ${cardId}/${sectionType} (skipPermissions=${isTestAction})`);
        } else {
          freshSpawnSessionId = mode === "fresh" && provider.capabilities.supportsSessionResume && provider.id === "claude"
            ? uuidv4()
            : initialNewSessionId;
          if (mode === "fresh") {
            freshRetrySessionId = freshSpawnSessionId;
          }
          cliArgs = provider.buildStreamArgs({
            prompt: fullPrompt,
            skipPermissions: isTestAction,
            allowedTools: isTestAction ? undefined : getAllowedTools(sectionType as SectionType, mentions),
            addDirs: [tmpdir(), getCardImageDir(cardId)],
            newSessionId: freshSpawnSessionId,
          });
          if (freshSpawnSessionId) {
            sendEvent("status", { step: "creating", sessionId: shortId(freshSpawnSessionId) });
          } else {
            sendEvent("status", { step: "creating", sessionId: "pending" });
          }
          if (mode === "fresh") {
            console.log(`[chat-stream] fresh retry after resume failure for ${cardId}/${sectionType}`);
          }
        }

        const spawnEnv = provider.getEnv();
        console.log(`[chat-stream] spawning ${provider.id} (${mode}):`, provider.getCliPath(), JSON.stringify(cliArgs.slice(0, 3)), `(${cliArgs.length} args, cwd: ${cwd}, HOME: ${spawnEnv.HOME}, OPENAI_API_KEY: ${spawnEnv.OPENAI_API_KEY ? 'SET' : 'unset'})`);

        const cliProcess = spawn(provider.getCliPath(), cliArgs, {
          cwd,
          stdio: ["ignore", "pipe", "pipe"],
          env: spawnEnv,
        });
        activeProcess = cliProcess;

        registerProcess(processKey, cliProcess, {
          cardId,
          sectionType: sectionType as SectionType,
          processType: "chat",
          cardTitle: card.title,
          displayId: displayId !== cardId ? displayId : null,
          startedAt: new Date().toISOString(),
        });

        if (mode === "resume") {
          sendEvent("start", { pid: cliProcess.pid, messageId: assistantMessageId });
        }

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
                case "text_replace": {
                  const combined = applyTextReplace(String(event.data ?? ""));
                  fullResponse = combined;
                  sendEvent("text_replace", combined);
                  break;
                }
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
          stderrBuffer += text;
          if (stderrBuffer.length > 16_384) {
            stderrBuffer = stderrBuffer.slice(-16_384);
          }
          if (text.includes("error") || text.includes("Error")) {
            sendEvent("stderr", text);
          }
        });

        cliProcess.on("close", async (code, signal) => {
          console.log(`[chat-stream] ${provider.id} (${mode}) closed with code ${code} (signal=${signal}, aborted=${wasAborted}), fullResponse length: ${fullResponse.length}`);
          if (stdoutBuffer.trim()) {
            const events = provider.parseStreamLine(stdoutBuffer);
            for (const event of events) {
              switch (event.type) {
                case "text":
                  fullResponse += event.data as string;
                  sendEvent("text", event.data);
                  break;
                case "text_replace": {
                  const combined = applyTextReplace(String(event.data ?? ""));
                  fullResponse = combined;
                  sendEvent("text_replace", combined);
                  break;
                }
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

          // Decide whether this was a stale-session failure — only meaningful
          // for the resume leg; fresh spawns don't have a prior session to blame.
          const aborted = wasAborted || signal === "SIGTERM" || signal === "SIGINT" || signal === "SIGKILL";
          const sessionError = mode === "resume" && isSessionNotFoundError(stderrBuffer);
          const shouldFreshRetry = mode === "resume" && sessionError && !aborted && !didFreshRetry && code !== 0;

          if (shouldFreshRetry && resumeTargetSessionId) {
            // Stale resume session. Delete the DB record, reset stream-local
            // buffers, and spawn a fresh CLI in-band so the user sees one
            // continuous response instead of an error.
            try {
              await db.delete(chatSessions).where(eq(chatSessions.id, existingSession!.id));
              console.log(`[chat-stream] genuine session failure detected, deleted stale session ${resumeTargetSessionId} and retrying fresh`);
            } catch (delErr) {
              console.error("[chat-stream] failed to delete stale session:", delErr);
            }
            sendEvent("resume_failed", { message: "Session expired, continuing with full context" });
            didFreshRetry = true;
            fullResponse = "";
            streamSessionId = null;
            stderrBuffer = "";
            toolCalls.length = 0;
            runSpawn("fresh");
            return;
          }

          completeProcess(processKey);

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

          try {
            const wasResumeLeg = mode === "resume" && !didFreshRetry;
            if (code === 0) {
              if (wasResumeLeg && existingSession) {
                await db.update(chatSessions)
                  .set({ lastUsedAt: new Date().toISOString() })
                  .where(eq(chatSessions.id, existingSession.id));
              } else if (provider.capabilities.supportsSessionResume) {
                const persistedSessionId =
                  freshRetrySessionId ?? initialNewSessionId ?? streamSessionId ?? resolveSessionId(provider.id, cwd) ?? undefined;
                if (persistedSessionId) {
                  await db.insert(chatSessions).values({
                    id: uuidv4(),
                    cardId,
                    sectionType,
                    cliSessionId: persistedSessionId,
                    provider: provider.id,
                    createdAt: new Date().toISOString(),
                    lastUsedAt: new Date().toISOString(),
                  }).onConflictDoUpdate({
                    target: [chatSessions.cardId, chatSessions.sectionType, chatSessions.provider],
                    set: {
                      cliSessionId: persistedSessionId,
                      lastUsedAt: new Date().toISOString(),
                    },
                  });
                  console.log(`[chat-stream] saved session ${persistedSessionId} for ${cardId}/${sectionType}`);
                }
              }
            } else if (wasResumeLeg && existingSession) {
              // Non-zero exit but not a detected session failure (and not an
              // abort) — still preserve the session. Rate limits, network
              // blips, and transient CLI crashes should be retried, not
              // invalidated.
              if (aborted) {
                console.log(`[chat-stream] resumed stream aborted (signal=${signal}), preserving session ${existingSession.cliSessionId}`);
              } else {
                console.log(`[chat-stream] resumed stream exited non-zero (code=${code}, signal=${signal}) but stderr shows no session error — preserving session ${existingSession.cliSessionId}`);
              }
            }
          } catch (sessionMgmtError) {
            console.error("[chat-stream] session management error:", sessionMgmtError);
          }

          sendEvent("close", { code, messageId: assistantMessageId });
          completeLiveStream(bufferKey);
          if (!isClosed) {
            isClosed = true;
            controller.close();
          }
        });

        cliProcess.on("error", (error) => {
          completeProcess(processKey);
          sendEvent("error", error.message);
          completeLiveStream(bufferKey);
          if (!isClosed) {
            isClosed = true;
            controller.close();
          }
        });
      };

      runSpawn(canResume ? "resume" : "fresh");

      request.signal.addEventListener("abort", () => {
        // Client disconnected (modal closed, HMR reload, tab close). Stop
        // writing to the dead controller, but keep the CLI process alive so
        // sendEvent keeps mirroring to the live buffer; a reopened modal can
        // attach via /chat-stream/live to replay history and tail new events.
        // The CLI's close handler will save the assistant message to the DB
        // when it finishes naturally. Explicit cancellation still works
        // through the dedicated /api/cards/[id]/chat-stream/cancel route.
        isClosed = true;
        console.log(`[chat-stream] client disconnected for ${cardId}/${sectionType}, keeping CLI alive for live-buffer replay`);
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
