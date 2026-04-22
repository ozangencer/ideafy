"use client";

import type { ReactNode } from "react";
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
import { Archive, Loader2, Check } from "lucide-react";
import { Status } from "@/lib/types";

type SaveStatus = "idle" | "saving" | "saved";

interface CardModalFooterProps {
  title: string;
  status: Status;
  isDraftMode: boolean;
  canSave: boolean;
  saveStatus: SaveStatus;
  onDelete: () => void;
  onWithdraw: () => void;
  onCancel: () => void;
  onSave: () => void;
  deleteSlot?: ReactNode;
  rightActionsSlot?: ReactNode;
}

export function CardModalFooter({
  title,
  status,
  isDraftMode,
  canSave,
  saveStatus,
  onDelete,
  onWithdraw,
  onCancel,
  onSave,
  deleteSlot,
  rightActionsSlot,
}: CardModalFooterProps) {
  return (
    <div className="flex items-center justify-between px-6 py-4 border-t border-border shrink-0">
      <div className="flex gap-2">
        {deleteSlot ?? (
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
                  onClick={onDelete}
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
        {rightActionsSlot}
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
