"use client";

import { useEffect, useMemo, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

// Whitespace-collapsed, so "  Dev   Tools " and "Dev Tools" are one name.
function normalizeName(name: string): string {
  return name.trim().replace(/\s+/g, " ");
}

type NameDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description: string;
  submitLabel: string;
  initialValue?: string;
  existingNames?: string[];
  placeholder?: string;
  conflictMessage?: string;
  onSubmit: (name: string) => void | Promise<void>;
};

export function NameDialog({
  open,
  onOpenChange,
  title,
  description,
  submitLabel,
  initialValue = "",
  existingNames = [],
  placeholder = "Name",
  conflictMessage = "This name is already taken.",
  onSubmit,
}: NameDialogProps) {
  const [value, setValue] = useState(initialValue);

  useEffect(() => {
    if (open) {
      setValue(initialValue);
    }
  }, [initialValue, open]);

  const normalizedValue = useMemo(() => normalizeName(value), [value]);
  const nameConflict = useMemo(
    () =>
      existingNames.some(
        (name) =>
          name.toLocaleLowerCase() === normalizedValue.toLocaleLowerCase() &&
          name !== initialValue
      ),
    [existingNames, initialValue, normalizedValue]
  );

  const canSubmit = normalizedValue.length > 0 && !nameConflict;

  const handleSubmit = () => {
    if (!canSubmit) return;
    onSubmit(normalizedValue);
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>

        <div className="space-y-2">
          <Input
            value={value}
            onChange={(event) => setValue(event.target.value)}
            placeholder={placeholder}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                handleSubmit();
              }
            }}
          />
          {nameConflict && (
            <p className="text-xs text-destructive">
              {conflictMessage}
            </p>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={handleSubmit} disabled={!canSubmit}>
            {submitLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
