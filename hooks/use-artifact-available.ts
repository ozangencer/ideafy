"use client";

import { useEffect, useState } from "react";

// A file that opens now keeps opening for the session; a dead one is checked
// again after a while, since the model may write it a moment after the link.
const MISSING_TTL_MS = 30 * 1000;

interface Entry {
  ok: boolean;
  at: number;
}

const cache = new Map<string, Entry>();
const pending = new Map<string, { paths: Set<string>; waiters: Array<() => void> }>();
const listeners = new Set<() => void>();

const keyOf = (cardId: string, path: string) => `${cardId}\0${path}`;

function fresh(cardId: string, path: string): Entry | undefined {
  const entry = cache.get(keyOf(cardId, path));
  if (!entry) return undefined;
  if (!entry.ok && Date.now() - entry.at > MISSING_TTL_MS) return undefined;
  return entry;
}

async function flush(cardId: string): Promise<void> {
  const batch = pending.get(cardId);
  pending.delete(cardId);
  if (!batch) return;
  try {
    const res = await fetch(`/api/cards/${cardId}/artifact-status`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ paths: Array.from(batch.paths) }),
    });
    if (res.ok) {
      const { available } = (await res.json()) as { available: Record<string, boolean> };
      const now = Date.now();
      for (const [path, ok] of Object.entries(available)) cache.set(keyOf(cardId, path), { ok, at: now });
    }
  } catch {
    // Unknown stays unknown: the chip keeps working and the click reports why.
  }
  batch.waiters.forEach((resolve) => resolve());
  listeners.forEach((notify) => notify());
}

/**
 * Ask whether open-artifact would open each path. Every chip of a card asking
 * in the same tick shares one request.
 */
export function checkArtifactPaths(cardId: string, paths: string[]): Promise<Record<string, boolean>> {
  const result = () => {
    const out: Record<string, boolean> = {};
    for (const p of paths) {
      const entry = fresh(cardId, p);
      if (entry) out[p] = entry.ok;
    }
    return out;
  };
  const missing = paths.filter((p) => !fresh(cardId, p));
  if (missing.length === 0) return Promise.resolve(result());

  let batch = pending.get(cardId);
  if (!batch) {
    batch = { paths: new Set(), waiters: [] };
    pending.set(cardId, batch);
    setTimeout(() => void flush(cardId), 0);
  }
  missing.forEach((p) => batch!.paths.add(p));
  return new Promise((resolve) => batch!.waiters.push(() => resolve(result())));
}

/**
 * False only when the server said the file cannot be opened; true or unknown
 * otherwise, so a failed check never hides a working chip. Pass
 * `enabled: false` while a reply is streaming — the model often writes the
 * link before the file.
 */
export function useArtifactAvailable(cardId: string | undefined, path: string, enabled: boolean): boolean {
  const usable = enabled && !!cardId && !cardId.startsWith("draft-");
  const [available, setAvailable] = useState(() => (usable ? fresh(cardId!, path)?.ok ?? true : true));

  useEffect(() => {
    if (!usable) {
      setAvailable(true);
      return;
    }
    let cancelled = false;
    const sync = () => {
      const entry = fresh(cardId!, path);
      if (!cancelled && entry) setAvailable(entry.ok);
    };
    listeners.add(sync);
    void checkArtifactPaths(cardId!, [path]).then(sync);
    return () => {
      cancelled = true;
      listeners.delete(sync);
    };
  }, [usable, cardId, path]);

  return available;
}
