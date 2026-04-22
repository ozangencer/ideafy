import { X } from "lucide-react";

interface TokenBadgeProps {
  label: string;
  color: string;
  onRemove: () => void;
}

export function TokenBadge({ label, color, onRemove }: TokenBadgeProps) {
  return (
    <span className="inline-flex items-center gap-1.5 pl-2 pr-1.5 py-0.5 rounded-md bg-[hsl(var(--foreground)/0.06)] text-[11px] text-foreground/80">
      <span
        className="w-1.5 h-1.5 rounded-full"
        style={{ backgroundColor: color }}
      />
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
