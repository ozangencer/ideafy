"use client";

import { useEffect, useState, type DragEvent, type KeyboardEvent } from "react";
import { Check, FileText, Folder, Link2, Upload, X } from "lucide-react";
import { Input } from "@/components/ui/input";
import { readElectronFilePath } from "@/lib/dropped-file-paths";
import {
  displayReferencePath,
  referenceFromLink,
  referenceFromPath,
  type BriefReference,
} from "@/lib/work-brief-references";
import { cn } from "@/lib/utils";

interface FolderEntry {
  name: string;
  kind: "file" | "folder";
}

interface ReferencesPickerProps {
  folderPath: string;
  references: BriefReference[];
  onChange: (references: BriefReference[]) => void;
  /** Keeps the dialog open while the native file picker has focus. */
  onPickingChange: (picking: boolean) => void;
  onKeyDown?: (e: KeyboardEvent<HTMLDivElement>) => void;
}

// The folder list is cut here so a busy folder does not push the drop zone
// out of the dialog; "Show all" opens the rest.
const COLLAPSED_ENTRIES = 8;

function canReadDroppedPaths(): boolean {
  if (typeof window === "undefined") return false;
  const api = (window as Window & { electronAPI?: { getPathForFile?: unknown } }).electronAPI;
  return typeof api?.getPathForFile === "function";
}

function Tick({ on }: { on: boolean }) {
  return (
    <span
      className={cn(
        "mt-0.5 flex h-[15px] w-[15px] shrink-0 items-center justify-center rounded border",
        on ? "border-primary bg-primary text-primary-foreground" : "border-muted-foreground/50"
      )}
    >
      {on && <Check className="h-2.5 w-2.5" strokeWidth={3} />}
    </span>
  );
}

function KindIcon({ kind }: { kind: BriefReference["kind"] }) {
  const Icon = kind === "folder" ? Folder : kind === "link" ? Link2 : FileText;
  return <Icon className="mt-0.5 h-[15px] w-[15px] shrink-0 text-muted-foreground" />;
}

