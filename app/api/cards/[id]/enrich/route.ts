import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { spawn } from "child_process";
import { marked } from "marked";
import { db, schema } from "@/lib/db";
import { getProviderForCard } from "@/lib/platform/active";
import { buildEnrichPrompt } from "@/lib/ai/enrich-prompt";
import {
  readProviderContext,
  getProjectFileLabel,
  getMemoryFileLabel,
} from "@/lib/ai/provider-context";
import { stripHtml, convertToTipTapTaskList } from "@/lib/prompts";

const TIMEOUT_MS = 60_000;
const MIN_INPUT_CHARS = 3;

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const body = await request.json().catch(() => ({}));
  const currentValue: string = typeof body?.currentValue === "string" ? body.currentValue : "";

  const plain = stripHtml(currentValue).trim();
  if (plain.length < MIN_INPUT_CHARS) {
    return NextResponse.json(
      { error: "currentValue is too short to enrich" },
      { status: 400 }
    );
  }

  const card = db
    .select()
    .from(schema.cards)
    .where(eq(schema.cards.id, id))
    .get();

  if (!card) {
    return NextResponse.json({ error: "Card not found" }, { status: 404 });
  }

  const project = card.projectId
    ? db
        .select()
        .from(schema.projects)
        .where(eq(schema.projects.id, card.projectId))
        .get()
    : null;

  const projectFolderPath = project?.folderPath || card.projectFolder || null;

  const provider = getProviderForCard(card);
  const ctx = await readProviderContext(provider.id, projectFolderPath);

  const prompt = buildEnrichPrompt({
    voice: project?.voice as never,
    currentValue: plain,
    projectMd: ctx.projectMd,
    memoryMd: ctx.memoryMd,
    projectFileLabel: getProjectFileLabel(provider.id),
    memoryFileLabel: getMemoryFileLabel(provider.id),
  });

  const cwd = projectFolderPath || process.cwd();

  try {
    const { responseText } = await new Promise<{ responseText: string }>((resolve, reject) => {
      const child = spawn(provider.getCliPath(), provider.buildAutonomousArgs({ prompt }), {
        cwd,
        stdio: ["pipe", "pipe", "pipe"],
        env: provider.getCIEnv(),
      });

      child.stdin?.end();

      let stdout = "";
      let stderr = "";

      const timer = setTimeout(() => {
        child.kill("SIGTERM");
        reject(new Error(`Enrich timed out after ${Math.round(TIMEOUT_MS / 1000)}s`));
      }, TIMEOUT_MS);

      child.stdout?.on("data", (d: Buffer) => { stdout += d.toString(); });
      child.stderr?.on("data", (d: Buffer) => { stderr += d.toString(); });

      child.on("close", (code) => {
        clearTimeout(timer);
        if (code !== 0 && !stdout.trim()) {
          reject(new Error(`${provider.displayName} exited with code ${code}: ${stderr}`));
          return;
        }
        const parsed = provider.parseJsonResponse(stdout);
        if (parsed.isError) {
          reject(new Error(parsed.result || `${provider.displayName} returned an error`));
          return;
        }
        resolve({ responseText: parsed.result });
      });

      child.on("error", (e) => {
        clearTimeout(timer);
        reject(e);
      });
    });

    const markedHtml = await marked(responseText);
    const enrichedHtml = convertToTipTapTaskList(markedHtml);

    return NextResponse.json({
      enrichedHtml,
      enrichedMarkdown: responseText,
      sources: {
        provider: provider.id,
        projectFile: ctx.sources.projectFile,
        memoryFile: ctx.sources.memoryFile,
        projectFileLabel: getProjectFileLabel(provider.id),
        memoryFileLabel: getMemoryFileLabel(provider.id),
      },
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[Enrich] failed:", msg);
    return NextResponse.json({ error: msg }, { status: 502 });
  }
}
