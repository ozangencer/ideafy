"use client";

import { useRef, useEffect, useCallback, useState } from "react";
import { ConversationMessage as Message, SectionType, SECTION_CONFIG } from "@/lib/types";
import { ConversationMessage } from "./conversation-message";
import { ConversationInput } from "./conversation-input";
import { MessageSquare, Trash2, Terminal, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";

interface ConversationPanelProps {
  cardId: string;
  sectionType: SectionType;
  messages: Message[];
  isLoading: boolean;
  isBackgroundProcessing: boolean;
  streamingMessage: Message | null;
  projectPath: string;
  projectId: string | null;
  testScenarios?: string;
  onSendMessage: (content: string, mentions: Message["mentions"]) => void;
  onClearHistory: () => void;
  onCancel?: () => void;
}

export function ConversationPanel({
  cardId,
  sectionType,
  messages,
  isLoading,
  isBackgroundProcessing,
  streamingMessage,
  projectPath,
  projectId,
  testScenarios,
  onSendMessage,
  onClearHistory,
  onCancel,
}: ConversationPanelProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const prevMessageCountRef = useRef(messages.length);
  const userScrolledUpRef = useRef(false);
  const config = SECTION_CONFIG[sectionType];
  const { toast } = useToast();
  const [isGeneratingTests, setIsGeneratingTests] = useState(false);

  // Check if testScenarios has content (strip HTML tags)
  const hasTestScenarios = testScenarios && testScenarios.replace(/<[^>]*>/g, "").trim().length > 0;

  // Handle generate tests button click
  const handleGenerateTests = async () => {
    setIsGeneratingTests(true);
    try {
      const response = await fetch(`/api/cards/${cardId}/generate-tests`, {
        method: "POST",
      });

      const data = await response.json();

      if (!response.ok) {
        toast({
          variant: "destructive",
          title: "Failed to Generate Tests",
          description: data.error || "Could not open terminal",
        });
        return;
      }

      toast({
        title: "Terminal Opened",
        description: data.message || "Claude Code is generating tests",
      });
    } catch (error) {
      toast({
        variant: "destructive",
        title: "Error",
        description: error instanceof Error ? error.message : "Failed to generate tests",
      });
    } finally {
      setIsGeneratingTests(false);
    }
  };

  // Check if user scrolled up from bottom
  const handleScroll = useCallback(() => {
    if (!scrollRef.current) return;
    const { scrollTop, scrollHeight, clientHeight } = scrollRef.current;
    // Consider "at bottom" if within 50px of the bottom
    userScrolledUpRef.current = scrollHeight - scrollTop - clientHeight > 50;
  }, []);

  // Auto-scroll to bottom only when new messages arrive and user is at bottom
  useEffect(() => {
    const messageCount = messages.length;
    const isNewMessage = messageCount > prevMessageCountRef.current;
    prevMessageCountRef.current = messageCount;

    // Scroll if: new message added, streaming, or user hasn't scrolled up
    if (scrollRef.current && (isNewMessage || streamingMessage) && !userScrolledUpRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages, streamingMessage]);

  // Build message list with streaming or background processing indicator
  const allMessages = (() => {
    if (streamingMessage) {
      return [...messages, streamingMessage];
    }
    // Show a "thinking" placeholder when process runs in background without active stream
    if (isBackgroundProcessing && !isLoading) {
      const backgroundPlaceholder: Message = {
        id: "background-processing",
        cardId,
        sectionType,
        role: "assistant",
        content: "",
        mentions: [],
        createdAt: new Date().toISOString(),
        isStreaming: true, // This will show "Thinking..." in ConversationMessage
      };
      return [...messages, backgroundPlaceholder];
    }
    return messages;
  })();

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
        <div className="flex items-center gap-2">
          {/* Generate Tests button - only show on tests tab when scenarios exist */}
          {sectionType === "tests" && hasTestScenarios && (
            <Button
              variant="outline"
              size="sm"
              onClick={handleGenerateTests}
              disabled={isGeneratingTests}
              className="h-6 px-2 text-xs border-green-500/50 text-green-500 hover:bg-green-500/10"
            >
              {isGeneratingTests ? (
                <Loader2 className="w-3 h-3 mr-1 animate-spin" />
              ) : (
                <Terminal className="w-3 h-3 mr-1" />
              )}
              Generate Tests
            </Button>
          )}
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
      </div>

      {/* Messages */}
      <div
        ref={scrollRef}
        onScroll={handleScroll}
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
