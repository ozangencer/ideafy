"use client";

import { useRef, useEffect } from "react";
import { ConversationMessage as Message, SectionType, SECTION_CONFIG } from "@/lib/types";
import { ConversationMessage } from "./conversation-message";
import { ConversationInput } from "./conversation-input";
import { MessageSquare, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";

interface ConversationPanelProps {
  cardId: string;
  sectionType: SectionType;
  messages: Message[];
  isLoading: boolean;
  streamingMessage: Message | null;
  projectPath: string;
  projectId: string | null;
  onSendMessage: (content: string, mentions: Message["mentions"]) => void;
  onClearHistory: () => void;
  onCancel?: () => void;
}

export function ConversationPanel({
  cardId,
  sectionType,
  messages,
  isLoading,
  streamingMessage,
  projectPath,
  projectId,
  onSendMessage,
  onClearHistory,
  onCancel,
}: ConversationPanelProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const config = SECTION_CONFIG[sectionType];

  // Auto-scroll to bottom when new messages arrive
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages, streamingMessage]);

  const allMessages = streamingMessage
    ? [...messages, streamingMessage]
    : messages;

  return (
    <div className="flex flex-col h-full bg-background/50">
      {/* Header - pr-10 to account for split panel toggle button */}
      <div className="flex items-center justify-between px-3 pr-10 py-2 border-b border-border/50 bg-surface/50">
        <div className="flex items-center gap-2">
          <MessageSquare className="w-4 h-4 text-muted-foreground" />
          <span className="text-sm font-medium text-muted-foreground">Chat</span>
          {messages.length > 0 && (
            <span className="text-xs text-muted-foreground/60">
              ({messages.length})
            </span>
          )}
        </div>
        {messages.length > 0 && (
          <Button
            variant="ghost"
            size="sm"
            onClick={onClearHistory}
            className="h-6 px-2 text-xs text-muted-foreground hover:text-destructive"
          >
            <Trash2 className="w-3 h-3 mr-1" />
            Clear
          </Button>
        )}
      </div>

      {/* Messages */}
      <div
        ref={scrollRef}
        className="flex-1 overflow-y-auto p-3 space-y-3"
      >
        {allMessages.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-center py-8">
            <MessageSquare className="w-8 h-8 text-muted-foreground/30 mb-2" />
            <p className="text-sm text-muted-foreground/60">
              No messages yet
            </p>
            <p className="text-xs text-muted-foreground/40 mt-1 max-w-[200px]">
              Ask Claude about this {config.label.toLowerCase()}
            </p>
          </div>
        ) : (
          allMessages.map((message) => (
            <ConversationMessage key={message.id} message={message} />
          ))
        )}
      </div>

      {/* Input */}
      <div className="border-t border-border/50 p-3 bg-surface/30">
        <ConversationInput
          cardId={cardId}
          sectionType={sectionType}
          projectId={projectId}
          isLoading={isLoading}
          onSend={onSendMessage}
          onCancel={onCancel}
          placeholder={config.chatPlaceholder}
        />
      </div>
    </div>
  );
}
