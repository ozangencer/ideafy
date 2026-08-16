"use client";

import { useCallback, useEffect, useState } from "react";
import { useKanbanStore } from "@/lib/store";
import { Project } from "@/lib/types";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Loader2, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";

interface UnpushedCommitView {
  hash: string;
  subject: string;
  date: string;
  /** Empty for the many commits that never named a card. */
  cards: { id: string; displayId: string; title: string }[];
}

interface UnpushedResponse {
  supported: boolean;
  defaultBranch: string;
  count: number;
  fetched: boolean;
  commits: UnpushedCommitView[];
}

interface UnpushedDialogProps {
  project: Project;
  onClose: () => void;
  /** Lets the sidebar badge pick up the freshly fetched number. */
  onRefreshed?: () => void;
}

function formatDate(iso: string): string {
  if (!iso) return "";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleDateString(undefined, {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

export function UnpushedDialog({ project, onClose, onRefreshed }: UnpushedDialogProps) {
  const { cards, selectCard, openModal, setActiveProject } = useKanbanStore();
  const [data, setData] = useState<UnpushedResponse | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      // Opening the panel is the one moment a network round trip is worth it:
      // the sidebar badge reads a cached ref, so without this the list could
      // report work that was pushed from another machine hours ago.
      const response = await fetch(`/api/projects/${project.id}/unpushed?fetch=1`);
      if (!response.ok) {
        setError("Could not read the repository.");
        return;
      }
      setData(await response.json());
      onRefreshed?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setIsLoading(false);
    }
  }, [project.id, onRefreshed]);

  useEffect(() => {
    load();
  }, [load]);

  const openCard = (cardId: string) => {
    const card = cards.find((c) => c.id === cardId);
    if (!card) return;
    setActiveProject(project.id);
    selectCard(card);
    openModal();
    onClose();
  };

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Not pushed yet</DialogTitle>
          <DialogDescription>
            {data?.supported
              ? `These commits are on your ${data.defaultBranch} but not on origin/${data.defaultBranch}. They only exist on this machine until you push.`
              : "Commits that exist only on this machine."}
          </DialogDescription>
        </DialogHeader>

        {isLoading ? (
          <div className="flex items-center gap-2 py-8 justify-center text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            Checking the remote…
          </div>
        ) : error ? (
          <p className="py-8 text-center text-sm text-destructive">{error}</p>
        ) : !data?.supported ? (
          <p className="py-8 text-center text-sm text-muted-foreground">
            This project has no remote to compare against.
          </p>
        ) : data.commits.length === 0 ? (
          <p className="py-8 text-center text-sm text-muted-foreground">
            Everything here has been pushed.
          </p>
        ) : (
          <div className="max-h-[50vh] overflow-y-auto -mx-2 px-2">
            <ul className="divide-y divide-border">
              {data.commits.map((commit) => (
                <li key={commit.hash} className="py-2.5 flex items-start gap-3">
                  {/* The commit message is the line, and the badges sit in
                      front of it. Cards are an enrichment: most commits never
                      carried one, and leading with the card title instead
                      would print that same title once per commit on any card
                      that took more than one. */}
                  <p className="min-w-0 flex-1 text-sm text-foreground">
                    {commit.cards.map((card) => (
                      <button
                        key={card.id}
                        type="button"
                        onClick={() => openCard(card.id)}
                        title={card.title}
                        className="text-[10px] font-mono px-1.5 py-0.5 rounded mr-1.5 align-[1px] transition-opacity hover:opacity-80"
                        style={{
                          backgroundColor: `${project.color}20`,
                          color: project.color,
                        }}
                      >
                        {card.displayId}
                      </button>
                    ))}
                    {commit.subject}
                  </p>
                  <span className="text-xs text-muted-foreground shrink-0 tabular-nums">
                    {formatDate(commit.date)}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        )}

        <div className="flex items-center justify-between pt-2">
          <span className="text-xs text-muted-foreground">
            {/* No push button on purpose: pushing publishes, and when it fails
                the fix is a pull or a rebase — not something to start here. */}
            Push from your terminal when you are ready.
          </span>
          <Button variant="ghost" size="sm" onClick={load} disabled={isLoading}>
            <RefreshCw className={`mr-2 h-3.5 w-3.5 ${isLoading ? "animate-spin" : ""}`} />
            Refresh
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
