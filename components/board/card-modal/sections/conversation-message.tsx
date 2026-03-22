"use client";

import { useState } from "react";
import { ConversationMessage as Message, ToolCall, SectionType } from "@/lib/types";
import { Brain, Wrench, User, Loader2, ArrowUpToLine } from "lucide-react";
import { Button } from "@/components/ui/button";
import ReactMarkdown from "react-markdown";
import rehypeRaw from "rehype-raw";
import remarkGfm from "remark-gfm";
import DOMPurify from "isomorphic-dompurify";

// Tool ismini gruba çevir
function getToolGroup(name: string): string {
  if (name.startsWith("mcp__")) {
    // mcp__ideafy__get_card → ideafy
    const parts = name.split("__");
    return parts[1] || name;
  }
  return name; // Bash, Read, Write vs.
}

// Tool'ları grupla ve say
function groupToolCalls(toolCalls: ToolCall[]): Map<string, number> {
  const groups = new Map<string, number>();
  for (const tool of toolCalls) {
    const group = getToolGroup(tool.name);
    groups.set(group, (groups.get(group) || 0) + 1);
  }
  return groups;
}

// Check if tool calls include a save/update tool that persists to the card
function hadPersistToolCall(toolCalls?: ToolCall[]): boolean {
  if (!toolCalls || toolCalls.length === 0) return false;
  const persistTools = ["save_plan", "save_tests", "save_opinion", "update_card"];
  return toolCalls.some((t) =>
    persistTools.some((pt) => t.name.includes(pt))
  );
}

// Map section type to card field name for the API
const SECTION_FIELD_MAP: Record<SectionType, string> = {
  solution: "solutionSummary",
  detail: "description",
  opinion: "aiOpinion",
  tests: "testScenarios",
};

// Human-readable labels for the apply button
const SECTION_APPLY_LABEL: Record<SectionType, string> = {
  solution: "Apply to Solution",
  detail: "Apply to Detail",
  opinion: "Apply to AI Opinion",
  tests: "Apply to Tests",
};

interface ConversationMessageProps {
  message: Message;
  cardId?: string;
  sectionType?: SectionType;
  onApplied?: () => void;
}

