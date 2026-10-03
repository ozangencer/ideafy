import { NextRequest, NextResponse } from "next/server";
import { artifactRootsFor, resolveArtifactPath } from "@/lib/artifact-roots";

// One chat reply rarely links more than a handful of files; the cap only keeps
// a crafted request from turning into a filesystem scan.
const MAX_PATHS = 50;

/**
 * POST /api/cards/[id]/artifact-status { paths }
 *
 * For each path, whether open-artifact would open it. The chips use this to
 * draw a dead link — a file outside the card's folders, or one the scratch
 * sweep already removed — as faded text instead of a chip that only fails on
 * click.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const body = await request.json().catch(() => ({}));
  const paths: string[] = Array.isArray(body.paths)
    ? body.paths
        .filter((p: unknown): p is string => typeof p === "string" && p.length > 0 && !p.includes("\0"))
        .slice(0, MAX_PATHS)
    : [];

  const scope = artifactRootsFor(id);
  if (!scope) {
    return NextResponse.json({ error: "Card not found" }, { status: 404 });
  }

  const available: Record<string, boolean> = {};
  for (const p of paths) {
    available[p] = resolveArtifactPath(p, scope.roots, scope.projectFolder).ok;
  }
  return NextResponse.json({ available });
}
