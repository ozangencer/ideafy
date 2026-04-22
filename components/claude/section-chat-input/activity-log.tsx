import { useEffect, useRef } from "react";
import { Brain, Wrench } from "lucide-react";
import { ActivityEntry } from "./use-section-stream";
import { truncate } from "./section-config";

interface ActivityLogProps {
  entries: ActivityEntry[];
}

/** Thinking / tool-use strip shown above the output panel while streaming. */
export function ActivityLog({ entries }: ActivityLogProps) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (ref.current && entries.length > 0) {
      ref.current.scrollTop = ref.current.scrollHeight;
    }
  }, [entries]);

  if (entries.length === 0) return null;

  return (
    <div
      ref={ref}
      className="max-h-[120px] overflow-y-auto rounded-lg border border-ink bg-paper-cream p-3 space-y-1.5"
    >
      <div className="flex items-center gap-2 text-xs font-semibold text-ink mb-2">
        <Brain className="h-4 w-4 animate-spin" />
        <span>Claude is thinking...</span>
      </div>
      {entries.slice(-5).map((entry, i) => (
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
  );
}
