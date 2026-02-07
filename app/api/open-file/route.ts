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

    // Validate: must be absolute path, no null bytes
    const resolvedPath = path.resolve(filePath);
    if (filePath.includes("\0")) {
      return NextResponse.json({ error: "Invalid path" }, { status: 400 });
    }

    // Use execFile to avoid shell injection (arguments passed as array, not interpolated)
    const args = action === "reveal" ? ["-R", resolvedPath] : [resolvedPath];
    await execFileAsync("open", args);

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Failed to open file:", error);
    return NextResponse.json(
      { error: "Failed to open file" },
      { status: 500 }
    );
  }
}
