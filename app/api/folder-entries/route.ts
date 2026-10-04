import { NextRequest, NextResponse } from "next/server";
import fs from "fs/promises";
import os from "os";
import path from "path";

// Lists the top level of a folder the user picked in the Add Project wizard,
// before the project exists, so the Work brief's References question can be
// answered by ticking entries instead of typing paths. Names only, no content.
export const dynamic = "force-dynamic";

// Files that describe the project to AI already, or tooling noise.
const SKIPPED_NAMES = new Set(["CLAUDE.md", "AGENTS.md", "node_modules"]);
const MAX_ENTRIES = 500;

export async function GET(request: NextRequest) {
  const folderPath = request.nextUrl.searchParams.get("path");
  if (!folderPath || !path.isAbsolute(folderPath)) {
    return NextResponse.json({ error: "An absolute folder path is required" }, { status: 400 });
  }

  try {
    const stat = await fs.stat(folderPath);
    if (!stat.isDirectory()) {
      return NextResponse.json({ error: "Not a folder" }, { status: 400 });
    }

    const dirents = await fs.readdir(folderPath, { withFileTypes: true });
    const entries = dirents
      .filter(
        (d) =>
          !d.name.startsWith(".") &&
          !SKIPPED_NAMES.has(d.name) &&
          (d.isFile() || d.isDirectory())
      )
      .map((d) => ({ name: d.name, kind: d.isDirectory() ? ("folder" as const) : ("file" as const) }))
      .sort((a, b) =>
        a.kind === b.kind
          ? a.name.localeCompare(b.name, undefined, { sensitivity: "base" })
          : a.kind === "folder"
            ? -1
            : 1
      );

    return NextResponse.json({
      entries: entries.slice(0, MAX_ENTRIES),
      total: entries.length,
      home: os.homedir(),
    });
  } catch {
    return NextResponse.json({ error: "Folder could not be read" }, { status: 404 });
  }
}
