import { useEffect, useRef } from "react";
import ReactMarkdown from "react-markdown";
import { ChevronDown, ChevronUp } from "lucide-react";
import { Button } from "@/components/ui/button";

interface OutputPanelProps {
  isLoading: boolean;
  content: string;
  error: string | null;
  visible: boolean;
  onToggle: () => void;
  onClear: () => void;
}

/** Collapsible panel that renders the streaming AI response as markdown. */
export function OutputPanel({ isLoading, content, error, visible, onToggle, onClear }: OutputPanelProps) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (ref.current && content) {
      ref.current.scrollTop = ref.current.scrollHeight;
    }
  }, [content]);

  if (!visible || (!content && !error)) return null;

  return (
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
              onClick={onClear}
              className="h-6 px-2 text-xs text-muted-foreground hover:text-foreground"
            >
              Clear
            </Button>
          )}
          <Button
            size="sm"
            variant="ghost"
            onClick={onToggle}
            disabled={isLoading}
            className="h-6 w-6 p-0 text-muted-foreground hover:text-foreground disabled:opacity-50"
          >
            {visible ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
          </Button>
        </div>
      </div>
      <div
        ref={ref}
        className="max-h-[200px] overflow-y-auto p-3 text-sm text-foreground/90 prose prose-sm dark:prose-invert prose-p:my-1 prose-headings:my-2 prose-ul:my-1 prose-li:my-0 max-w-none"
      >
        {error ? (
          <span className="text-red-500">{error}</span>
        ) : (
          <ReactMarkdown>{content}</ReactMarkdown>
        )}
      </div>
    </div>
  );
}
