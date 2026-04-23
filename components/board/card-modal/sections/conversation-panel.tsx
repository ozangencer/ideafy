"use client";

import { useEffect, useRef, useState } from "react";
import { ConversationMessage as Message, SectionType, SECTION_CONFIG } from "@/lib/types";
import { ConversationMessage } from "./conversation-message";
import { ConversationInput } from "./conversation-input";
import { MessageSquare, Trash2, Terminal, Loader2, SquareTerminal } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useToast } from "@/hooks/use-toast";
import { useKanbanStore } from "@/lib/store";
import { parseTestScenarios } from "./conversation-panel/parse-test-scenarios";
import { useAutoScrollToBottom } from "./conversation-panel/use-auto-scroll-to-bottom";
import {
  DialogScenario,
  TestScenarioDialog,
} from "./conversation-panel/test-scenario-dialog";

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
  projectPath: _projectPath,
  projectId,
  testScenarios,
  onSendMessage,
  onClearHistory,
  onCancel,
}: ConversationPanelProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const config = SECTION_CONFIG[sectionType];
  const { toast } = useToast();

  const [isGeneratingTests, setIsGeneratingTests] = useState(false);
  const [isResumingCli, setIsResumingCli] = useState(false);
  const [showTestDialog, setShowTestDialog] = useState(false);
  const [initialDialogScenarios, setInitialDialogScenarios] = useState<DialogScenario[]>([]);

  const conversationError = useKanbanStore((s) => s.conversationError);
  const setConversationError = useKanbanStore((s) => s.setConversationError);

  // Surface conversation errors via toast, then clear them so repeated views
  // don't replay the same message.
  useEffect(() => {
    if (conversationError) {
      toast({
        variant: "destructive",
        title: "Chat Error",
        description: conversationError,
      });
      setConversationError(null);
    }
  }, [conversationError, toast, setConversationError]);

  const hasTestScenarios =
    testScenarios && testScenarios.replace(/<[^>]*>/g, "").trim().length > 0;

  const openTestDialog = () => {
    if (!testScenarios) return;
    const items = parseTestScenarios(testScenarios);
    // Invert checked state: a scenario that is already checked (manually
    // tested) starts unselected, while an unchecked one starts selected.
    setInitialDialogScenarios(
      items.map((item) => ({ text: item.text, group: item.group, selected: !item.checked })),
    );
    setShowTestDialog(true);
  };

  const handleGenerateTests = async (selectedTexts: string[]) => {
    if (selectedTexts.length === 0) return;
    setShowTestDialog(false);
    setIsGeneratingTests(true);
    try {
      const response = await fetch(`/api/cards/${cardId}/generate-tests`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ selectedScenarios: selectedTexts }),
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
        description: data.message || `Generating tests for ${selectedTexts.length} scenario(s)`,
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

  const handleResumeCli = async () => {
    setIsResumingCli(true);
    try {
      const response = await fetch(`/api/cards/${cardId}/resume-cli`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sectionType }),
      });
      const data = await response.json();
      if (!response.ok) {
        toast({ variant: "destructive", title: "Resume Failed", description: data.error });
        return;
      }
      toast({ title: "Terminal Opened", description: data.message });
    } catch (error) {
      toast({
        variant: "destructive",
        title: "Error",
        description: error instanceof Error ? error.message : "Failed to resume",
      });
    } finally {
      setIsResumingCli(false);
    }
  };

  const { handleScroll } = useAutoScrollToBottom(scrollRef, {
    messageCount: messages.length,
    isStreaming: !!streamingMessage,
  });

  // Build the message list shown in the scroll area: append a streaming
  // message if one is active, or a "thinking…" placeholder when the card is
  // processing in the background without an open stream.
  const allMessages = (() => {
    if (streamingMessage) {
      return [...messages, streamingMessage];
    }
    if (isBackgroundProcessing && !isLoading) {
      const backgroundPlaceholder: Message = {
        id: "background-processing",
        cardId,
        sectionType,
        role: "assistant",
        content: "",
        mentions: [],
        createdAt: new Date().toISOString(),
        isStreaming: true,
      };
      return [...messages, backgroundPlaceholder];
    }
    return messages;
  })();

  return (
    <div className="flex flex-col h-full bg-background/50">
      {/* Header - pr-10 to account for split panel toggle button */}
      <div className="flex items-center justify-between px-3 sm:pr-10 py-2 border-b border-border/50 bg-surface/50">
        <div className="hidden sm:flex items-center gap-2">
          <MessageSquare className="w-4 h-4 text-muted-foreground" />
          <span className="text-sm font-medium text-muted-foreground">Chat</span>
          {messages.length > 0 && (
            <span className="text-xs text-muted-foreground/60">
              ({messages.length})
            </span>
          )}
        </div>
        <div className="sm:hidden flex items-center gap-2">
          {messages.length > 0 && (
            <span className="text-xs text-muted-foreground/60">
              {messages.length} message{messages.length !== 1 ? "s" : ""}
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          {/* Generate Tests button - only show on tests tab when scenarios exist */}
          {sectionType === "tests" && hasTestScenarios && (
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={openTestDialog}
                  disabled={isGeneratingTests}
                  className="h-6 w-6 p-0 text-ink hover:bg-paper-cream hover:text-ink"
                >
                  {isGeneratingTests ? (
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  ) : (
                    <Terminal className="w-3.5 h-3.5" />
                  )}
                </Button>
              </TooltipTrigger>
              <TooltipContent side="bottom">Generate Tests</TooltipContent>
            </Tooltip>
          )}
          {messages.length > 0 && (
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={handleResumeCli}
                  disabled={isResumingCli}
                  className="h-6 w-6 p-0 text-ink hover:bg-paper-cream hover:text-ink"
                >
                  {isResumingCli ? (
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  ) : (
                    <SquareTerminal className="w-3.5 h-3.5" />
                  )}
                </Button>
              </TooltipTrigger>
              <TooltipContent side="bottom">Resume in CLI</TooltipContent>
            </Tooltip>
          )}
          {messages.length > 0 && (
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={onClearHistory}
                  className="h-6 w-6 p-0 text-muted-foreground hover:text-destructive"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </Button>
              </TooltipTrigger>
              <TooltipContent side="bottom">Clear</TooltipContent>
            </Tooltip>
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
            <p className="text-sm text-muted-foreground/60">No messages yet</p>
            <p className="text-xs text-muted-foreground/40 mt-1 max-w-[200px]">
              Ask Claude about this {config.label.toLowerCase()}
            </p>
          </div>
        ) : (
          allMessages.map((message) => (
            <ConversationMessage
              key={message.id}
              message={message}
              cardId={cardId}
              sectionType={sectionType}
              onApplied={() => {
                // Refresh cards to pick up the updated field.
                useKanbanStore.getState().fetchCards();
              }}
            />
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

      <TestScenarioDialog
        open={showTestDialog}
        onOpenChange={setShowTestDialog}
        initialScenarios={initialDialogScenarios}
        onGenerate={handleGenerateTests}
      />
    </div>
  );
}
