"use client";

import { useState, useCallback } from "react";
import { useKanbanStore } from "@/lib/store";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
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
import {
  CloudDownload,
  CloudOff,
  RefreshCw,
  Trash2,
  User,
  X,
  FileText,
  Brain,
  Lightbulb,
  TestTube2,
} from "lucide-react";
import { toast } from "sonner";
import type { PoolCard } from "@/lib/team/types";
import { SectionType, SECTION_CONFIG } from "@/lib/types";

type PoolFilter = "all" | "unassigned" | "mine";

const SECTION_ICONS: Record<SectionType, typeof FileText> = {
  detail: FileText,
  opinion: Brain,
  solution: Lightbulb,
  tests: TestTube2,
};

function hasContent(html: string | undefined): boolean {
  if (!html) return false;
  const text = html.replace(/<[^>]*>/g, "").trim();
  return text.length > 0;
}

export function PoolView() {
  const {
    poolCards,
    currentUser,
    teamMembers,
    fetchPoolCards,
    pullFromPool,
    removeFromPool,
    cards,
  } = useKanbanStore();
  const [filter, setFilter] = useState<PoolFilter>("all");
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [pullingId, setPullingId] = useState<string | null>(null);
  const [removingId, setRemovingId] = useState<string | null>(null);
  const [confirmRemoveId, setConfirmRemoveId] = useState<string | null>(null);
  const [selectedCard, setSelectedCard] = useState<PoolCard | null>(null);

  const filteredCards = poolCards.filter((card) => {
    if (filter === "unassigned") return !card.assignedTo;
    if (filter === "mine") return card.assignedTo === currentUser?.id;
    return true;
  });

  const handleRefresh = async () => {
    setIsRefreshing(true);
    await fetchPoolCards();
    setIsRefreshing(false);
  };

  const handlePull = async (poolCardId: string) => {
    const alreadyPulled = cards.find((c) => c.poolCardId === poolCardId);
    if (alreadyPulled) {
      toast.info("Already pulled - card exists locally");
      return;
    }

    setPullingId(poolCardId);
    const result = await pullFromPool(poolCardId);
    setPullingId(null);

    if (result.error) {
      toast.error(result.error);
    } else {
      toast.success("Card pulled from pool");
    }
  };

  const handleRemove = async (poolCardId: string) => {
    setConfirmRemoveId(null);
    setRemovingId(poolCardId);
    // Also clear pool link on any local card linked to this pool card
    const localCard = cards.find((c) => c.poolCardId === poolCardId);
    const result = await removeFromPool(poolCardId, localCard?.id);
    setRemovingId(null);
    if (result.error) {
      toast.error(result.error);
    } else {
      toast.success("Card removed from pool");
      if (selectedCard?.id === poolCardId) setSelectedCard(null);
    }
  };

  const priorityColors: Record<string, string> = {
    high: "text-red-500 bg-red-500/10",
    medium: "text-blue-500 bg-blue-500/10",
    low: "text-gray-400 bg-gray-500/10",
  };

  const statusColors: Record<string, string> = {
    ideation: "bg-status-ideation",
    backlog: "bg-status-backlog",
    bugs: "bg-status-bugs",
    progress: "bg-status-progress",
    test: "bg-status-test",
    completed: "bg-status-completed",
    withdrawn: "bg-status-withdrawn",
  };

  const getMemberName = (userId: string | undefined) => {
    if (!userId) return null;
    const member = teamMembers.find((m) => m.userId === userId);
    return member?.displayName || null;
  };

  return (
    <div className="flex-1 overflow-auto p-6">
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-3">
          <Select value={filter} onValueChange={(v) => setFilter(v as PoolFilter)}>
            <SelectTrigger className="w-[140px] h-8 text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Tasks</SelectItem>
              <SelectItem value="unassigned">Unassigned</SelectItem>
              <SelectItem value="mine">My Tasks</SelectItem>
            </SelectContent>
          </Select>
          <span className="text-xs text-muted-foreground">
            {filteredCards.length} card{filteredCards.length !== 1 ? "s" : ""}
          </span>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={handleRefresh}
          disabled={isRefreshing}
          className="gap-1.5"
        >
          <RefreshCw className={`h-3.5 w-3.5 ${isRefreshing ? "animate-spin" : ""}`} />
          Refresh
        </Button>
      </div>

      {/* Table */}
      {filteredCards.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-16 text-muted-foreground">
          <p className="text-sm">No pool cards found</p>
          <p className="text-xs mt-1">Send cards to the pool from the card modal</p>
        </div>
      ) : (
        <div className="border border-border rounded-md overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border bg-muted/30">
                <th className="text-left font-medium text-muted-foreground px-4 py-2.5">Title</th>
                <th className="text-left font-medium text-muted-foreground px-3 py-2.5 w-24">Status</th>
                <th className="text-left font-medium text-muted-foreground px-3 py-2.5 w-24">Priority</th>
                <th className="text-left font-medium text-muted-foreground px-3 py-2.5 w-32">Assigned</th>
                <th className="text-left font-medium text-muted-foreground px-3 py-2.5 w-32">Pushed By</th>
                <th className="text-left font-medium text-muted-foreground px-3 py-2.5 w-36">Last Synced</th>
                <th className="text-right font-medium text-muted-foreground px-4 py-2.5 w-36">Action</th>
              </tr>
            </thead>
            <tbody>
              {filteredCards.map((card) => {
                const pulledByName = card.pulledByName || getMemberName(card.pulledBy);
                return (
                  <PoolCardRow
                    key={card.id}
                    card={card}
                    getMemberName={getMemberName}
                    isAlreadyPulled={cards.some((c) => c.poolCardId === card.id)}
                    pulledByName={pulledByName || undefined}
                    isPulling={pullingId === card.id}
                    isRemoving={removingId === card.id}
                    canRemove={card.pushedBy === currentUser?.id}
                    onPull={handlePull}
                    onRemove={(id) => setConfirmRemoveId(id)}
                    onRowClick={setSelectedCard}
                    priorityColors={priorityColors}
                    statusColors={statusColors}
                  />
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* Remove confirmation dialog */}
      <AlertDialog open={!!confirmRemoveId} onOpenChange={() => setConfirmRemoveId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove from pool?</AlertDialogTitle>
            <AlertDialogDescription>
              This will remove the card from the team pool. Local copies will remain intact.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={() => confirmRemoveId && handleRemove(confirmRemoveId)}>
              Remove
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Detail Slide-over */}
      {selectedCard && (
        <PoolCardSlideOver
          card={selectedCard}
          onClose={() => setSelectedCard(null)}
          onRemove={selectedCard.pushedBy === currentUser?.id ? () => setConfirmRemoveId(selectedCard.id) : undefined}
          isRemoving={removingId === selectedCard.id}
          getMemberName={getMemberName}
          statusColors={statusColors}
          priorityColors={priorityColors}
        />
      )}
    </div>
  );
}

function PoolCardRow({
  card,
  getMemberName,
  isAlreadyPulled,
  pulledByName,
  isPulling,
  isRemoving,
  canRemove,
  onPull,
  onRemove,
  onRowClick,
  priorityColors,
  statusColors,
}: {
  card: PoolCard;
  getMemberName: (userId: string | undefined) => string | null;
  isAlreadyPulled: boolean;
  pulledByName?: string;
  isPulling: boolean;
  isRemoving: boolean;
  canRemove: boolean;
  onPull: (id: string) => void;
  onRemove: (id: string) => void;
  onRowClick: (card: PoolCard) => void;
  priorityColors: Record<string, string>;
  statusColors: Record<string, string>;
}) {
  const assignedName = card.assignedToName || getMemberName(card.assignedTo);
  const pushedName = card.pushedByName || getMemberName(card.pushedBy);

  const formatDate = (iso: string) => {
    const d = new Date(iso);
    const now = new Date();
    const diffMs = now.getTime() - d.getTime();
    const diffMins = Math.floor(diffMs / 60000);
    if (diffMins < 1) return "just now";
    if (diffMins < 60) return `${diffMins}m ago`;
    const diffHours = Math.floor(diffMins / 60);
    if (diffHours < 24) return `${diffHours}h ago`;
    const diffDays = Math.floor(diffHours / 24);
    return `${diffDays}d ago`;
  };

  const isPulled = isAlreadyPulled || !!card.pulledBy;

  return (
    <tr
      className="border-b border-border last:border-b-0 hover:bg-muted/20 transition-colors cursor-pointer"
      onClick={() => onRowClick(card)}
    >
      <td className="px-4 py-2.5">
        <span className="font-medium">{card.title}</span>
      </td>
      <td className="px-3 py-2.5">
        <span className="flex items-center gap-1.5">
          <span className={`w-2 h-2 rounded-full shrink-0 ${statusColors[card.status] || "bg-gray-400"}`} />
          <span className="text-xs capitalize">{card.status}</span>
        </span>
      </td>
      <td className="px-3 py-2.5">
        <span className={`text-xs px-1.5 py-0.5 rounded capitalize ${priorityColors[card.priority] || ""}`}>
          {card.priority}
        </span>
      </td>
      <td className="px-3 py-2.5">
        {assignedName ? (
          <span className="flex items-center gap-1 text-xs">
            <User className="h-3 w-3" />
            {assignedName}
          </span>
        ) : (
          <span className="text-xs text-muted-foreground">Unassigned</span>
        )}
      </td>
      <td className="px-3 py-2.5 text-xs text-muted-foreground">
        {pushedName || "Unknown"}
      </td>
      <td className="px-3 py-2.5 text-xs text-muted-foreground">
        {formatDate(card.lastSyncedAt || card.updatedAt)}
      </td>
      <td className="px-4 py-2.5 text-right">
        <div className="flex items-center justify-end gap-1">
          {isPulled ? (
            <span className="text-xs text-green-500">
              {pulledByName ? `Pulled by ${pulledByName}` : "Pulled"}
            </span>
          ) : (
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7"
              onClick={(e) => {
                e.stopPropagation();
                onPull(card.id);
              }}
              disabled={isPulling}
            >
              {isPulling ? (
                <RefreshCw className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <CloudDownload className="h-3.5 w-3.5" />
              )}
            </Button>
          )}
          {canRemove && (
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7 text-muted-foreground hover:text-destructive"
              onClick={(e) => {
                e.stopPropagation();
                onRemove(card.id);
              }}
              disabled={isRemoving}
            >
              {isRemoving ? (
                <RefreshCw className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Trash2 className="h-3.5 w-3.5" />
              )}
            </Button>
          )}
        </div>
      </td>
    </tr>
  );
}

// Slide-over panel matching the local card modal design
function PoolCardSlideOver({
  card,
  onClose,
  onRemove,
  isRemoving,
  getMemberName,
  statusColors,
  priorityColors,
}: {
  card: PoolCard;
  onClose: () => void;
  onRemove?: () => void;
  isRemoving?: boolean;
  getMemberName: (userId: string | undefined) => string | null;
  statusColors: Record<string, string>;
  priorityColors: Record<string, string>;
}) {
  const [activeTab, setActiveTab] = useState<SectionType>("detail");

  const pushedName = card.pushedByName || getMemberName(card.pushedBy) || "Unknown";
  const assignedName = card.assignedToName || getMemberName(card.assignedTo);
  const pulledName = card.pulledByName || getMemberName(card.pulledBy);

  const sectionValues: Record<SectionType, string> = {
    detail: card.description || "",
    opinion: card.aiOpinion || "",
    solution: card.solutionSummary || "",
    tests: card.testScenarios || "",
  };

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    },
    [onClose]
  );

  return (
    <div
      className="fixed inset-0 z-50 flex justify-end bg-black/40"
      onClick={onClose}
      onKeyDown={handleKeyDown}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="bg-surface border-l border-border w-full max-w-[900px] h-full flex flex-col shadow-2xl animate-in slide-in-from-right duration-200"
      >
        {/* Header */}
        <div className="shrink-0 border-b border-border px-6 py-4">
          <div className="flex items-start justify-between">
            <div className="flex-1 min-w-0 pr-4">
              <h2 className="text-lg font-semibold truncate">{card.title}</h2>
              <div className="flex items-center gap-3 mt-2 flex-wrap">
                <span className="flex items-center gap-1.5">
                  <span className={`w-2 h-2 rounded-full ${statusColors[card.status] || "bg-gray-400"}`} />
                  <span className="text-xs text-muted-foreground capitalize">
                    Status: <span className="text-foreground">{card.status}</span>
                  </span>
                </span>
                <span className={`text-xs px-1.5 py-0.5 rounded capitalize ${priorityColors[card.priority] || ""}`}>
                  Priority: {card.priority}
                </span>
                <span className={`text-xs px-1.5 py-0.5 rounded capitalize ${
                  card.complexity === "hard" ? "text-red-500 bg-red-500/10" :
                  card.complexity === "medium" ? "text-yellow-500 bg-yellow-500/10" :
                  "text-green-500 bg-green-500/10"
                }`}>
                  Complexity: {card.complexity}
                </span>
              </div>
              <div className="flex flex-wrap gap-x-4 gap-y-1 mt-2 text-xs text-muted-foreground">
                <span>Pushed by {pushedName}</span>
                {assignedName && <span>Assigned to {assignedName}</span>}
                {pulledName && <span>Pulled by {pulledName}</span>}
              </div>
            </div>
            <div className="flex items-center gap-1 shrink-0">
              {onRemove && (
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-8 gap-1.5 text-muted-foreground hover:text-destructive"
                  onClick={onRemove}
                  disabled={isRemoving}
                >
                  <CloudOff className="h-3.5 w-3.5" />
                  <span className="text-xs">Remove from Pool</span>
                </Button>
              )}
              <Button variant="ghost" size="icon" className="h-8 w-8" onClick={onClose}>
                <X className="h-4 w-4" />
              </Button>
            </div>
          </div>
        </div>

        {/* Section Tabs */}
        <div className="shrink-0 border-b border-border px-4">
          <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as SectionType)}>
            <TabsList className="h-10 bg-transparent gap-1 p-0">
              {(Object.keys(SECTION_CONFIG) as SectionType[]).map((section) => {
                const config = SECTION_CONFIG[section];
                const Icon = SECTION_ICONS[section];
                const isActive = activeTab === section;
                const isFilled = hasContent(sectionValues[section]);

                return (
                  <TabsTrigger
                    key={section}
                    value={section}
                    className={`
                      h-9 px-3 gap-2 rounded-md text-sm font-medium transition-colors
                      data-[state=active]:bg-muted data-[state=active]:text-foreground
                      data-[state=inactive]:text-muted-foreground data-[state=inactive]:hover:bg-muted/50
                    `}
                  >
                    <Icon
                      className="w-4 h-4"
                      style={{ color: isActive ? config.color : undefined }}
                    />
                    <span>{config.label}</span>
                    {isFilled && !isActive && (
                      <span
                        className="w-1.5 h-1.5 rounded-full"
                        style={{ backgroundColor: config.color }}
                      />
                    )}
                  </TabsTrigger>
                );
              })}
            </TabsList>
          </Tabs>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-6">
          {hasContent(sectionValues[activeTab]) ? (
            <div className="prose-kanban">
              <div
                dangerouslySetInnerHTML={{ __html: sectionValues[activeTab] }}
              />
            </div>
          ) : (
            <div className="flex items-center justify-center h-full text-muted-foreground text-sm">
              No {SECTION_CONFIG[activeTab].label.toLowerCase()} content
            </div>
          )}

          {/* AI Verdict badge for opinion tab */}
          {activeTab === "opinion" && card.aiVerdict && (
            <div className="mt-4 pt-4 border-t border-border">
              <span className={`text-xs font-medium px-2 py-1 rounded ${
                card.aiVerdict === "pass"
                  ? "text-green-500 bg-green-500/10"
                  : card.aiVerdict === "fail"
                    ? "text-red-500 bg-red-500/10"
                    : "text-yellow-500 bg-yellow-500/10"
              }`}>
                Verdict: {card.aiVerdict}
              </span>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
