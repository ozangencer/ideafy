"use client";

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
import { Archive } from "lucide-react";
import { Status } from "@/lib/types";

interface CardModalFooterProps {
  title: string;
  status: Status;
  isDraftMode: boolean;
  canSave: boolean;
  onDelete: () => void;
  onWithdraw: () => void;
  onCancel: () => void;
  onSave: () => void;
}

export function CardModalFooter({
  title,
  status,
  isDraftMode,
  canSave,
  onDelete,
  onWithdraw,
  onCancel,
  onSave,
}: CardModalFooterProps) {
  return (
    <div className="flex items-center justify-between px-6 py-4 border-t border-border shrink-0">
      <div className="flex gap-2">
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
      <div className="flex gap-2">
        <Button variant="outline" onClick={onCancel}>
          Cancel
        </Button>
        <Button onClick={onSave} disabled={!canSave}>
          {isDraftMode ? "Create Card" : "Save Changes"}
        </Button>
      </div>
    </div>
  );
}
