import { NextRequest, NextResponse } from "next/server";
import { execFile } from "child_process";
import { promisify } from "util";
import * as path from "path";

const execFileAsync = promisify(execFile);

export async function POST(request: NextRequest) {
  try {
    const { path: filePath, action = "open" } = await request.json();

    if (!filePath || typeof filePath !== "string") {
      return NextResponse.json({ error: "Path is required" }, { status: 400 });
    }

    if (filePath.includes("\0")) {
      return NextResponse.json({ error: "Invalid path" }, { status: 400 });
    }

    const resolvedPath = path.resolve(filePath);

    const args = action === "reveal" ? ["-R", resolvedPath] : [resolvedPath];
    const { stderr } = await execFileAsync("open", args);

    if (stderr && stderr.trim()) {
      return NextResponse.json(
        { error: stderr.trim() },
        { status: 500 }
      );
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to open file";
    console.error("Failed to open file:", error);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
