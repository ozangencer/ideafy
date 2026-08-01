import type { ProjectRecord } from "./db/schema";
import { detectRunMode } from "./run-target";
import { DEFAULT_VOICE, Project, RUN_MODES, RunMode, Voice } from "./types";

const VALID_VOICES: Voice[] = ["entrepreneur", "builder", "engineer"];

export function normalizeVoice(v: unknown, fallback: Voice = DEFAULT_VOICE): Voice {
  return typeof v === "string" && (VALID_VOICES as string[]).includes(v)
    ? (v as Voice)
    : fallback;
}

export function normalizeRunMode(v: unknown): RunMode | null {
  return typeof v === "string" && (RUN_MODES as readonly string[]).includes(v)
    ? (v as RunMode)
    : null;
}

/** Parse a JSON text column into a string array, tolerating legacy/garbled values. */
function parseStringArray(value: string | null): string[] | null {
  if (!value) return null;
  try {
    const parsed = JSON.parse(value) as unknown;
    return Array.isArray(parsed)
      ? parsed.filter((v): v is string => typeof v === "string")
      : null;
  } catch {
    return null;
  }
}

/**
 * Map a DB row to the client-facing Project.
 *
 * `resolvedRunMode` is computed here, on the server, because detection reads
 * the project folder — the board renders a run button per card and must not
 * have to ask the API what each project can do.
 */
export function serializeProject(row: ProjectRecord): Project {
  const runMode = normalizeRunMode(row.runMode);
  // Reported even when an override is set, so project settings can show what
  // the folder actually looks like next to the choice that overrides it.
  const detectedRunMode = detectRunMode(row.folderPath);

  return {
    id: row.id,
    name: row.name,
    folderPath: row.folderPath,
    idPrefix: row.idPrefix,
    nextTaskNumber: row.nextTaskNumber,
    color: row.color,
    isPinned: row.isPinned,
    documentPaths: parseStringArray(row.documentPaths),
    narrativePath: row.narrativePath,
    useWorktrees: row.useWorktrees ?? true,
    voice: normalizeVoice(row.voice),
    runMode,
    detectedRunMode,
    resolvedRunMode: runMode ?? detectedRunMode,
    runCommand: row.runCommand,
    previewUrl: row.previewUrl,
    sharedPaths: parseStringArray(row.sharedPaths),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}
