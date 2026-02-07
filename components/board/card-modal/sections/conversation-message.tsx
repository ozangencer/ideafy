"use client";

import { ConversationMessage as Message, ToolCall } from "@/lib/types";
import { Brain, Wrench, User, Loader2 } from "lucide-react";
import ReactMarkdown from "react-markdown";
import rehypeRaw from "rehype-raw";
import remarkGfm from "remark-gfm";
import DOMPurify from "isomorphic-dompurify";

// Tool ismini gruba çevir
function getToolGroup(name: string): string {
  if (name.startsWith("mcp__")) {
    // mcp__kanban__get_card → kanban
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

interface ConversationMessageProps {
  message: Message;
}

export function ConversationMessage({ message }: ConversationMessageProps) {
  const isUser = message.role === "user";
  const isStreaming = message.isStreaming;

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
