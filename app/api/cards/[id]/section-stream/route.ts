import { spawn, ChildProcess } from "child_process";
import { NextRequest } from "next/server";

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

  // Kill any existing process for this card+section
  const processKey = `${id}-${sectionType}`;
  const existing = activeProcesses.get(processKey);
  if (existing) {
    existing.kill();
    activeProcesses.delete(processKey);
  }

  const encoder = new TextEncoder();
  let isClosed = false;

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

      const claudeProcess = spawn("/Users/ozangencer/.local/bin/claude", [
        "-p", prompt,
        "--print",
        "--output-format", "stream-json",
        "--verbose"
      ], {
        cwd,
        stdio: ["ignore", "pipe", "pipe"],
        env: {
          ...process.env,
          HOME: "/Users/ozangencer",
          USER: "ozangencer",
          PATH: "/Users/ozangencer/.local/bin:/usr/local/bin:/usr/bin:/bin",
        },
      });

      activeProcesses.set(processKey, claudeProcess);
      sendEvent("start", { pid: claudeProcess.pid });

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
                  sendEvent("text", block.text);
                }
                // Handle thinking blocks
                if (block.type === 'thinking' && block.thinking) {
                  sendEvent("thinking", block.thinking);
                }
                // Handle tool use
                if (block.type === 'tool_use') {
                  sendEvent("tool_use", { name: block.name, input: block.input });
                }
              }
            }

            // Handle streaming content
            if (json.type === 'content_block_delta') {
              if (json.delta?.text) {
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

            // Handle system messages (like tool calls)
            if (json.type === 'system' && json.subtype) {
              if (json.subtype !== 'init') {
                sendEvent("system", { subtype: json.subtype, message: json.message });
              }
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

      claudeProcess.on("close", (code) => {
        activeProcesses.delete(processKey);
        sendEvent("close", { code });
        if (!isClosed) {
          isClosed = true;
          controller.close();
        }
      });

      claudeProcess.on("error", (error) => {
        activeProcesses.delete(processKey);
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
