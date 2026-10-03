import { realpathSync } from "fs";
import path from "path";
import os from "os";
import { eq } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { getCardImageDir } from "@/lib/prompts";
import { getClaudeMemoryDir } from "@/lib/claude-memory";

function realOrNull(p: string | null | undefined): string | null {
  if (!p) return null;
  try {
    return realpathSync(p);
  } catch {
    return null;
  }
}

function isInside(child: string, parent: string): boolean {
  return child === parent || child.startsWith(parent + path.sep);
}

export type ArtifactResolution =
  | { ok: true; target: string }
  | { ok: false; status: 404 | 403; error: string };

/**
 * The folders a card's file chips may open: its own folder, its project
 * folder and the project's Claude memory folder. Card HTML can come from MCP
 * callers or a teammate's pool card, so nothing outside these opens on click.
 * Returns null when the card does not exist.
 */
export function artifactRootsFor(cardId: string): { roots: string[]; projectFolder: string | null } | null {
  const card = db
    .select({ id: schema.cards.id, projectId: schema.cards.projectId })
    .from(schema.cards)
    .where(eq(schema.cards.id, cardId))
    .get();
  if (!card) return null;

  const project = card.projectId
    ? db
        .select({ folderPath: schema.projects.folderPath })
        .from(schema.projects)
        .where(eq(schema.projects.id, card.projectId))
        .get()
    : null;
  const projectFolder = project?.folderPath || null;

  const roots = [
    realOrNull(getCardImageDir(cardId)),
    realOrNull(projectFolder),
    projectFolder ? realOrNull(getClaudeMemoryDir(projectFolder)) : null,
  ].filter((root): root is string => Boolean(root));

  return { roots, projectFolder };
}

/**
 * Resolve a chip's path the way open-artifact opens it. Document chips store
 * project-relative paths; artifacts are absolute; chat replies may write `~/…`.
 */
export function resolveArtifactPath(
  rawPath: string,
  roots: string[],
  projectFolder: string | null,
): ArtifactResolution {
  const expanded = rawPath.startsWith("~/") ? path.join(os.homedir(), rawPath.slice(2)) : rawPath;
  const absolute = path.isAbsolute(expanded)
    ? expanded
    : projectFolder
      ? path.resolve(projectFolder, rawPath)
      : null;
  const target = realOrNull(absolute);
  if (!target) return { ok: false, status: 404, error: "File not found" };

  if (!roots.some((root) => isInside(target, root))) {
    return { ok: false, status: 403, error: "This file is outside the card's folders" };
  }
  return { ok: true, target };
}
