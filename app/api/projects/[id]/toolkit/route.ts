import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import {
  isToolkitKind,
  listToolkitItems,
  pinToolkitItem,
  renameToolkitFolder,
  serializeToolkitItem,
  setToolkitItemFolder,
  unpinToolkitItem,
} from "@/lib/toolkit";

type RouteContext = { params: Promise<{ id: string }> };

function projectExists(id: string): boolean {
  return !!db
    .select({ id: schema.projects.id })
    .from(schema.projects)
    .where(eq(schema.projects.id, id))
    .get();
}

// Every write answers with the full list so the client never has to reconcile
// order on its own.
function listResponse(projectId: string) {
  return NextResponse.json({ items: listToolkitItems(projectId).map(serializeToolkitItem) });
}

export async function GET(_request: NextRequest, { params }: RouteContext) {
  try {
    const { id } = await params;
    return listResponse(id);
  } catch (error) {
    console.error("Failed to fetch toolkit:", error);
    return NextResponse.json({ error: "Failed to fetch toolkit" }, { status: 500 });
  }
}

export async function POST(request: NextRequest, { params }: RouteContext) {
  try {
    const { id } = await params;
    const body = await request.json();
    const name = typeof body.name === "string" ? body.name.trim() : "";

    if (!projectExists(id)) {
      return NextResponse.json({ error: "Project not found" }, { status: 404 });
    }
    if (!isToolkitKind(body.kind) || !name) {
      return NextResponse.json({ error: "kind must be skill or agent and name is required" }, { status: 400 });
    }

    pinToolkitItem(id, { kind: body.kind, name, source: body.source });
    return listResponse(id);
  } catch (error) {
    console.error("Failed to pin toolkit item:", error);
    return NextResponse.json({ error: "Failed to pin toolkit item" }, { status: 500 });
  }
}

// Two shapes: `{ kind, name, folder }` moves one pin (empty folder = top
// level), `{ folder, rename }` renames a folder (empty rename dissolves it).
export async function PATCH(request: NextRequest, { params }: RouteContext) {
  try {
    const { id } = await params;
    const body = await request.json();

    if (!projectExists(id)) {
      return NextResponse.json({ error: "Project not found" }, { status: 404 });
    }

    if ("rename" in body) {
      if (typeof body.folder !== "string" || !body.folder) {
        return NextResponse.json({ error: "folder is required" }, { status: 400 });
      }
      renameToolkitFolder(id, body.folder, body.rename);
      return listResponse(id);
    }

    const name = typeof body.name === "string" ? body.name.trim() : "";
    if (!isToolkitKind(body.kind) || !name) {
      return NextResponse.json({ error: "kind must be skill or agent and name is required" }, { status: 400 });
    }
    setToolkitItemFolder(id, body.kind, name, body.folder);
    return listResponse(id);
  } catch (error) {
    console.error("Failed to update toolkit:", error);
    return NextResponse.json({ error: "Failed to update toolkit" }, { status: 500 });
  }
}

// kind and name travel in the query string: a plugin name contains ":" and
// would not survive as a path segment.
export async function DELETE(request: NextRequest, { params }: RouteContext) {
  try {
    const { id } = await params;
    const { searchParams } = new URL(request.url);
    const kind = searchParams.get("kind");
    const name = searchParams.get("name") ?? "";

    if (!isToolkitKind(kind) || !name) {
      return NextResponse.json({ error: "kind must be skill or agent and name is required" }, { status: 400 });
    }

    unpinToolkitItem(id, kind, name);
    return listResponse(id);
  } catch (error) {
    console.error("Failed to unpin toolkit item:", error);
    return NextResponse.json({ error: "Failed to unpin toolkit item" }, { status: 500 });
  }
}
