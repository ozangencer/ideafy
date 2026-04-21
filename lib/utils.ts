/**
 * Shared UI utility helpers: className merging and color conversion.
 */
import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

export function hexToRgba(hex: string | undefined | null, alpha: number): string {
  const fallback = `rgba(26, 26, 26, ${alpha})`;
  if (!hex || typeof hex !== "string") return fallback;
  let value = hex.trim().replace(/^#/, "");
  if (value.length === 3) {
    value = value.split("").map((c) => c + c).join("");
  }
  if (value.length !== 6 || /[^0-9a-f]/i.test(value)) return fallback;
  const r = parseInt(value.slice(0, 2), 16);
  const g = parseInt(value.slice(2, 4), 16);
  const b = parseInt(value.slice(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}