export function ConversationMessage({ message, cardId, sectionType, onApplied }: ConversationMessageProps) {
  const isUser = message.role === "user";
  const isStreaming = message.isStreaming;
  const [isApplying, setIsApplying] = useState(false);
  const [applied, setApplied] = useState(false);

  // Show "Apply" button when: assistant message, not streaming, has content, no persist tool was called
  const showApplyButton =
    !isUser &&
    !isStreaming &&
    message.content?.trim() &&
    cardId &&
    sectionType &&
    !hadPersistToolCall(message.toolCalls);

  const handleApply = async () => {
    if (!cardId || !sectionType) return;
    setIsApplying(true);
    try {
      const field = SECTION_FIELD_MAP[sectionType];
      const res = await fetch(`/api/cards/${cardId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ [field]: message.content }),
      });
      if (res.ok) {
        setApplied(true);
        onApplied?.();
      }
    } catch (error) {
      console.error("Failed to apply message to section:", error);
    } finally {
      setIsApplying(false);
    }
  };

  // Check if content contains HTML img tags
  const hasHtmlImages = message.content?.includes("<img ");

  // Render HTML content directly for messages with images
  const renderContent = () => {
    if (isStreaming && !message.content && !message.activeToolCall) {
      return (
        <div className="flex items-center gap-2 text-muted-foreground">
          <Loader2 className="w-3 h-3 animate-spin" />
          <span>Thinking...</span>
        </div>
      );
    }

    // For user messages with images, render sanitized HTML
    if (isUser && hasHtmlImages) {
      const sanitized = DOMPurify.sanitize(message.content, {
        ALLOWED_TAGS: ["img", "p", "br", "strong", "em", "a", "span", "div"],
        ALLOWED_ATTR: ["src", "alt", "class", "href", "style", "width", "height"],
      });
      return (
        <div
          className="message-html-content"
          dangerouslySetInnerHTML={{ __html: sanitized }}
        />
      );
    }

    // For other messages, use ReactMarkdown
    return (
      <ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeRaw]}>
        {message.content}
      </ReactMarkdown>
    );
  };

  return (
    <div
      className={`flex gap-3 ${isUser ? "flex-row-reverse" : "flex-row"}`}
    >
      {/* Avatar */}
      <div
        className={`flex-shrink-0 w-7 h-7 rounded-full flex items-center justify-center ${
          isUser
            ? "bg-accent/20 text-accent"
            : "bg-purple-500/20 text-purple-400"
        }`}
      >
        {isUser ? (
          <User className="w-4 h-4" />
        ) : (
          <Brain className={`w-4 h-4 ${isStreaming ? "animate-pulse" : ""}`} />
        )}
      </div>

      {/* Content */}
      <div
        className={`flex-1 max-w-[85%] rounded-lg px-3 py-2 ${
          isUser
            ? "bg-accent/10 text-foreground"
            : "bg-surface border border-border/50"
        }`}
      >
        {/* Message content */}
        <div className="prose prose-sm dark:prose-invert prose-p:my-1 prose-headings:my-2 prose-ul:my-1 prose-li:my-0 max-w-none text-sm">
          {renderContent()}
        </div>

        {/* Active tool call indicator (streaming) */}
        {isStreaming && message.activeToolCall && (
          <div className="mt-2 pt-2 border-t border-border/50">
            <span className="inline-flex items-center gap-1.5 text-xs px-2 py-1 rounded bg-amber-500/10 text-amber-400">
              {message.activeToolCall.status === "running" ? (
                <Loader2 className="w-3 h-3 animate-spin" />
              ) : (
                <Wrench className="w-3 h-3" />
              )}
              {getToolGroup(message.activeToolCall.name)}
              {message.activeToolCall.status === "running" && "..."}
            </span>
          </div>
        )}

        {/* Tool calls indicator - grouped */}
        {message.toolCalls && message.toolCalls.length > 0 && (
          <div className="mt-2 pt-2 border-t border-border/50">
            <div className="flex flex-wrap gap-1">
              {Array.from(groupToolCalls(message.toolCalls)).map(([group, count]) => (
                <span
                  key={group}
                  className="inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded bg-blue-500/10 text-blue-400"
                >
                  <Wrench className="w-3 h-3" />
                  {group}: {count}
                </span>
              ))}
            </div>
          </div>
        )}

        {/* Mentions indicator */}
        {message.mentions && message.mentions.length > 0 && (
          <div className="mt-2 pt-2 border-t border-border/50 flex flex-wrap gap-1">
            {message.mentions.map((mention, i) => (
              <span
                key={i}
                className={`text-xs px-1.5 py-0.5 rounded font-mono ${
                  mention.type === "skill"
                    ? "bg-primary/20 text-primary"
                    : mention.type === "mcp"
                    ? "bg-blue-500/20 text-blue-400"
                    : mention.type === "card"
                    ? "bg-emerald-500/20 text-emerald-400"
                    : "bg-cyan-500/20 text-cyan-400"
                }`}
              >
                {mention.type === "skill" && "/"}
                {mention.type === "mcp" && "/"}
                {mention.type === "card" && "["}
                {mention.type === "document" && "#"}
                {mention.label}
                {mention.type === "card" && "]"}
              </span>
            ))}
          </div>
        )}

        {/* Apply to section button */}
        {showApplyButton && (
          <div className="mt-2 pt-2 border-t border-border/50">
            <Button
              variant="ghost"
              size="sm"
              onClick={handleApply}
              disabled={isApplying || applied}
              className={`h-6 px-2 text-xs ${
                applied
                  ? "text-green-400"
                  : "text-accent hover:text-accent hover:bg-accent/10"
              }`}
            >
              {isApplying ? (
                <Loader2 className="w-3 h-3 mr-1 animate-spin" />
              ) : (
                <ArrowUpToLine className="w-3 h-3 mr-1" />
              )}
              {applied ? "Applied" : SECTION_APPLY_LABEL[sectionType!]}
            </Button>
          </div>
        )}

        {/* Timestamp */}
        <div
          className={`text-[10px] mt-1.5 ${
            isUser ? "text-right" : "text-left"
          } text-muted-foreground/60`}
        >
          {new Date(message.createdAt).toLocaleTimeString([], {
            hour: "2-digit",
            minute: "2-digit",
          })}
        </div>
      </div>
    </div>
  );
}
