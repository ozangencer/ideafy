import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import {
  findAvailablePort,
  startDevServer,
  stopDevServer,
  isProcessRunning,
  openInBrowser,
  symlinkDatabase,
  ensureWorktreeDependencies,
} from "@/lib/dev-server";

// POST - Start dev server
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  // Get the card from database
  const card = db
    .select()
    .from(schema.cards)
    .where(eq(schema.cards.id, id))
    .get();

  if (!card) {
    return NextResponse.json({ error: "Card not found" }, { status: 404 });
  }

  // Verify card has an active worktree
  if (card.gitWorktreeStatus !== "active" || !card.gitWorktreePath) {
    return NextResponse.json(
      { error: "Card has no active worktree" },
      { status: 400 }
    );
  }

  // Check if server is already running
  if (card.devServerPid && isProcessRunning(card.devServerPid)) {
    return NextResponse.json(
      {
        error: "Dev server is already running",
        port: card.devServerPort,
        pid: card.devServerPid,
      },
      { status: 400 }
    );
  }

  // Get the main project path
  const project = card.projectId
    ? db
        .select()
        .from(schema.projects)
        .where(eq(schema.projects.id, card.projectId))
        .get()
    : null;

  const mainProjectPath = project?.folderPath || card.projectFolder;
  if (!mainProjectPath) {
    return NextResponse.json(
      { error: "Could not determine main project path" },
      { status: 400 }
    );
  }

  try {
    // Symlink the main database to the worktree
    symlinkDatabase(mainProjectPath, card.gitWorktreePath);

    // Ensure worktree can resolve npm deps (links main's node_modules)
    ensureWorktreeDependencies(mainProjectPath, card.gitWorktreePath);

    // Find available port (main app on 3030, worktrees start from 3031)
    const port = await findAvailablePort(3031);
    console.log(`[DevServer] Starting server on port ${port} for card ${id}`);
    console.log(`[DevServer] Worktree path: ${card.gitWorktreePath}`);

    // Start the dev server
    const { pid } = await startDevServer(card.gitWorktreePath, port);
    console.log(`[DevServer] Server started with PID ${pid}`);

    // Update card with server info
    const updatedAt = new Date().toISOString();
    db.update(schema.cards)
      .set({
        devServerPort: port,
        devServerPid: pid,
        updatedAt,
      })
      .where(eq(schema.cards.id, id))
      .run();

    // Open browser after a short delay to let server initialize
    setTimeout(() => {
      openInBrowser(`http://localhost:${port}`);
    }, 2000);

    return NextResponse.json({
      success: true,
      port,
      pid,
      message: `Dev server started on port ${port}`,
    });
  } catch (error) {
    console.error("[DevServer] Failed to start:", error);
    return NextResponse.json(
      {
        error: "Failed to start dev server",
        details: error instanceof Error ? error.message : String(error),
      },
      { status: 500 }
    );
  }
}

// DELETE - Stop dev server
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  // Get the card from database
  const card = db
    .select()
    .from(schema.cards)
    .where(eq(schema.cards.id, id))
    .get();

  if (!card) {
    return NextResponse.json({ error: "Card not found" }, { status: 404 });
  }

  // Check if server is running
  if (!card.devServerPid) {
    return NextResponse.json(
      { error: "No dev server is running" },
      { status: 400 }
    );
  }

  console.log(`[DevServer] Stopping server with PID ${card.devServerPid} for card ${id}`);

  // Stop the server
  const stopped = stopDevServer(card.devServerPid);

  // Clear server info from database regardless of stop result
  const updatedAt = new Date().toISOString();
  db.update(schema.cards)
    .set({
      devServerPort: null,
      devServerPid: null,
      updatedAt,
    })
    .where(eq(schema.cards.id, id))
    .run();

  if (stopped) {
    return NextResponse.json({
      success: true,
      message: "Dev server stopped",
    });
  } else {
    return NextResponse.json({
      success: true,
      message: "Dev server info cleared (process may have already exited)",
    });
  }
}

// GET - Check server status
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  // Get the card from database
  const card = db
    .select()
    .from(schema.cards)
    .where(eq(schema.cards.id, id))
    .get();

  if (!card) {
    return NextResponse.json({ error: "Card not found" }, { status: 404 });
  }

  // Check if server is actually running
  const running = card.devServerPid ? isProcessRunning(card.devServerPid) : false;

  // If PID exists but process is not running, clean up
  if (card.devServerPid && !running) {
    const updatedAt = new Date().toISOString();
    db.update(schema.cards)
      .set({
        devServerPort: null,
        devServerPid: null,
        updatedAt,
      })
      .where(eq(schema.cards.id, id))
      .run();

    return NextResponse.json({
      running: false,
      port: null,
      pid: null,
    });
  }

  return NextResponse.json({
    running,
    port: running ? card.devServerPort : null,
    pid: running ? card.devServerPid : null,
  });
}
