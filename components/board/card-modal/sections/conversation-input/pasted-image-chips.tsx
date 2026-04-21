import { X } from "lucide-react";
import { PastedImage } from "./use-pasted-images";

interface PastedImageChipsProps {
  images: PastedImage[];
  onRemove: (id: string) => void;
}

export function PastedImageChips({ images, onRemove }: PastedImageChipsProps) {
  if (images.length === 0) return null;

  return (
    <div className="flex flex-wrap gap-2 px-3 pt-2 pb-1.5 border-b border-border/30">
      {images.map((img) => (
        <div
          key={img.id}
          className="relative w-16 h-16 rounded border border-border/50 bg-background overflow-hidden shrink-0"
          title={`📎 image ${img.index} (${img.mime})`}
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={img.base64} alt="" className="w-full h-full object-cover" />
          <span className="absolute bottom-0 left-0 right-0 bg-background/85 text-[10px] font-mono text-center text-amber-600 dark:text-amber-400 py-0.5 border-t border-border/40 leading-tight">
            📎 {img.index}
          </span>
          <button
            type="button"
            onClick={() => onRemove(img.id)}
            className="absolute -top-1 -right-1 w-4 h-4 rounded-full bg-background border border-border/60 flex items-center justify-center text-muted-foreground hover:text-destructive hover:border-destructive/60 transition-colors shadow-sm"
            aria-label={`Remove image ${img.index}`}
          >
            <X className="w-2.5 h-2.5" />
          </button>
        </div>
      ))}
    </div>
  );
}