function NoteInput({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  return (
    <Input
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder="What is it? (optional)"
      className="mt-1.5 h-7 px-2 text-xs"
    />
  );
}

export function ReferencesPicker({
  folderPath,
  references,
  onChange,
  onPickingChange,
  onKeyDown,
}: ReferencesPickerProps) {
  const [entries, setEntries] = useState<FolderEntry[]>([]);
  const [total, setTotal] = useState(0);
  const [home, setHome] = useState<string | null>(null);
  const [showAll, setShowAll] = useState(false);
  const [linkDraft, setLinkDraft] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const [dropSupported, setDropSupported] = useState(false);

  useEffect(() => {
    setDropSupported(canReadDroppedPaths());
  }, []);

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/folder-entries?path=${encodeURIComponent(folderPath)}`)
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (cancelled || !data) return;
        setEntries(data.entries ?? []);
        setTotal(data.total ?? 0);
        setHome(data.home ?? null);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [folderPath]);

  const selectedPaths = new Set(references.map((r) => r.path));
  const entryNames = new Set(entries.map((e) => e.name));
  // Everything not ticked from the top-level list: deeper files, outside
  // paths and links.
  const added = references.filter((r) => r.kind === "link" || r.outside || !entryNames.has(r.path));
  const visibleEntries = showAll ? entries : entries.slice(0, COLLAPSED_ENTRIES);

  const add = (next: BriefReference[]) => {
    const fresh = next.filter((r) => !selectedPaths.has(r.path));
    if (fresh.length) onChange([...references, ...fresh]);
  };

  const remove = (path: string) => onChange(references.filter((r) => r.path !== path));

  const setNote = (path: string, note: string) =>
    onChange(references.map((r) => (r.path === path ? { ...r, note } : r)));

  const toggleEntry = (entry: FolderEntry) => {
    if (selectedPaths.has(entry.name)) remove(entry.name);
    else add([{ path: entry.name, kind: entry.kind, outside: false, note: "" }]);
  };

  const handleDrop = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setDragOver(false);
    const items = Array.from(e.dataTransfer.items ?? []);
    const dropped: BriefReference[] = [];
    items.forEach((item) => {
      if (item.kind !== "file") return;
      const file = item.getAsFile();
      const absolute = file ? readElectronFilePath(file) : null;
      if (!absolute) return;
      const kind = item.webkitGetAsEntry()?.isDirectory ? "folder" : "file";
      const ref = referenceFromPath(absolute, folderPath, kind);
      if (ref) dropped.push(ref);
    });
    // Nothing is copied: only the location is recorded.
    add(dropped);
  };

  const browse = async () => {
    onPickingChange(true);
    try {
      const res = await fetch(`/api/file-picker?path=${encodeURIComponent(folderPath)}`);
      const data = await res.json();
      if (data.path) {
        const ref = referenceFromPath(data.path, folderPath, "file");
        if (ref) add([ref]);
      }
    } catch (error) {
      console.error("Failed to pick file:", error);
    } finally {
      onPickingChange(false);
    }
  };

  const commitLink = () => {
    const ref = linkDraft ? referenceFromLink(linkDraft) : null;
    if (ref) add([ref]);
    setLinkDraft(null);
  };

  return (
    <div className="flex-1 min-h-0 overflow-y-auto py-1" onKeyDown={onKeyDown}>
      <div className="flex items-center justify-between px-3 pt-2 pb-1 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
        <span>In this folder</span>
        {total > COLLAPSED_ENTRIES && (
          <button
            type="button"
            className="normal-case tracking-normal text-primary hover:underline"
            onClick={() => setShowAll((v) => !v)}
          >
            {showAll ? "Show fewer" : `Show all ${total}`}
          </button>
        )}
      </div>
      {entries.length === 0 && (
        <p className="px-3 py-1.5 text-xs text-muted-foreground">This folder is empty.</p>
      )}
      {visibleEntries.map((entry) => {
        const ref = references.find((r) => r.path === entry.name && !r.outside);
        return (
          <div key={entry.name} className={cn("px-3 py-1.5", ref && "bg-primary/5")}>
            <button
              type="button"
              role="checkbox"
              aria-checked={Boolean(ref)}
              onClick={() => toggleEntry(entry)}
              className="flex w-full items-start gap-2.5 text-left"
            >
              <Tick on={Boolean(ref)} />
              <KindIcon kind={entry.kind} />
              <span className="font-mono text-xs leading-5 truncate">
                {entry.kind === "folder" ? `${entry.name}/` : entry.name}
              </span>
            </button>
            {ref && (
              <div className="pl-[50px]">
                <NoteInput value={ref.note} onChange={(note) => setNote(ref.path, note)} />
              </div>
            )}
          </div>
        );
      })}

      {added.length > 0 && (
        <div className="px-3 pt-3 pb-1 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
          Added
        </div>
      )}
      {added.map((ref) => (
        <div key={ref.path} className="bg-primary/5 px-3 py-1.5">
          <div className="flex items-start gap-2.5">
            <KindIcon kind={ref.kind} />
            <span className="min-w-0 flex-1 font-mono text-xs leading-5">
              <span className="break-all">{displayReferencePath(ref, home)}</span>
              {ref.outside && (
                <span className="ml-1.5 whitespace-nowrap rounded-full bg-amber-500/15 px-1.5 py-px font-sans text-[10px] text-amber-700 dark:text-amber-400">
                  outside the folder
                </span>
              )}
            </span>
            <button
              type="button"
              aria-label={`Remove ${ref.path}`}
              onClick={() => remove(ref.path)}
              className="mt-0.5 text-muted-foreground hover:text-foreground"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
          <div className="pl-[25px]">
            <NoteInput value={ref.note} onChange={(note) => setNote(ref.path, note)} />
          </div>
        </div>
      ))}

      <div
        onDragOver={(e) => {
          if (!dropSupported) return;
          e.preventDefault();
          setDragOver(true);
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={dropSupported ? handleDrop : undefined}
        className={cn(
          "mx-3 mt-2 mb-2 flex items-center gap-2 rounded-md border border-dashed px-3 py-2 text-xs text-muted-foreground",
          dragOver ? "border-primary bg-primary/5" : "border-muted-foreground/40"
        )}
      >
        <Upload className="h-3.5 w-3.5 shrink-0" />
        {linkDraft === null ? (
          <span>
            {dropSupported && <span className="font-medium text-foreground">Drop files or folders · </span>}
            <button type="button" className="font-medium text-primary hover:underline" onClick={browse}>
              Browse…
            </button>
            {" · "}
            <button
              type="button"
              className="font-medium text-primary hover:underline"
              onClick={() => setLinkDraft("")}
            >
              Paste a link
            </button>
          </span>
        ) : (
          <Input
            autoFocus
            value={linkDraft}
            onChange={(e) => setLinkDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                commitLink();
              }
            }}
            onBlur={commitLink}
            placeholder="https://… then Enter"
            className="h-7 flex-1 px-2 text-xs"
          />
        )}
      </div>
    </div>
  );
}
