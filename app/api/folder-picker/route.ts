import { NextResponse } from "next/server";
import { execFile } from "child_process";
import { promisify } from "util";

const execFileAsync = promisify(execFile);

export async function GET() {
  try {
    // Use AppleScript to open native macOS folder picker. execFile avoids the
    // shell entirely so the (currently static) script body can't be smuggled
    // through shell interpretation if it ever gains dynamic input.
    const script = `
      set selectedFolder to choose folder with prompt "Select Project Folder"
      return POSIX path of selectedFolder
    `;

    const { stdout } = await execFileAsync("osascript", ["-e", script]);
    const folderPath = stdout.trim();

    // Remove trailing slash if present
    const cleanPath = folderPath.endsWith("/")
      ? folderPath.slice(0, -1)
      : folderPath;

    return NextResponse.json({ path: cleanPath });
  } catch (error) {
    // User cancelled the dialog or error occurred
    return NextResponse.json({ path: null, cancelled: true });
  }
}
