"use client";

import { useState } from "react";
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
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Archive, Loader2, Check, CloudUpload, CloudOff } from "lucide-react";
import { Status } from "@/lib/types";
import { useKanbanStore } from "@/lib/store";
import { toast } from "sonner";

type SaveStatus = "idle" | "saving" | "saved";

interface CardModalFooterProps {
  title: string;
  cardId?: string;
  poolCardId?: string | null;
  status: Status;
  isDraftMode: boolean;
  canSave: boolean;
  saveStatus: SaveStatus;
  onDelete: (removeFromPool?: boolean) => void;
  onRemoveFromPool?: () => void;
  onWithdraw: () => void;
  onCancel: () => void;
  onSave: () => void;
}

export function CardModalFooter({
  title,
  cardId,
  poolCardId,
  status,
  isDraftMode,
  canSave,
  saveStatus,
  onDelete,
  onRemoveFromPool,
  onWithdraw,
  onCancel,
  onSave,
}: CardModalFooterProps) {
  const { teamMode, currentTeam, sendToPool, pushUpdate } = useKanbanStore();
  const [isSyncing, setIsSyncing] = useState(false);
  const [isRemoving, setIsRemoving] = useState(false);
  const [showPoolDeleteDialog, setShowPoolDeleteDialog] = useState(false);
  const [showRemoveFromPoolDialog, setShowRemoveFromPoolDialog] = useState(false);

  const handlePoolAction = async () => {
    if (!cardId) return;
    setIsSyncing(true);

    if (poolCardId) {
      // Update existing pool card
      const result = await pushUpdate(cardId);
      if (result.error) toast.error(result.error);
      else toast.success("Pool updated");
    } else {
      // Send new card to pool
      const result = await sendToPool(cardId);
      if (result.error) toast.error(result.error);
      else toast.success("Card sent to pool");
    }
    setIsSyncing(false);
  };

  const handleRemoveFromPool = async () => {
    setShowRemoveFromPoolDialog(false);
    if (!onRemoveFromPool) return;
    setIsRemoving(true);
    onRemoveFromPool();
    setIsRemoving(false);
  };

  const showPoolButton = teamMode && currentTeam && !isDraftMode && cardId;
  const isLinkedToPool = !!poolCardId;

  return (
    <div className="flex items-center justify-between px-6 py-4 border-t border-border shrink-0">
      <div className="flex gap-2">
        {/* Delete button - pool-aware when linked */}
        {isLinkedToPool && teamMode ? (
          <>
            <Button
              variant="ghost"
              className="text-destructive hover:bg-destructive/10 hover:text-destructive"
              onClick={() => setShowPoolDeleteDialog(true)}
            >
              Delete
            </Button>
            <AlertDialog open={showPoolDeleteDialog} onOpenChange={setShowPoolDeleteDialog}>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Delete task?</AlertDialogTitle>
                  <AlertDialogDescription>
                    This card is linked to the team pool. How would you like to delete it?
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <div className="py-2 space-y-2">
                  <Button
                    variant="outline"
                    className="w-full justify-start"
                    onClick={() => {
                      setShowPoolDeleteDialog(false);
                      onDelete(false);
                    }}
                  >
                    Delete locally only
                    <span className="ml-auto text-xs text-muted-foreground">Pool card remains</span>
                  </Button>
                  <Button
                    variant="outline"
                    className="w-full justify-start text-destructive hover:text-destructive"
                    onClick={() => {
                      setShowPoolDeleteDialog(false);
                      onDelete(true);
                    }}
                  >
                    Delete and remove from pool
                    <span className="ml-auto text-xs text-muted-foreground">Both deleted</span>
                  </Button>
                </div>
                <AlertDialogFooter>
                  <AlertDialogCancel>Cancel</AlertDialogCancel>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          </>
        ) : (
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button
                variant="ghost"
                className="text-destructive hover:bg-destructive/10 hover:text-destructive"
              >
                Delete
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Delete task?</AlertDialogTitle>
                <AlertDialogDescription>
                  This action cannot be undone. This will permanently delete the
                  task &quot;{title}&quot;.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Cancel</AlertDialogCancel>
                <AlertDialogAction
                  onClick={() => onDelete()}
                  className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                >
                  Delete
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        )}
        {!isDraftMode && status !== "withdrawn" && (
          <Button
            variant="ghost"
            className="text-muted-foreground hover:bg-muted hover:text-foreground"
            onClick={onWithdraw}
          >
            <Archive className="mr-2 h-4 w-4" />
            Withdraw
          </Button>
        )}
      </div>
      <div className="flex gap-2 items-center">
        {showPoolButton && (
          <>
            {isLinkedToPool && onRemoveFromPool && (
              <>
                <Button
                  variant="outline"
                  size="sm"
                  className="gap-1.5 text-muted-foreground hover:text-destructive hover:border-destructive/50"
                  onClick={() => setShowRemoveFromPoolDialog(true)}
                  disabled={isRemoving}
                >
                  {isRemoving ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <CloudOff className="h-3.5 w-3.5" />
                  )}
                  Remove from Pool
                </Button>
                <AlertDialog open={showRemoveFromPoolDialog} onOpenChange={setShowRemoveFromPoolDialog}>
                  <AlertDialogContent>
                    <AlertDialogHeader>
                      <AlertDialogTitle>Remove from pool?</AlertDialogTitle>
                      <AlertDialogDescription>
                        This will remove the card from the team pool. Your local card will remain intact.
                      </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                      <AlertDialogCancel>Cancel</AlertDialogCancel>
                      <AlertDialogAction onClick={handleRemoveFromPool}>
                        Remove from Pool
                      </AlertDialogAction>
                    </AlertDialogFooter>
                  </AlertDialogContent>
                </AlertDialog>
              </>
            )}
            <Button
              variant="outline"
              size="sm"
              className="gap-1.5"
              onClick={handlePoolAction}
              disabled={isSyncing}
            >
              {isSyncing ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <CloudUpload className="h-3.5 w-3.5" />
              )}
              {poolCardId ? "Update Pool" : "Send to Pool"}
            </Button>
          </>
        )}
        {isDraftMode ? (
          <>
            <Button variant="outline" onClick={onCancel}>
              Cancel
            </Button>
            <Button onClick={onSave} disabled={!canSave}>
              Create Card
            </Button>
          </>
        ) : (
          <>
            {saveStatus === "saving" && (
              <span className="flex items-center gap-2 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" />
                Saving...
              </span>
            )}
            {saveStatus === "saved" && (
              <span className="flex items-center gap-2 text-sm text-green-500">
                <Check className="h-4 w-4" />
                Saved
              </span>
            )}
          </>
        )}
      </div>
    </div>
  );
}
