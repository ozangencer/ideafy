import { PlatformIcon } from "@/components/icons/platform-icons";
import { StatusIcon } from "@/components/ui/status-icon";
import {
  StatusOption,
  PlatformOption,
  ComplexityOption,
} from "../constants";
import { AutocompleteKind, Project } from "../types";

export type AutocompleteItem = Project | StatusOption | PlatformOption | ComplexityOption;

interface AutocompleteListProps {
  kind: AutocompleteKind;
  items: AutocompleteItem[];
  activeIndex: number;
  onHover: (index: number) => void;
  onSelect: (index: number) => void;
  /** Small caps label over the list, e.g. which workspace the projects come from. */
  heading?: string;
}

export function AutocompleteList({ kind, items, activeIndex, onHover, onSelect, heading }: AutocompleteListProps) {
  return (
    <div className="border-t border-[hsl(var(--border))]">
      {heading && (
        <p className="px-5 pt-2 pb-1 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
          {heading}
        </p>
      )}
      {items.map((item, idx) => {
        const isActive = idx === activeIndex;
        return (
          <button
            key={itemKey(kind, item)}
            className={`relative w-full px-5 py-2 flex items-center gap-2.5 text-[13px] text-left transition-colors ${
              isActive ? "bg-[hsl(var(--foreground)/0.06)]" : "hover:bg-[hsl(var(--foreground)/0.03)]"
            }`}
            onMouseDown={(e) => {
              e.preventDefault();
              onSelect(idx);
            }}
            onMouseEnter={() => onHover(idx)}
          >
            {isActive && (
              <span className="absolute left-0 top-1.5 bottom-1.5 w-[2px] rounded-r-full bg-[hsl(var(--primary))]" />
            )}
            <LeadingIcon kind={kind} item={item} />
            <span className={isActive ? "text-foreground" : "text-foreground/70"}>
              {itemLabel(kind, item)}
            </span>
            <span className="text-muted-foreground/55 text-xs ml-auto font-mono">
              {itemHint(kind, item)}
            </span>
          </button>
        );
      })}
    </div>
  );
}

function itemKey(kind: AutocompleteKind, item: AutocompleteItem): string {
  return kind === "project" ? (item as Project).id : (item as StatusOption | PlatformOption | ComplexityOption).key;
}

function itemLabel(kind: AutocompleteKind, item: AutocompleteItem): string {
  return kind === "project" ? (item as Project).name : (item as StatusOption | PlatformOption | ComplexityOption).label;
}

function itemHint(kind: AutocompleteKind, item: AutocompleteItem): string {
  if (kind === "project") return (item as Project).idPrefix;
  if (kind === "status") return (item as StatusOption).slash;
  if (kind === "platform") return (item as PlatformOption).bracket;
  return (item as ComplexityOption).trigger;
}

function LeadingIcon({ kind, item }: { kind: AutocompleteKind; item: AutocompleteItem }) {
  if (kind === "platform") {
    return <PlatformIcon platform={(item as PlatformOption).key} size={14} className="shrink-0" />;
  }
  if (kind === "status") {
    return <StatusIcon status={(item as StatusOption).key} size={12} />;
  }
  const color = kind === "project" ? (item as Project).color : (item as ComplexityOption).color;
  return <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: color }} />;
}
