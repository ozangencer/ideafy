import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import {
  findAvailablePort,
  startRunCommand,
  stopDevServer,
  isProcessRunning,
  openInBrowser,
  openInXcode,
  runOneShotCommand,
  linkSharedPaths,
  ensureWorktreeDependencies,
} from "@/lib/dev-server";
import { applyPort, resolveRunTarget, resolveSharedPaths } from "@/lib/run-target";

// POST - Run the card's worktree using the project's run target
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

  // Check if something is already running for this card
  if (card.devServerPid && isProcessRunning(card.devServerPid)) {
    return NextResponse.json(
      {
        error: "Already running",
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

  const target = resolveRunTarget({
    projectPath: mainProjectPath,
    runMode: project?.runMode,
    runCommand: project?.runCommand,
    previewUrl: project?.previewUrl,
  });

  if (target.mode === "none") {
    return NextResponse.json(
      {
        error:
          "This project has no run action. Set one under Run & Preview in project settings.",
      },
      { status: 400 }
    );
  }

  try {
    linkSharedPaths(
      mainProjectPath,
      card.gitWorktreePath,
      resolveSharedPaths(project?.sharedPaths, mainProjectPath)
    );

    // Xcode hands the worktree off to another app: nothing to supervise, so no
    // PID or port is stored and there is no Stop counterpart.
    if (target.oneShot) {
      if (target.command) {
        await runOneShotCommand(card.gitWorktreePath, target.command);
        console.log(`[Run] Ran one-shot command: ${target.command}`);
        return NextResponse.json({
          success: true,
          mode: target.mode,
          oneShot: true,
          message: "Ran the project's run command",
        });
      }

      const { opened, generated } = await openInXcode(card.gitWorktreePath);
      console.log(`[Run] Opened ${opened} in Xcode (generated=${generated})`);
      return NextResponse.json({
        success: true,
        mode: target.mode,
        oneShot: true,
        message: generated
          ? "Generated the project file and opened it in Xcode"
          : "Opened in Xcode",
      });
    }

    // Only npm-shaped runs need the dependency link; an Xcode or shell command
    // has no use for node_modules.
    if (target.mode === "server" || target.mode === "app") {
      ensureWorktreeDependencies(mainProjectPath, card.gitWorktreePath);
    }

    // Main kanban app owns 3030, so worktree runs start from 3031
    const port = target.needsPort ? await findAvailablePort(3031) : null;
    console.log(
      `[Run] mode=${target.mode} command=${target.command} port=${port ?? "n/a"} for card ${id}`
    );
    console.log(`[Run] Worktree path: ${card.gitWorktreePath}`);

    const { pid } = await startRunCommand(
      card.gitWorktreePath,
      target.command!,
      port
    );
    console.log(`[Run] Started with PID ${pid}`);

    // Update card with process info
    const updatedAt = new Date().toISOString();
    db.update(schema.cards)
      .set({
        devServerPort: port,
        devServerPid: pid,
        updatedAt,
      })
      .where(eq(schema.cards.id, id))
      .run();

    // Only a server has a URL worth opening. A desktop app opens its own
    // window — pointing a browser at localhost would just show a dead tab.
    if (target.previewUrl && port !== null) {
      const url = applyPort(target.previewUrl, port);
      setTimeout(() => {
        openInBrowser(url);
      }, 2000);
    }

    return NextResponse.json({
      success: true,
      mode: target.mode,
      oneShot: false,
      port,
      pid,
      message:
        port !== null ? `Started on port ${port}` : "Started",
    });
  } catch (error) {
    console.error("[Run] Failed to start:", error);
    return NextResponse.json(
      {
        error: target.mode === "xcode" ? "Failed to open in Xcode" : "Failed to start",
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

  // Check if something is running
  if (!card.devServerPid) {
    return NextResponse.json(
      { error: "Nothing is running for this card" },
      { status: 400 }
    );
  }

  console.log(`[Run] Stopping PID ${card.devServerPid} for card ${id}`);

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
      message: "Stopped",
    });
  } else {
    return NextResponse.json({
      success: true,
      message: "Cleared (process may have already exited)",
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
