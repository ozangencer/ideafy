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
import { daysSince, formatAgeLong, formatDateShort } from "@/lib/card-age";

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
  createdAt?: string | null;
  updatedAt?: string | null;
  completedAt?: string | null;
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
  createdAt,
  updatedAt,
  completedAt,
}: CardModalFooterProps) {
  const created = formatDateShort(createdAt);
  const touched = formatDateShort(updatedAt);
  const completed = formatDateShort(completedAt);
  const createdDays = daysSince(createdAt);

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
      {/* Exact dates live here rather than on the card face — there is room,
          and this is where someone comes when they actually want to know.
          "Last touched" is deliberate: updatedAt moves on any write, including
          starting a dev server or merging, so calling it "last edited" would
          overstate what it knows. */}
      {!isDraftMode && created && (
        <div className="hidden sm:flex items-center gap-2 text-xs text-muted-foreground min-w-0 px-4">
          <span className="truncate">
            Created {created}
            {createdDays !== null && createdDays >= 31 && ` (${formatAgeLong(createdDays)})`}
          </span>
          {touched && touched !== created && (
            <>
              <span aria-hidden="true">·</span>
              <span className="truncate">Last touched {touched}</span>
            </>
          )}
          {completed && (
            <>
              <span aria-hidden="true">·</span>
              <span className="truncate">Completed {completed}</span>
            </>
          )}
        </div>
      )}

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
