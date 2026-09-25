import { eq } from "drizzle-orm";
import { marked } from "marked";
import { db, schema } from "@/lib/db";
import { getProviderForCard } from "@/lib/platform/active";
import { runAutonomousCli } from "@/lib/autonomous-run/run-autonomous-cli";
import { buildEnrichPrompt } from "@/lib/ai/enrich-prompt";
import {
  readProviderContext,
  getProjectFileLabel,
  getMemoryFileLabel,
} from "@/lib/ai/provider-context";
import { stripHtml, convertToTipTapTaskList } from "@/lib/prompts";

const TIMEOUT_MS = 60_000;
const MIN_ENRICH_INPUT_CHARS = 3;

export interface RunEnrichInput {
  currentValue: string;
  projectId: string | null;
  aiPlatform?: string | null;
  /** Used when the project row has no folder (legacy cards carry their own). */
  fallbackFolderPath?: string | null;
}

export interface EnrichResult {
  enrichedHtml: string;
  enrichedMarkdown: string;
  warning: string | null;
  sources: {
    provider: string;
    projectFile: string | null;
    memoryFile: string | null;
    projectFileLabel: string;
    memoryFileLabel: string | null;
  };
}

export class EnrichInputError extends Error {}

/**
 * A line of a CLI's raw event stream (`{"type":"system",...}`). Seeing one in
 * the chosen text means the output was never decomposed, and proposing it as a
 * description is how IDE-332 wrote NDJSON into a card.
 */
const RAW_EVENT_LINE = /^\s*\{"type":/m;

/**
 * Expand a rough description into a spec using the project's context files.
 * Shared by the saved-card route and the draft route, which differ only in
 * where the project and platform come from.
 */
export async function runEnrich(input: RunEnrichInput): Promise<EnrichResult> {
  const plain = stripHtml(input.currentValue).trim();
  if (plain.length < MIN_ENRICH_INPUT_CHARS) {
    throw new EnrichInputError("currentValue is too short to enrich");
  }

  const project = input.projectId
    ? db
        .select()
        .from(schema.projects)
        .where(eq(schema.projects.id, input.projectId))
        .get()
    : null;

  const projectFolderPath = project?.folderPath || input.fallbackFolderPath || null;

  const provider = getProviderForCard({ aiPlatform: input.aiPlatform });
  const ctx = await readProviderContext(provider.id, projectFolderPath);

  const prompt = buildEnrichPrompt({
    voice: project?.voice as never,
    currentValue: plain,
    projectMd: ctx.projectMd,
    memoryMd: ctx.memoryMd,
    projectFileLabel: getProjectFileLabel(provider.id),
    memoryFileLabel: getMemoryFileLabel(provider.id),
  });

  // No contract: section headings are translated into the input's language,
  // so there is no fixed marker to look for. No tracking: this is a 60s
  // preview, not a card run. requireExitZero: a half-finished run proposed as
  // a description is worse than an error.
  const { response, warning } = await runAutonomousCli({
    prompt,
    cwd: projectFolderPath || process.cwd(),
    aiPlatform: provider.id,
    timeoutMs: TIMEOUT_MS,
    label: "Enrich",
    requireExitZero: true,
  });

  const responseText = response.trim();
  if (!responseText || RAW_EVENT_LINE.test(responseText)) {
    throw new Error("Enrich produced no usable text");
  }

  const markedHtml = await marked(responseText);

  return {
    enrichedHtml: convertToTipTapTaskList(markedHtml),
    enrichedMarkdown: responseText,
    warning,
    sources: {
      provider: provider.id,
      projectFile: ctx.sources.projectFile,
      memoryFile: ctx.sources.memoryFile,
      projectFileLabel: getProjectFileLabel(provider.id),
      memoryFileLabel: getMemoryFileLabel(provider.id),
    },
  };
}
