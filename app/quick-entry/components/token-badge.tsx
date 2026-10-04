import type { ReactNode } from "react";
import { X } from "lucide-react";

interface TokenBadgeProps {
  label: string;
  /** Plain dot colour; ignored when `icon` is given. */
  color?: string;
  /** Drawn in place of the dot, e.g. a status ring. */
  icon?: ReactNode;
  onRemove: () => void;
}

export function TokenBadge({ label, color, icon, onRemove }: TokenBadgeProps) {
  return (
    <span className="inline-flex items-center gap-1.5 pl-2 pr-1.5 py-0.5 rounded-md bg-[hsl(var(--foreground)/0.06)] text-[11px] text-foreground/80">
      {icon ?? (
        <span
          className="w-1.5 h-1.5 rounded-full"
          style={{ backgroundColor: color }}
        />
      )}
      {label}
      <button
        type="button"
        className="p-0.5 -m-0.5 text-muted-foreground/50 hover:text-foreground/70 transition-colors"
        onClick={onRemove}
        aria-label={`Remove ${label}`}
      >
        <X className="w-3 h-3" />
      </button>
    </span>
  );
}
