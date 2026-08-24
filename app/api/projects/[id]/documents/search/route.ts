import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import fs from "fs";
import { db, schema } from "@/lib/db";
import { discoverProjectDocuments } from "@/lib/documents/discovery";
import {
  CONTENT_SEARCH_MIN_QUERY,
  findInContent,
  type ContentMatch,
  type ContentSearchResponse,
} from "@/lib/documents/search";
import { normalizeSearchQuery } from "@/lib/skills/search";

// A generated doc large enough to stall the request is not worth searching.
const MAX_FILE_BYTES = 2 * 1024 * 1024;

// Past this many hits the sidebar is a wall, not a result list.
const MAX_RESULTS = 20;

function empty(query: string): ContentSearchResponse {
  return { query, scannedFiles: 0, elapsedMs: 0, truncated: false, results: [] };
}

// GET /api/projects/[id]/documents/search?q=
// Searches the text of the same documents the sidebar tree lists. Takes no
// path from the client — the file set comes from discovery, which stays inside
// the project folder, skips hidden directories and only ever reads .md.
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const query = normalizeSearchQuery(
      new URL(request.url).searchParams.get("q") ?? ""
    );

    if (query.length < CONTENT_SEARCH_MIN_QUERY) {
      return NextResponse.json(empty(query));
    }

    const project = db
      .select()
      .from(schema.projects)
      .where(eq(schema.projects.id, id))
      .get();

    if (!project) {
      return NextResponse.json({ error: "Project not found" }, { status: 404 });
    }

    const startedAt = Date.now();
    const documents = discoverProjectDocuments(project);
    const results: ContentMatch[] = [];
    let scannedFiles = 0;
    let truncated = false;

    for (const doc of documents) {
      if (results.length >= MAX_RESULTS) {
        truncated = true;
        break;
      }

      let content: string;
      try {
        if (fs.statSync(doc.path).size > MAX_FILE_BYTES) continue;
        content = fs.readFileSync(doc.path, "utf8");
      } catch (error) {
        console.error("Document search: could not read", doc.path, error);
        continue;
      }

      scannedFiles += 1;

      const hit = findInContent(content, query);
      if (!hit) continue;

      results.push({
        name: doc.name,
        path: doc.path,
        relativePath: doc.relativePath,
        isClaudeMd: doc.isClaudeMd,
        source: doc.source,
        matchCount: hit.matchCount,
        snippet: hit.snippet,
      });
    }

    const elapsedMs = Date.now() - startedAt;

    // Measured at ~10ms for 29 files / 686KB. If this line ever reports a few
    // hundred files, a cached index is the next step — start reading here.
    console.log(
      `[documents/search] q="${query}" scanned=${scannedFiles} hits=${results.length} in ${elapsedMs}ms`
    );

    const response: ContentSearchResponse = {
      query,
      scannedFiles,
      elapsedMs,
      truncated,
      results,
    };
    return NextResponse.json(response);
  } catch (error) {
    console.error("Failed to search documents:", error);
    return NextResponse.json(
      { error: "Failed to search documents" },
      { status: 500 }
    );
  }
}
