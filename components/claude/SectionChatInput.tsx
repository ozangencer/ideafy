"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Loader2, Send, X } from "lucide-react";
import { SectionType } from "@/lib/types";
import { CardContext, SECTION_CONFIG } from "./section-chat-input/section-config";
import { useSectionStream } from "./section-chat-input/use-section-stream";
import { ActivityLog } from "./section-chat-input/activity-log";
import { OutputPanel } from "./section-chat-input/output-panel";

// Back-compat re-export — nothing currently imports this from here but the
// public barrel shape is preserved.
export type { SectionType };

interface SectionChatInputProps {
  cardId: string;
  sectionType: SectionType;
  cardContext: CardContext;
  projectPath: string;
  onUpdate: (newValue: string) => void;
}

export function SectionChatInput({
  cardId,
  sectionType,
  cardContext,
  projectPath,
  onUpdate,
}: SectionChatInputProps) {
  const [inputValue, setInputValue] = useState("");
  const [showOutput, setShowOutput] = useState(false);

  const {
    isLoading,
    streamingOutput,
    activityLog,
    error,
    submit,
    cancel,
    clear,
  } = useSectionStream({ cardId, sectionType, cardContext, projectPath, onUpdate });

  const config = SECTION_CONFIG[sectionType];

  const handleSubmit = async () => {
    if (!inputValue.trim() || isLoading) return;
    const message = inputValue.trim();
    setInputValue("");
    setShowOutput(true);
    await submit(message);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    }
    if (e.key === "Escape") {
      e.stopPropagation();
      if (isLoading) cancel();
    }
  };

  const handleClear = () => {
    clear();
    setShowOutput(false);
  };

  return (
    <div className="mt-3 space-y-2">
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
            onClick={cancel}
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

      {isLoading && <ActivityLog entries={activityLog} />}

      <OutputPanel
        isLoading={isLoading}
        content={streamingOutput}
        error={error}
        visible={showOutput}
        onToggle={() => !isLoading && setShowOutput(!showOutput)}
        onClear={handleClear}
      />
    </div>
  );
}
