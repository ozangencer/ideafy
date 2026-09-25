"use client";

import { useEffect, useRef, useState } from "react";
import DOMPurify from "isomorphic-dompurify";
import { Loader2, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { stripHtml } from "@/lib/prompts/utils";

interface EnrichButtonProps {
  /** Saved card: the server reads project and platform off its row. */
  cardId?: string;
  /** Draft card (no row yet): the form's project and platform go in the body. */
  projectId?: string | null;
  aiPlatform?: string | null;
  value: string;
  onChange: (next: string) => void;
}

interface PreviewState {
  enrichedHtml: string;
  projectFileLabel: string;
  memoryFileLabel: string | null;
  hadProjectFile: boolean;
  hadMemoryFile: boolean;
  warning: string | null;
}

export function EnrichButton({ cardId, projectId, aiPlatform, value, onChange }: EnrichButtonProps) {
  const [loading, setLoading] = useState(false);
  const [preview, setPreview] = useState<PreviewState | null>(null);
  const controllerRef = useRef<AbortController | null>(null);
  const { toast } = useToast();

  const plainLength = stripHtml(value).trim().length;
  const missingProject = !cardId && !projectId;
  const disabled = loading || plainLength < 3 || missingProject;

  useEffect(() => () => controllerRef.current?.abort(), []);

  async function handleEnrich() {
    const ac = new AbortController();
    controllerRef.current = ac;
    setLoading(true);
    try {
      const res = await fetch(cardId ? `/api/cards/${cardId}/enrich` : "/api/enrich", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(
          cardId ? { currentValue: value } : { currentValue: value, projectId, aiPlatform }
        ),
        signal: ac.signal,
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || "Enrich failed");
      setPreview({
        enrichedHtml: data.enrichedHtml || "",
        projectFileLabel: data.sources?.projectFileLabel || "project file",
        memoryFileLabel: data.sources?.memoryFileLabel || null,
        hadProjectFile: !!data.sources?.projectFile,
        hadMemoryFile: !!data.sources?.memoryFile,
        warning: data.warning || null,
      });
    } catch (e) {
      if ((e as Error).name === "AbortError") return;
      toast({
        title: "Enrich failed",
        description: e instanceof Error ? e.message : String(e),
        variant: "destructive",
      });
    } finally {
      setLoading(false);
      controllerRef.current = null;
    }
  }

  function handleCancel() {
    controllerRef.current?.abort();
  }

  function handleAccept() {
    if (preview) onChange(preview.enrichedHtml);
    setPreview(null);
  }

  function handleReject() {
    setPreview(null);
  }

  return (
    <>
      <div className="flex items-center justify-end gap-2 px-1 pb-1">
        {loading ? (
          <Button size="sm" variant="ghost" onClick={handleCancel}>
            <Loader2 className="size-3 animate-spin mr-1" /> Cancel
          </Button>
        ) : (
          // The title sits on a wrapper: a disabled Button drops pointer
          // events, so its own title would never show when it matters most.
          <span
            title={
              missingProject
                ? "Select a project first"
                : plainLength < 3
                ? "Type at least a few characters first"
                : "Expand this description with project context"
            }
          >
            <Button size="sm" variant="ghost" onClick={handleEnrich} disabled={disabled}>
              <Sparkles className="size-3 mr-1" />
              Enrich description
            </Button>
          </span>
        )}
      </div>

      <Dialog open={preview !== null} onOpenChange={(open) => !open && handleReject()}>
        <DialogContent className="max-w-4xl">
          <DialogHeader>
            <DialogTitle>Review enriched description</DialogTitle>
          </DialogHeader>

          {preview && (
            <>
              <div className="grid grid-cols-2 gap-4 max-h-[60vh] overflow-hidden">
                <PreviewColumn label="Current" html={value} />
                <PreviewColumn label="Enriched" html={preview.enrichedHtml} />
              </div>
              <p className="text-xs text-muted-foreground">
                Sources used:{" "}
                {preview.hadProjectFile || preview.hadMemoryFile
                  ? [
                      preview.hadProjectFile && preview.projectFileLabel,
                      preview.hadMemoryFile && preview.memoryFileLabel,
                    ]
                      .filter(Boolean)
                      .join(", ")
                  : "no project context found (model used the description alone)"}
              </p>
              {preview.warning && (
                <p className="text-xs text-amber-600 dark:text-amber-400">{preview.warning}</p>
              )}
            </>
          )}

          <DialogFooter>
            <Button variant="ghost" onClick={handleReject}>
              Reject
            </Button>
            <Button onClick={handleAccept}>Accept</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

function PreviewColumn({ label, html }: { label: string; html: string }) {
  const sanitized = html ? DOMPurify.sanitize(html) : "";
  return (
    <div className="flex flex-col min-h-0 border border-border rounded-md overflow-hidden">
      <div className="text-xs font-medium px-3 py-2 border-b border-border bg-muted/50">
        {label}
      </div>
      <div className="flex-1 overflow-y-auto p-3 prose-kanban">
        {sanitized ? (
          <div dangerouslySetInnerHTML={{ __html: sanitized }} />
        ) : (
          <p className="text-muted-foreground text-sm">No content</p>
        )}
      </div>
    </div>
  );
}
