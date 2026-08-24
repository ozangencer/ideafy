"use client";

import { Input } from "@/components/ui/input";
import { splitOnMatch } from "@/lib/skills/search";
import { Search, X } from "lucide-react";

type SidebarSearchInputProps = {
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
};

export function SidebarSearchInput({
  value,
  onChange,
  placeholder,
}: SidebarSearchInputProps) {
  return (
    <div className="px-3 pb-1.5 pt-1">
      <div className="relative">
        <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground/75" />
        <Input
          type="text"
          value={value}
          onChange={(event) => onChange(event.target.value)}
          onKeyDown={(event) => {
            // The global Escape handler fires from inside inputs too when quick
            // entry is open, so this one has to be stopped here.
            if (event.key === "Escape") {
              event.stopPropagation();
              onChange("");
            }
          }}
          placeholder={placeholder}
          spellCheck={false}
          autoComplete="off"
          className="h-8 pl-8 pr-8 text-[12px] md:text-[12px]"
        />
        {value && (
          <button
            onClick={() => onChange("")}
            className="absolute right-1 top-1/2 flex h-[22px] w-[22px] -translate-y-1/2 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            title="Clear search"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        )}
      </div>
    </div>
  );
}

/** Marks the matched run so a hit deep in a description explains itself. */
export function HighlightedText({ text, query }: { text: string; query: string }) {
  if (!query) return <>{text}</>;

  return (
    <>
      {splitOnMatch(text, query).map((segment, index) =>
        segment.match ? (
          <mark
            key={index}
            className="rounded-[2px] bg-accent-yellow/25 px-[1px] text-foreground"
          >
            {segment.text}
          </mark>
        ) : (
          <span key={index}>{segment.text}</span>
        )
      )}
    </>
  );
}
