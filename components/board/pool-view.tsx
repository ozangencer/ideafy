"use client";

import { useState } from "react";
import { useKanbanStore } from "@/lib/store";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { CloudDownload, RefreshCw, User } from "lucide-react";
import { toast } from "sonner";
import type { PoolCard } from "@/lib/team/types";

type PoolFilter = "all" | "unassigned" | "mine";

export function PoolView() {
  const {
    poolCards,
    currentUser,
    teamMembers,
    fetchPoolCards,
    pullFromPool,
    cards,
  } = useKanbanStore();
  const [filter, setFilter] = useState<PoolFilter>("all");
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [pullingId, setPullingId] = useState<string | null>(null);

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
                <th className="text-right font-medium text-muted-foreground px-4 py-2.5 w-20">Action</th>
              </tr>
            </thead>
            <tbody>
              {filteredCards.map((card) => (
                <PoolCardRow
                  key={card.id}
                  card={card}
                  getMemberName={getMemberName}
                  isAlreadyPulled={cards.some((c) => c.poolCardId === card.id)}
                  isPulling={pullingId === card.id}
                  onPull={handlePull}
                  priorityColors={priorityColors}
                  statusColors={statusColors}
                />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function PoolCardRow({
  card,
  getMemberName,
  isAlreadyPulled,
  isPulling,
  onPull,
  priorityColors,
  statusColors,
}: {
  card: PoolCard;
  getMemberName: (userId: string | undefined) => string | null;
  isAlreadyPulled: boolean;
  isPulling: boolean;
  onPull: (id: string) => void;
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

  return (
    <tr className="border-b border-border last:border-b-0 hover:bg-muted/20 transition-colors">
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
        {isAlreadyPulled ? (
          <span className="text-xs text-green-500">Pulled</span>
        ) : (
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7"
            onClick={() => onPull(card.id)}
            disabled={isPulling}
          >
            {isPulling ? (
              <RefreshCw className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <CloudDownload className="h-3.5 w-3.5" />
            )}
          </Button>
        )}
      </td>
    </tr>
  );
}
