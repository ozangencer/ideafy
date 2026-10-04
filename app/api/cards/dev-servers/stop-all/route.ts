import { NextResponse } from "next/server";
import { inArray, isNotNull } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { stopDevServer } from "@/lib/dev-server";

// POST - Stop every card's Run process. Electron calls this on quit: once the
// app is gone nothing can reach these servers through Stop again, so they
// would keep holding memory as orphans.
export async function POST() {
  const running = db
    .select({ id: schema.cards.id, pid: schema.cards.devServerPid })
    .from(schema.cards)
    .where(isNotNull(schema.cards.devServerPid))
    .all();

  if (running.length === 0) {
    return NextResponse.json({ success: true, stopped: 0, cleared: 0 });
  }

  console.log(`[Run] Stopping ${running.length} run process(es) on quit`);

  const results = await Promise.allSettled(
    running.map((card) => stopDevServer(card.pid!))
  );
  const stopped = results.filter(
    (r) => r.status === "fulfilled" && r.value
  ).length;

  db.update(schema.cards)
    .set({
      devServerPort: null,
      devServerPid: null,
      updatedAt: new Date().toISOString(),
    })
    .where(inArray(schema.cards.id, running.map((card) => card.id)))
    .run();

  return NextResponse.json({ success: true, stopped, cleared: running.length });
}
