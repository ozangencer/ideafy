"use client";

import { useState, useRef, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Send, Loader2, X, ChevronDown, ChevronUp, Brain, Wrench } from "lucide-react";
import ReactMarkdown from "react-markdown";
import { marked } from "marked";

// Configure marked for GFM (GitHub Flavored Markdown) with task lists
marked.setOptions({
  gfm: true,
  breaks: true,
});

// Decode HTML entities and strip tags for cleaner prompts
function stripHtml(html: string): string {
  if (!html) return "";
  // First decode common HTML entities
  const decoded = html
    .replace(/&#39;/g, "'")
    .replace(/&#x27;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&#34;/g, '"')
    .replace(/&#x22;/g, '"')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&nbsp;/g, ' ');
  // Then strip HTML tags
  return decoded.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
}

// Truncate text to max length
function truncate(text: string, maxLength: number): string {
  if (!text || text.length <= maxLength) return text;
  return text.slice(0, maxLength) + "...";
}

export type SectionType = "detail" | "opinion" | "solution" | "tests";

interface CardContext {
  title: string;
  description: string;
  aiOpinion: string;
  solutionSummary: string;
  testScenarios: string;
}

interface SectionChatInputProps {
  cardId: string;
  sectionType: SectionType;
  cardContext: CardContext;
  projectPath: string;
  onUpdate: (newValue: string) => void;
}

// Activity log entry type
interface ActivityEntry {
  type: "thinking" | "tool_use" | "tool_result";
  content: string;
}

// Section-specific configurations with truncated context
const MAX_CONTEXT_LENGTH = 500;

const SECTION_CONFIG: Record<SectionType, {
  placeholder: string;
  systemPrompt: (ctx: CardContext) => string;
  userPromptPrefix: (ctx: CardContext) => string;
}> = {
  detail: {
    placeholder: "Ask AI to improve or expand this detail...",
    systemPrompt: (ctx) => {
      const desc = truncate(stripHtml(ctx.description), MAX_CONTEXT_LENGTH);
      return `You are helping improve a development task description.
Task: "${ctx.title}"
Current description: ${desc || "(empty)"}

Respond with ONLY the updated description content in markdown. No explanations.`;
    },
    userPromptPrefix: (ctx) => `Task: ${ctx.title}\n\nRequest: `,
  },
  opinion: {
    placeholder: "Ask AI for technical analysis...",
    systemPrompt: (ctx) => {
      const desc = truncate(stripHtml(ctx.description), MAX_CONTEXT_LENGTH);
      const opinion = truncate(stripHtml(ctx.aiOpinion), MAX_CONTEXT_LENGTH);
      return `You are a senior software architect evaluating a task.
Task: "${ctx.title}"
Description: ${desc || "(none)"}
Current opinion: ${opinion || "(none)"}

Respond with ONLY your technical opinion in markdown. No introductions.`;
    },
    userPromptPrefix: (ctx) => `Evaluate: ${ctx.title}\n\nQuestion: `,
  },
  solution: {
    placeholder: "Ask AI to refine the solution approach...",
    systemPrompt: (ctx) => {
      const desc = truncate(stripHtml(ctx.description), MAX_CONTEXT_LENGTH);
      const solution = truncate(stripHtml(ctx.solutionSummary), MAX_CONTEXT_LENGTH);
      return `You are helping plan the implementation of a task.
Task: "${ctx.title}"
Description: ${desc || "(none)"}
Current solution: ${solution || "(none)"}

Respond with ONLY the solution content in markdown. No explanations.`;
    },
    userPromptPrefix: (ctx) => `Task: ${ctx.title}\n\nRefine: `,
  },
  tests: {
    placeholder: "Ask AI to add test scenarios...",
    systemPrompt: (ctx) => {
      const desc = truncate(stripHtml(ctx.description), MAX_CONTEXT_LENGTH);
      const solution = truncate(stripHtml(ctx.solutionSummary), 300);
      const tests = truncate(stripHtml(ctx.testScenarios), MAX_CONTEXT_LENGTH);
      return `You are a QA engineer writing test scenarios.
Task: "${ctx.title}"
Description: ${desc || "(none)"}
Solution: ${solution || "(none)"}
Current tests: ${tests || "(none)"}

Respond with test scenarios using: - [ ] Test description
Cover happy paths, edge cases, and error conditions.`;
    },
    userPromptPrefix: (ctx) => `Task: ${ctx.title}\n\nTest request: `,
  },
};

export function SectionChatInput({
  cardId,
  sectionType,
  cardContext,
  projectPath,
  onUpdate,
}: SectionChatInputProps) {
  const [inputValue, setInputValue] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [streamingOutput, setStreamingOutput] = useState("");
  const [activityLog, setActivityLog] = useState<ActivityEntry[]>([]);
  const [showOutput, setShowOutput] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const abortControllerRef = useRef<AbortController | null>(null);
  const outputRef = useRef<HTMLDivElement>(null);
  const activityRef = useRef<HTMLDivElement>(null);

  const config = SECTION_CONFIG[sectionType];

  // Auto-scroll output area
  useEffect(() => {
    if (outputRef.current && streamingOutput) {
      outputRef.current.scrollTop = outputRef.current.scrollHeight;
    }
  }, [streamingOutput]);

  // Auto-scroll activity log
  useEffect(() => {
    if (activityRef.current && activityLog.length > 0) {
      activityRef.current.scrollTop = activityRef.current.scrollHeight;
    }
  }, [activityLog]);

  const addActivity = (type: ActivityEntry["type"], content: string) => {
    setActivityLog(prev => [...prev, { type, content }]);
  };

  const handleSubmit = async () => {
    if (!inputValue.trim() || isLoading) return;

    const userMessage = inputValue.trim();
    setInputValue("");
    setIsLoading(true);
    setError(null);
    setStreamingOutput("");
    setActivityLog([]);
    setShowOutput(true);

    abortControllerRef.current = new AbortController();

    try {
      const systemPrompt = config.systemPrompt(cardContext);
      const fullPrompt = config.userPromptPrefix(cardContext) + userMessage;
      const prompt = `${systemPrompt}\n\n---\n\nUser request:\n${fullPrompt}`;

      const response = await fetch(`/api/cards/${cardId}/section-stream`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt, projectPath, sectionType }),
        signal: abortControllerRef.current.signal,
      });

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      if (!response.body) {
        throw new Error("No response body");
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let fullOutput = "";

      while (true) {
        const { done, value } = await reader.read();

        if (done) {
          if (fullOutput.trim()) {
            const html = marked.parse(fullOutput.trim()) as string;
            onUpdate(html);
          }
          break;
        }

        buffer += decoder.decode(value, { stream: true });
        const messages = buffer.split("\n\n");
        buffer = messages.pop() || "";

        for (const message of messages) {
          if (!message.trim()) continue;

          const match = message.match(/^data:\s*(.+)$/m);
          if (match) {
            try {
              const event = JSON.parse(match[1]);

              switch (event.type) {
                case "text":
                  fullOutput += event.data;
                  setStreamingOutput(fullOutput);
                  break;
                case "thinking":
                  addActivity("thinking", event.data);
                  break;
                case "tool_use":
                  addActivity("tool_use", `Using: ${event.data.name}`);
                  break;
                case "tool_result":
                  addActivity("tool_result", `Result from: ${event.data.name}`);
                  break;
                case "error":
                  setError(event.data);
                  break;
              }
            } catch {
              // Invalid JSON, skip
            }
          }
        }
      }
    } catch (err) {
      if (err instanceof Error && err.name === "AbortError") {
        // Request was aborted
      } else {
        const errorMsg = err instanceof Error ? err.message : "Failed to get AI response";
        setError(errorMsg);
      }
    } finally {
      setIsLoading(false);
      abortControllerRef.current = null;
    }
  };

  const handleCancel = () => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
    }
    setIsLoading(false);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    }
    if (e.key === "Escape") {
      e.stopPropagation();
      if (isLoading) {
        handleCancel();
      }
    }
  };

  const handleClear = () => {
    setStreamingOutput("");
    setActivityLog([]);
    setShowOutput(false);
    setError(null);
  };

  return (
    <div className="mt-3 space-y-2">
      {/* Input row */}
      <div className="flex items-center gap-2">
        <div className="relative flex-1">
          <Input
            value={inputValue}
            onChange={(e) => setInputValue(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={config.placeholder}
            disabled={isLoading}
            className="h-9 pr-10 text-sm bg-surface border-border/50 focus:border-accent"
          />
          {isLoading && (
            <div className="absolute right-3 top-1/2 -translate-y-1/2">
              <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
            </div>
          )}
        </div>
        {isLoading ? (
          <Button
            size="sm"
            variant="outline"
            onClick={handleCancel}
            className="h-9 px-3 border-red-500/50 text-red-500 hover:bg-red-500/10"
          >
            <X className="h-4 w-4" />
          </Button>
        ) : (
          <Button
            size="sm"
            onClick={handleSubmit}
            disabled={!inputValue.trim()}
            className="h-9 px-3 bg-ink text-background hover:bg-ink/90 border border-ink disabled:opacity-40"
          >
            <Send className="h-4 w-4" />
          </Button>
        )}
      </div>

      {/* Activity log (thinking/tools) - Always visible when loading */}
      {isLoading && activityLog.length > 0 && (
        <div
          ref={activityRef}
          className="max-h-[120px] overflow-y-auto rounded-lg border border-ink bg-paper-cream p-3 space-y-1.5"
        >
          <div className="flex items-center gap-2 text-xs font-semibold text-ink mb-2">
            <Brain className="h-4 w-4 animate-spin" />
            <span>Claude is thinking...</span>
          </div>
          {activityLog.slice(-5).map((entry, i) => (
            <div key={i} className="flex items-start gap-2 text-xs">
              {entry.type === "thinking" && (
                <>
                  <Brain className="h-3 w-3 mt-0.5 text-ink flex-shrink-0" />
                  <span className="text-[#3f3f46] italic">{truncate(entry.content, 200)}</span>
                </>
              )}
              {entry.type === "tool_use" && (
                <>
                  <Wrench className="h-3 w-3 mt-0.5 text-ink flex-shrink-0" />
                  <span className="text-ink font-medium">{entry.content}</span>
                </>
              )}
              {entry.type === "tool_result" && (
                <>
                  <Wrench className="h-3 w-3 mt-0.5 text-green-600 dark:text-green-400 flex-shrink-0" />
                  <span className="text-green-700 dark:text-green-200">{entry.content}</span>
                </>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Streaming output area with markdown */}
      {showOutput && (streamingOutput || error) && (
        <div className="rounded-lg border border-border/50 bg-background/50 overflow-hidden">
          <div className="flex items-center justify-between px-3 py-1.5 border-b border-border/50 bg-surface/50">
            <span className="text-xs text-muted-foreground">
              {isLoading ? "AI is responding..." : "AI Response"}
            </span>
            <div className="flex items-center gap-1">
              {!isLoading && (
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={handleClear}
                  className="h-6 px-2 text-xs text-muted-foreground hover:text-foreground"
                >
                  Clear
                </Button>
              )}
              <Button
                size="sm"
                variant="ghost"
                onClick={() => !isLoading && setShowOutput(!showOutput)}
                disabled={isLoading}
                className="h-6 w-6 p-0 text-muted-foreground hover:text-foreground disabled:opacity-50"
              >
                {showOutput ? (
                  <ChevronUp className="h-3 w-3" />
                ) : (
                  <ChevronDown className="h-3 w-3" />
                )}
              </Button>
            </div>
          </div>
          <div
            ref={outputRef}
            className="max-h-[200px] overflow-y-auto p-3 text-sm text-foreground/90 prose prose-sm dark:prose-invert prose-p:my-1 prose-headings:my-2 prose-ul:my-1 prose-li:my-0 max-w-none"
          >
            {error ? (
              <span className="text-red-500">{error}</span>
            ) : (
              <ReactMarkdown>{streamingOutput}</ReactMarkdown>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
