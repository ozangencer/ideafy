"use client";

import { useState, useEffect, useMemo, useCallback } from "react";
import { useKanbanStore } from "@/lib/store";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
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
  RefreshCw,
  Trash2,
  User,
  UserCheck,
  UserMinus,
  UserPlus,
  X,
} from "lucide-react";
import { toast } from "sonner";
import type { PoolCard } from "@/lib/team/types";
import { PoolCardSlideOver } from "./pool-card-slide-over";

export function PoolView() {
  const {
    poolCards,
    currentUser,
    teamMembers,
    teamMembersByTeamId,
    teams,
    activeTeamId,
    fetchPoolCards,
    pullFromPool,
    removeFromPool,
    claimPoolCard,
    cards,
  } = useKanbanStore();

  // Filter states
  const [poolTeamFilter, setPoolTeamFilter] = useState<string>(activeTeamId || "all");
  const [statusFilter, setStatusFilter] = useState("all");
  const [priorityFilter, setPriorityFilter] = useState("all");
  const [projectFilter, setProjectFilter] = useState("all");
  const [assignedToFilter, setAssignedToFilter] = useState("all");
  const [pulledByFilter, setPulledByFilter] = useState("all");

  const [isRefreshing, setIsRefreshing] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  // Fetch pool cards for the selected team filter on mount
  useEffect(() => {
    fetchPoolCards(poolTeamFilter);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const [pullingId, setPullingId] = useState<string | null>(null);
  const [claimingId, setClaimingId] = useState<string | null>(null);
  const [removingId, setRemovingId] = useState<string | null>(null);
  const [confirmRemoveId, setConfirmRemoveId] = useState<string | null>(null);
  const [confirmClaimId, setConfirmClaimId] = useState<string | null>(null);
  const [confirmUnclaimId, setConfirmUnclaimId] = useState<string | null>(null);
  const [selectedCard, setSelectedCard] = useState<PoolCard | null>(null);

  // Bulk action states
  const [bulkAction, setBulkAction] = useState<"claim" | "unclaim" | "delete" | null>(null);
  const [isBulkProcessing, setIsBulkProcessing] = useState(false);
  const [confirmBulkDelete, setConfirmBulkDelete] = useState(false);

  // Unique filter values derived from poolCards
  const uniqueStatuses = useMemo(
    () => Array.from(new Set(poolCards.map((c) => c.status))).sort(),
    [poolCards]
  );
  const uniquePriorities = useMemo(
    () => Array.from(new Set(poolCards.map((c) => c.priority))).sort(),
    [poolCards]
  );
  const uniqueProjects = useMemo(
    () => Array.from(new Set(poolCards.map((c) => c.projectName).filter(Boolean))).sort() as string[],
    [poolCards]
  );
  const uniqueAssignees = useMemo(
    () => Array.from(new Set(poolCards.map((c) => c.assignedToName).filter(Boolean))).sort() as string[],
    [poolCards]
  );
  const uniquePullers = useMemo(
    () => Array.from(new Set(poolCards.map((c) => c.pulledByName).filter(Boolean))).sort() as string[],
    [poolCards]
  );

  const filteredCards = useMemo(() => {
    return poolCards.filter((card) => {
      // Assigned To filter
      if (assignedToFilter === "unassigned" && card.assignedTo) return false;
      if (assignedToFilter === "mine" && card.assignedTo !== currentUser?.id) return false;
      if (
        assignedToFilter !== "all" &&
        assignedToFilter !== "unassigned" &&
        assignedToFilter !== "mine" &&
        card.assignedToName !== assignedToFilter
      )
        return false;
      // Pulled By filter
      if (pulledByFilter === "not_pulled" && card.pulledBy) return false;
      if (
        pulledByFilter !== "all" &&
        pulledByFilter !== "not_pulled" &&
        card.pulledByName !== pulledByFilter
      )
        return false;
      // Column filters
      if (statusFilter !== "all" && card.status !== statusFilter) return false;
      if (priorityFilter !== "all" && card.priority !== priorityFilter) return false;
      if (projectFilter !== "all" && (card.projectName || "") !== projectFilter) return false;
      return true;
    });
  }, [poolCards, assignedToFilter, pulledByFilter, statusFilter, priorityFilter, projectFilter, currentUser?.id]);

  // Clear selection when filters change
  useEffect(() => {
    setSelectedIds(new Set());
  }, [poolTeamFilter, statusFilter, priorityFilter, projectFilter, assignedToFilter, pulledByFilter]);

  const handleTeamFilterChange = async (value: string) => {
    setPoolTeamFilter(value);
    setIsRefreshing(true);
    await fetchPoolCards(value);
    setIsRefreshing(false);
  };

  const handleRefresh = async () => {
    setIsRefreshing(true);
    await fetchPoolCards(poolTeamFilter);
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

  // Check if current user is admin/owner in any team
  const isAdminOrOwner = (() => {
    if (teamMembers.some((m) => m.userId === currentUser?.id && (m.role === "owner" || m.role === "admin"))) {
      return true;
    }
    if (Object.values(teamMembersByTeamId).some((members) =>
      members.some((m) => m.userId === currentUser?.id && (m.role === "owner" || m.role === "admin"))
    )) {
      return true;
    }
    return teams.some((t) => t.createdBy === currentUser?.id);
  })();

  const requestClaim = (poolCardId: string, action: "claim" | "unclaim") => {
    if (action === "unclaim") {
      setConfirmUnclaimId(poolCardId);
      return;
    }
    const card = poolCards.find((c) => c.id === poolCardId);
    if (card?.assignedTo && card.assignedTo !== currentUser?.id) {
      if (isAdminOrOwner) {
        setConfirmClaimId(poolCardId);
      } else {
        toast.error(`This card is assigned to ${card.assignedToName || "someone else"}. Ask them to unclaim first.`);
      }
      return;
    }
    handleClaim(poolCardId, action);
  };

  const handleClaim = async (poolCardId: string, action: "claim" | "unclaim") => {
    setConfirmClaimId(null);
    setConfirmUnclaimId(null);
    setClaimingId(poolCardId);
    const result = await claimPoolCard(poolCardId, action);
    setClaimingId(null);

    if (result.error) {
      toast.error(result.error);
    } else {
      toast.success(action === "claim" ? "Card claimed" : "Card unassigned");
    }
  };

  const handleRemove = async (poolCardId: string) => {
    setConfirmRemoveId(null);
    setRemovingId(poolCardId);
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

  // Bulk actions
  const handleBulkClaim = useCallback(async () => {
    setIsBulkProcessing(true);
    let success = 0;
    let skipped = 0;
    for (const id of Array.from(selectedIds)) {
      const card = poolCards.find((c) => c.id === id);
      if (card?.assignedTo === currentUser?.id) {
        skipped++;
        continue;
      }
      if (card?.assignedTo && !isAdminOrOwner) {
        skipped++;
        continue;
      }
      const result = await claimPoolCard(id, "claim");
      if (!result.error) success++;
      else skipped++;
    }
    setIsBulkProcessing(false);
    setSelectedIds(new Set());
    if (success > 0) toast.success(`Claimed ${success} card${success !== 1 ? "s" : ""}`);
    if (skipped > 0) toast.info(`Skipped ${skipped} card${skipped !== 1 ? "s" : ""}`);
  }, [selectedIds, poolCards, currentUser?.id, isAdminOrOwner, claimPoolCard]);

  const handleBulkUnclaim = useCallback(async () => {
    setIsBulkProcessing(true);
    let success = 0;
    let skipped = 0;
    for (const id of Array.from(selectedIds)) {
      const card = poolCards.find((c) => c.id === id);
      if (card?.assignedTo !== currentUser?.id) {
        skipped++;
        continue;
      }
      const result = await claimPoolCard(id, "unclaim");
      if (!result.error) success++;
      else skipped++;
    }
    setIsBulkProcessing(false);
    setSelectedIds(new Set());
    if (success > 0) toast.success(`Unclaimed ${success} card${success !== 1 ? "s" : ""}`);
    if (skipped > 0) toast.info(`Skipped ${skipped} card${skipped !== 1 ? "s" : ""} (not assigned to you)`);
  }, [selectedIds, poolCards, currentUser?.id, claimPoolCard]);

  const handleBulkDelete = useCallback(async () => {
    setConfirmBulkDelete(false);
    setIsBulkProcessing(true);
    let success = 0;
    let failed = 0;
    for (const id of Array.from(selectedIds)) {
      const localCard = cards.find((c) => c.poolCardId === id);
      const result = await removeFromPool(id, localCard?.id);
      if (!result.error) success++;
      else failed++;
    }
    setIsBulkProcessing(false);
    setSelectedIds(new Set());
    if (success > 0) toast.success(`Removed ${success} card${success !== 1 ? "s" : ""} from pool`);
    if (failed > 0) toast.error(`Failed to remove ${failed} card${failed !== 1 ? "s" : ""}`);
  }, [selectedIds, cards, removeFromPool]);

  const toggleSelect = useCallback((id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const toggleSelectAll = useCallback(() => {
    if (selectedIds.size === filteredCards.length) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(filteredCards.map((c) => c.id)));
    }
  }, [selectedIds.size, filteredCards]);

  const isAllSelected = filteredCards.length > 0 && selectedIds.size === filteredCards.length;
  const isIndeterminate = selectedIds.size > 0 && selectedIds.size < filteredCards.length;

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
        <div className="flex items-center gap-2 flex-wrap">
          {teams.length > 0 && (
            <Select value={poolTeamFilter} onValueChange={handleTeamFilterChange}>
              <SelectTrigger className="w-[140px] h-8 text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {teams.length > 1 && (
                  <SelectItem value="all">All Teams</SelectItem>
                )}
                {teams.map((team) => (
                  <SelectItem key={team.id} value={team.id}>
                    {team.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
          <Select value={assignedToFilter} onValueChange={setAssignedToFilter}>
            <SelectTrigger className="w-[120px] h-8 text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Assigned</SelectItem>
              <SelectItem value="unassigned">Unassigned</SelectItem>
              <SelectItem value="mine">My Tasks</SelectItem>
              {uniqueAssignees.map((name) => (
                <SelectItem key={name} value={name}>
                  {name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={statusFilter} onValueChange={setStatusFilter}>
            <SelectTrigger className="w-[120px] h-8 text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Status</SelectItem>
              {uniqueStatuses.map((s) => (
                <SelectItem key={s} value={s}>
                  <span className="capitalize">{s}</span>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={priorityFilter} onValueChange={setPriorityFilter}>
            <SelectTrigger className="w-[120px] h-8 text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Priority</SelectItem>
              {uniquePriorities.map((p) => (
                <SelectItem key={p} value={p}>
                  <span className="capitalize">{p}</span>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {uniqueProjects.length > 0 && (
            <Select value={projectFilter} onValueChange={setProjectFilter}>
              <SelectTrigger className="w-[120px] h-8 text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Projects</SelectItem>
                {uniqueProjects.map((p) => (
                  <SelectItem key={p} value={p}>
                    {p}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
          {uniquePullers.length > 0 && (
            <Select value={pulledByFilter} onValueChange={setPulledByFilter}>
              <SelectTrigger className="w-[120px] h-8 text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Pulled</SelectItem>
                <SelectItem value="not_pulled">Not Pulled</SelectItem>
                {uniquePullers.map((name) => (
                  <SelectItem key={name} value={name}>
                    {name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
          <span className="text-xs text-muted-foreground ml-1">
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
                <th className="px-3 py-2.5 w-10">
                  <Checkbox
                    checked={isAllSelected}
                    ref={(el) => {
                      if (el) {
                        (el as unknown as HTMLButtonElement).dataset.state = isIndeterminate
                          ? "indeterminate"
                          : isAllSelected
                            ? "checked"
                            : "unchecked";
                      }
                    }}
                    onCheckedChange={toggleSelectAll}
                    aria-label="Select all"
                    className="h-3.5 w-3.5"
                  />
                </th>
                <th className="text-left font-medium text-muted-foreground px-4 py-2.5">Title</th>
                <th className="text-left font-medium text-muted-foreground px-3 py-2.5 w-32">Project</th>
                {poolTeamFilter === "all" && (
                  <th className="text-left font-medium text-muted-foreground px-3 py-2.5 w-32">Team</th>
                )}
                <th className="text-left font-medium text-muted-foreground px-3 py-2.5 w-24">Status</th>
                <th className="text-left font-medium text-muted-foreground px-3 py-2.5 w-24">Priority</th>
                <th className="text-left font-medium text-muted-foreground px-3 py-2.5 w-32">Assigned</th>
                <th className="text-left font-medium text-muted-foreground px-3 py-2.5 w-32">Pushed By</th>
                <th className="text-left font-medium text-muted-foreground px-3 py-2.5 w-36">Last Synced</th>
                <th className="text-left font-medium text-muted-foreground px-3 py-2.5 w-36">Pulled By</th>
                <th className="text-right font-medium text-muted-foreground px-4 py-2.5 w-20">Action</th>
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
                    canRemove={card.pushedBy === currentUser?.id || isAdminOrOwner || card.assignedTo === currentUser?.id}
                    isMine={card.assignedTo === currentUser?.id}
                    isClaiming={claimingId === card.id}
                    isSelected={selectedIds.has(card.id)}
                    onToggleSelect={toggleSelect}
                    onPull={handlePull}
                    onClaim={requestClaim}
                    onRemove={(id) => setConfirmRemoveId(id)}
                    onRowClick={setSelectedCard}
                    priorityColors={priorityColors}
                    statusColors={statusColors}
                    showTeamColumn={poolTeamFilter === "all"}
                  />
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* Bulk Action Bar (Linear-style floating pill) */}
      {selectedIds.size > 0 && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50">
          <div className="flex items-center gap-1 bg-background border border-border rounded-full shadow-lg px-4 py-2">
            <span className="text-xs font-medium text-muted-foreground mr-2">
              {selectedIds.size} selected
            </span>
            <div className="w-px h-4 bg-border" />
            <Button
              variant="ghost"
              size="sm"
              className="h-7 gap-1 text-xs"
              onClick={handleBulkClaim}
              disabled={isBulkProcessing}
            >
              <UserPlus className="h-3 w-3" />
              Claim
            </Button>
            <Button
              variant="ghost"
              size="sm"
              className="h-7 gap-1 text-xs"
              onClick={handleBulkUnclaim}
              disabled={isBulkProcessing}
            >
              <UserMinus className="h-3 w-3" />
              Unclaim
            </Button>
            {isAdminOrOwner && (
              <Button
                variant="ghost"
                size="sm"
                className="h-7 gap-1 text-xs text-destructive hover:text-destructive"
                onClick={() => setConfirmBulkDelete(true)}
                disabled={isBulkProcessing}
              >
                <Trash2 className="h-3 w-3" />
                Delete
              </Button>
            )}
            <div className="w-px h-4 bg-border" />
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7"
              onClick={() => setSelectedIds(new Set())}
            >
              <X className="h-3 w-3" />
            </Button>
          </div>
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

      {/* Bulk delete confirmation dialog */}
      <AlertDialog open={confirmBulkDelete} onOpenChange={setConfirmBulkDelete}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove {selectedIds.size} card{selectedIds.size !== 1 ? "s" : ""} from pool?</AlertDialogTitle>
            <AlertDialogDescription>
              Local copies will remain intact.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleBulkDelete}>
              Remove
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Claim confirmation dialog (when already assigned to someone else) */}
      <AlertDialog open={!!confirmClaimId} onOpenChange={() => setConfirmClaimId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Reassign card?</AlertDialogTitle>
            <AlertDialogDescription>
              This card is currently assigned to{" "}
              <strong>
                {(() => {
                  const card = poolCards.find((c) => c.id === confirmClaimId);
                  return card?.assignedToName || getMemberName(card?.assignedTo) || "someone else";
                })()}
              </strong>
              . Do you want to reassign it to yourself?
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={() => confirmClaimId && handleClaim(confirmClaimId, "claim")}>
              Reassign to me
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Unclaim confirmation dialog */}
      <AlertDialog open={!!confirmUnclaimId} onOpenChange={() => setConfirmUnclaimId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Unassign card?</AlertDialogTitle>
            <AlertDialogDescription>
              This will remove you from this card. Other team members will be able to claim it.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={() => confirmUnclaimId && handleClaim(confirmUnclaimId, "unclaim")}>
              Unassign
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
  isMine,
  isClaiming,
  isSelected,
  onToggleSelect,
  onPull,
  onClaim,
  onRemove,
  onRowClick,
  priorityColors,
  statusColors,
  showTeamColumn,
}: {
  card: PoolCard;
  getMemberName: (userId: string | undefined) => string | null;
  isAlreadyPulled: boolean;
  pulledByName?: string;
  isPulling: boolean;
  isRemoving: boolean;
  canRemove: boolean;
  isMine: boolean;
  isClaiming: boolean;
  isSelected: boolean;
  onToggleSelect: (id: string) => void;
  onPull: (id: string) => void;
  onClaim: (id: string, action: "claim" | "unclaim") => void;
  onRemove: (id: string) => void;
  onRowClick: (card: PoolCard) => void;
  priorityColors: Record<string, string>;
  statusColors: Record<string, string>;
  showTeamColumn?: boolean;
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
      className={`border-b border-border last:border-b-0 hover:bg-muted/20 transition-colors cursor-pointer ${isSelected ? "bg-muted/30" : ""}`}
      onClick={() => onRowClick(card)}
    >
      <td className="px-3 py-2.5" onClick={(e) => e.stopPropagation()}>
        <Checkbox
          checked={isSelected}
          onCheckedChange={() => onToggleSelect(card.id)}
          aria-label={`Select ${card.title}`}
          className="h-3.5 w-3.5"
        />
      </td>
      <td className="px-4 py-2.5">
        <span className="font-medium">{card.title}</span>
      </td>
      <td className="px-3 py-2.5">
        <span className="text-xs text-muted-foreground">{card.projectName || "-"}</span>
      </td>
      {showTeamColumn && (
        <td className="px-3 py-2.5">
          <span className="text-xs text-muted-foreground">{card.teamName || "Unknown"}</span>
        </td>
      )}
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
      <td className="px-3 py-2.5">
        {isPulled ? (
          <span className="text-xs text-green-500">
            {pulledByName || "Pulled"}
          </span>
        ) : (
          <span className="text-xs text-muted-foreground">-</span>
        )}
      </td>
      <td className="px-4 py-2.5 text-right">
        <div className="flex items-center justify-end gap-1">
          <Button
            variant="ghost"
            size="icon"
            className={`h-7 w-7 ${isMine ? "text-primary" : ""}`}
            onClick={(e) => {
              e.stopPropagation();
              onClaim(card.id, isMine ? "unclaim" : "claim");
            }}
            disabled={isClaiming}
            title={isMine ? "Unclaim" : "Claim"}
          >
            {isClaiming ? (
              <RefreshCw className="h-3.5 w-3.5 animate-spin" />
            ) : isMine ? (
              <UserCheck className="h-3.5 w-3.5" />
            ) : (
              <UserPlus className="h-3.5 w-3.5" />
            )}
          </Button>
          {!isPulled && (
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
