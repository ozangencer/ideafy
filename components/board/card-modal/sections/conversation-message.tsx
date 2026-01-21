"use client";

import { ConversationMessage as Message, ToolCall } from "@/lib/types";
import { Brain, Wrench, User, Loader2 } from "lucide-react";
import ReactMarkdown from "react-markdown";
import rehypeRaw from "rehype-raw";

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
    if (isStreaming && !message.content) {
      return (
        <div className="flex items-center gap-2 text-muted-foreground">
          <Loader2 className="w-3 h-3 animate-spin" />
          <span>Thinking...</span>
        </div>
      );
    }

    // For user messages with images, render HTML directly
    if (isUser && hasHtmlImages) {
      return (
        <div
          className="message-html-content"
          dangerouslySetInnerHTML={{ __html: message.content }}
        />
      );
    }

    // For other messages, use ReactMarkdown
    return <ReactMarkdown rehypePlugins={[rehypeRaw]}>{message.content}</ReactMarkdown>;
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

        {/* Tool calls indicator */}
        {message.toolCalls && message.toolCalls.length > 0 && (
          <div className="mt-2 pt-2 border-t border-border/50">
            <div className="flex flex-wrap gap-1">
              {message.toolCalls.map((tool: ToolCall, i: number) => (
                <span
                  key={i}
                  className="inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded bg-blue-500/10 text-blue-400"
                >
                  <Wrench className="w-3 h-3" />
                  {tool.name}
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
