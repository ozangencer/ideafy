import { NextRequest, NextResponse } from "next/server";
import { and, eq, isNotNull } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import {
  scanOrphanServers,
  stopScannedServer,
  toPublic,
  type ScannedServer,
} from "@/lib/orphan-servers";

export const dynamic = "force-dynamic";

// Rescan on a plain GET once the last result is this old; the panel asks at
// launch and every 10 minutes.
const MAX_AGE_MS = 10 * 60 * 1000;
// `?refresh=1` (popover opened) rescans at most this often.
const MIN_REFRESH_MS = 30 * 1000;

// Same globalThis pattern as process-registry: one cache across route bundles.
const g = globalThis as unknown as {
  __ideafy_orphanServers?: { at: number; servers: ScannedServer[] };
  __ideafy_orphanScan?: Promise<ScannedServer[]>;
};

function runPids(): number[] {
  return db
    .select({ pid: schema.cards.devServerPid })
    .from(schema.cards)
    .where(isNotNull(schema.cards.devServerPid))
    .all()
    .map((row) => row.pid!)
    .filter(Boolean);
}

function worktreeCards() {
  return db
    .select({
      cardId: schema.cards.id,
      taskNumber: schema.cards.taskNumber,
      path: schema.cards.gitWorktreePath,
      idPrefix: schema.projects.idPrefix,
    })
    .from(schema.cards)
    .leftJoin(schema.projects, eq(schema.cards.projectId, schema.projects.id))
    .where(isNotNull(schema.cards.gitWorktreePath))
    .all()
    .map((row) => ({
      cardId: row.cardId,
      displayId: row.idPrefix && row.taskNumber ? `${row.idPrefix}-${row.taskNumber}` : null,
      path: row.path!.replace(/\/+$/, ""),
    }));
}

// "IDE-430" → the card's id, so a verify-server row opens its card.
function resolveDisplayId(displayId: string): string | null {
  const m = displayId.match(/^([A-Za-z]+)-(\d+)$/);
  if (!m) return null;
  const row = db
    .select({ id: schema.cards.id })
    .from(schema.cards)
    .innerJoin(schema.projects, eq(schema.cards.projectId, schema.projects.id))
    .where(and(eq(schema.projects.idPrefix, m[1].toUpperCase()), eq(schema.cards.taskNumber, Number(m[2]))))
    .get();
  return row?.id ?? null;
}

// One scan at a time: a refresh landing while the 10-minute scan runs waits for it.
async function scan(): Promise<ScannedServer[]> {
  if (!g.__ideafy_orphanScan) {
    g.__ideafy_orphanScan = scanOrphanServers({
      runPids: runPids(),
      worktreeCards: worktreeCards(),
      resolveDisplayId,
    })
      .then((servers) => {
        g.__ideafy_orphanServers = { at: Date.now(), servers };
        return servers;
      })
      .finally(() => {
        g.__ideafy_orphanScan = undefined;
      });
  }
  return g.__ideafy_orphanScan;
}

// Biggest first: the row worth closing is the one on top.
function publicList(servers: ScannedServer[]) {
  return [...servers].sort((a, b) => (b.memoryBytes ?? 0) - (a.memoryBytes ?? 0)).map(toPublic);
}

// GET - Dev servers nobody owns: cached, rescanned when stale or on ?refresh=1.
export async function GET(request: NextRequest) {
  const refresh = request.nextUrl.searchParams.get("refresh") === "1";
  const cached = g.__ideafy_orphanServers;
  const age = cached ? Date.now() - cached.at : Infinity;

  if (cached && age < (refresh ? MIN_REFRESH_MS : MAX_AGE_MS)) {
    return NextResponse.json(publicList(cached.servers));
  }
  try {
    return NextResponse.json(publicList(await scan()));
  } catch (error) {
    console.error("[orphans] scan failed:", error);
    return NextResponse.json(publicList(cached?.servers ?? []));
  }
}

// DELETE ?id=<id> - Close one orphan server. The target must still show up in
// a fresh scan, so this route cannot be used to signal an arbitrary PID, and a
// PID reused since the list was drawn answers 404.
export async function DELETE(request: NextRequest) {
  const id = request.nextUrl.searchParams.get("id");
  if (!id) {
    return NextResponse.json({ error: "Missing id parameter" }, { status: 400 });
  }

  const target = (await scan()).find((server) => server.id === id);
  if (!target) {
    return NextResponse.json({ error: "Server is no longer listed" }, { status: 404 });
  }

  console.log(`[orphans] Closing ${target.label} (pgid ${target.pgid}, :${target.port ?? "-"})`);
  const stopped = await stopScannedServer(target);
  const servers = await scan();

  if (!stopped) {
    return NextResponse.json(
      { error: "Some processes survived", servers: publicList(servers) },
      { status: 500 }
    );
  }
  return NextResponse.json({ success: true, servers: publicList(servers) });
}
