"use client";

import { useRef, useEffect, useCallback, useState } from "react";
import { ConversationMessage as Message, SectionType, SECTION_CONFIG } from "@/lib/types";
import { ConversationMessage } from "./conversation-message";
import { ConversationInput } from "./conversation-input";
import { MessageSquare, Trash2, Terminal, Loader2, SquareTerminal } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogDescription,
} from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { useKanbanStore } from "@/lib/store";

/** Parse TipTap taskList HTML into individual scenario items (only taskItems, not headings) */
function parseTestScenarios(html: string): { text: string; group: string; checked: boolean }[] {
  const items: { text: string; group: string; checked: boolean }[] = [];
  let currentGroup = "";

  // Collect heading positions
  const headingRegex = /<h[1-6][^>]*>([\s\S]*?)<\/h[1-6]>/g;
  const headings = new Map<number, string>();
  let hMatch;
  while ((hMatch = headingRegex.exec(html)) !== null) {
    headings.set(hMatch.index, hMatch[1].replace(/<[^>]*>/g, "").trim());
  }

  // Find all taskItems
  const liRegex = /<li([^>]*)data-type="taskItem"([^>]*)>([\s\S]*?)<\/li>/g;
  let match;
  while ((match = liRegex.exec(html)) !== null) {
    for (const [pos, title] of Array.from(headings)) {
      if (pos < match.index) currentGroup = title;
    }
    // data-checked can be in either attribute group
    const attrs = match[1] + match[2];
    const checked = attrs.includes('data-checked="true"');
    const text = match[3].replace(/<[^>]*>/g, "").trim();
    if (text) {
      items.push({ text, group: currentGroup, checked });
    }
  }
  return items;
}

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
  const [isResumingCli, setIsResumingCli] = useState(false);
  const conversationError = useKanbanStore((s) => s.conversationError);
  const setConversationError = useKanbanStore((s) => s.setConversationError);

  // Show toast when conversation error occurs
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

  // Check if testScenarios has content (strip HTML tags)
  const hasTestScenarios = testScenarios && testScenarios.replace(/<[^>]*>/g, "").trim().length > 0;

  // Test scenario selection dialog state
  const [showTestDialog, setShowTestDialog] = useState(false);
  const [parsedScenarios, setParsedScenarios] = useState<{ text: string; group: string; selected: boolean }[]>([]);

  const openTestDialog = () => {
    if (!testScenarios) return;
    const items = parseTestScenarios(testScenarios);
    // Invert: checked (already tested) → unselected, unchecked (needs testing) → selected
    setParsedScenarios(items.map(item => ({ text: item.text, group: item.group, selected: !item.checked })));
    setShowTestDialog(true);
  };

  const toggleScenario = (index: number) => {
    setParsedScenarios(prev =>
      prev.map((item, i) => i === index ? { ...item, selected: !item.selected } : item)
    );
  };

  const selectAll = () => setParsedScenarios(prev => prev.map(item => ({ ...item, selected: true })));
  const selectNone = () => setParsedScenarios(prev => prev.map(item => ({ ...item, selected: false })));

  // Handle generate tests with selected scenarios
  const handleGenerateTests = async () => {
    const selected = parsedScenarios.filter(s => s.selected).map(s => s.text);
    if (selected.length === 0) return;

    setShowTestDialog(false);
    setIsGeneratingTests(true);
    try {
      const response = await fetch(`/api/cards/${cardId}/generate-tests`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ selectedScenarios: selected }),
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
        description: data.message || `Generating tests for ${selected.length} scenario(s)`,
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

  // Handle resume CLI session button
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
      toast({ variant: "destructive", title: "Error", description: error instanceof Error ? error.message : "Failed to resume" });
    } finally {
      setIsResumingCli(false);
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

  // Keep pinned-to-bottom when the scroll container resizes (e.g. input bar grows
  // after image paste or Shift+Enter newlines). Without this, the latest message
  // slides out of view as clientHeight shrinks.
  useEffect(() => {
    const el = scrollRef.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(() => {
      if (!userScrolledUpRef.current && scrollRef.current) {
        scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
      }
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

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
        <div className="flex items-center gap-1">
          {sectionType === "tests" && hasTestScenarios && (
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={openTestDialog}
                  disabled={isGeneratingTests}
                  className="h-6 w-6 p-0 text-[#0a0a0a] hover:bg-[#fafaf9]"
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
                  className="h-6 w-6 p-0 text-[#0a0a0a] hover:bg-[#fafaf9]"
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
            <p className="text-sm text-muted-foreground/60">
              No messages yet
            </p>
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
                // Refresh cards to pick up the updated field
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
      {/* Test Scenario Selection Dialog */}
      <Dialog open={showTestDialog} onOpenChange={setShowTestDialog}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Select Test Scenarios</DialogTitle>
            <DialogDescription>
              Choose which scenarios to generate tests for.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-1 max-h-[300px] overflow-y-auto py-2">
            {parsedScenarios.map((scenario, index) => {
              const prevGroup = index > 0 ? parsedScenarios[index - 1].group : "";
              const showGroup = scenario.group && scenario.group !== prevGroup;
              return (
                <div key={index}>
                  {showGroup && (
                    <div className="text-xs font-medium text-muted-foreground uppercase tracking-wide px-2 pt-2 pb-1">
                      {scenario.group}
                    </div>
                  )}
                  <label className="flex items-start gap-2 px-2 py-1 rounded hover:bg-muted/50 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={scenario.selected}
                      onChange={() => toggleScenario(index)}
                      className="mt-0.5 accent-[#0a0a0a]"
                    />
                    <span className="text-sm">{scenario.text}</span>
                  </label>
                </div>
              );
            })}
          </div>
          <DialogFooter className="flex items-center justify-between sm:justify-between">
            <div className="flex gap-2">
              <Button variant="ghost" size="sm" onClick={selectAll} className="text-xs h-7">
                Select All
              </Button>
              <Button variant="ghost" size="sm" onClick={selectNone} className="text-xs h-7">
                Clear
              </Button>
            </div>
            <Button
              size="sm"
              onClick={handleGenerateTests}
              disabled={parsedScenarios.filter(s => s.selected).length === 0}
              className="bg-[#0a0a0a] text-white hover:bg-black border border-[#0a0a0a]"
            >
              <Terminal className="w-3.5 h-3.5 mr-1.5" />
              Generate ({parsedScenarios.filter(s => s.selected).length})
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
