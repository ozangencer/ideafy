import { spawn, ChildProcess } from "child_process";
import { NextRequest } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { cards } from "@/lib/db/schema";
import { getProviderForCard } from "@/lib/platform/active";
import { isMissingDependencyError } from "@/lib/platform/base-provider";

// Store active processes for cleanup
const activeProcesses = new Map<string, ChildProcess>();

export async function POST(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  const { id } = params;
  const body = await request.json();
  const { prompt, projectPath, sectionType } = body;

  if (!prompt) {
    return new Response("Missing prompt", { status: 400 });
  }

  const cwd = projectPath || process.cwd();

  // Fetch card for per-card AI platform override
  const card = db.select().from(cards).where(eq(cards.id, id)).get();

  // Kill any existing process for this card+section
  const processKey = `${id}-${sectionType}`;
  const existing = activeProcesses.get(processKey);
  if (existing) {
    existing.kill();
    activeProcesses.delete(processKey);
  }

  const encoder = new TextEncoder();
  let isClosed = false;

  const provider = getProviderForCard(card || {});

  // Check if streaming is supported
  if (!provider.capabilities.supportsStreamJson) {
    return new Response(
      JSON.stringify({
        error: `${provider.displayName} does not support streaming`,
        suggestion: "Use interactive terminal instead",
      }),
      { status: 400, headers: { "Content-Type": "application/json" } }
    );
  }

  try {
    provider.getCliPath();
  } catch (err) {
    if (isMissingDependencyError(err)) {
      return new Response(
        JSON.stringify({ error: err.message, dependency: err.binaryName }),
        { status: 400, headers: { "Content-Type": "application/json" } }
      );
    }
    throw err;
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

      const cliProcess = spawn(provider.getCliPath(), provider.buildStreamArgs({ prompt }), {
        cwd,
        stdio: ["ignore", "pipe", "pipe"],
        env: provider.getEnv(),
      });

      activeProcesses.set(processKey, cliProcess);
      sendEvent("start", { pid: cliProcess.pid });

      let stdoutBuffer = "";

      cliProcess.stdout?.on("data", (data: Buffer) => {
        stdoutBuffer += data.toString();
        const lines = stdoutBuffer.split('\n');
        stdoutBuffer = lines.pop() || "";

        for (const line of lines) {
          if (!line.trim()) continue;

          const events = provider.parseStreamLine(line);
          for (const event of events) {
            sendEvent(event.type, event.data);
          }
        }
      });

      cliProcess.stderr?.on("data", (data: Buffer) => {
        const text = data.toString();
        if (text.includes("error") || text.includes("Error")) {
          sendEvent("stderr", text);
        }
      });

      cliProcess.on("close", (code) => {
        if (stdoutBuffer.trim()) {
          const events = provider.parseStreamLine(stdoutBuffer);
          for (const event of events) {
            sendEvent(event.type, event.data);
          }
        }
        activeProcesses.delete(processKey);
        sendEvent("close", { code });
        if (!isClosed) {
          isClosed = true;
          controller.close();
        }
      });

      cliProcess.on("error", (error) => {
        activeProcesses.delete(processKey);
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
          activeProcesses.delete(processKey);
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
  { params }: { params: { id: string } }
) {
  const { id } = params;
  const searchParams = request.nextUrl.searchParams;
  const sectionType = searchParams.get("sectionType") || "";

  const processKey = `${id}-${sectionType}`;
  const active = activeProcesses.get(processKey);

  if (active) {
    active.kill();
    activeProcesses.delete(processKey);
    return Response.json({ success: true, message: "Stream stopped" });
  }

  return Response.json({ success: false, message: "No active stream found" });
}
