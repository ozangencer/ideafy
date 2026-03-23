import { NextRequest, NextResponse } from "next/server";
import { exec } from "child_process";
import { promisify } from "util";

const execAsync = promisify(exec);

export async function GET(request: NextRequest) {
  try {
    // Get optional default path from query params
    const { searchParams } = new URL(request.url);
    const rawPath = searchParams.get("path");
    // Strip double quotes to prevent AppleScript injection (macOS paths can't contain ")
    const defaultPath = rawPath?.replace(/"/g, "") ?? null;

    // Use AppleScript to open native macOS file picker
    // Note: We don't restrict file types since markdown UTIs are not universally supported
    // User can select any file (md, txt, etc.)
    let script: string;

    if (defaultPath) {
      // Start from the specified folder
      script = `
        set defaultFolder to POSIX file "${defaultPath}"
        set selectedFile to choose file with prompt "Select Narrative File" default location defaultFolder
        return POSIX path of selectedFile
      `;
    } else {
      script = `
        set selectedFile to choose file with prompt "Select Narrative File"
        return POSIX path of selectedFile
      `;
    }

    const { stdout } = await execAsync(`osascript -e '${script}'`);
    const filePath = stdout.trim();

    return NextResponse.json({ path: filePath });
  } catch (error) {
    // User cancelled the dialog or error occurred
    return NextResponse.json({ path: null, cancelled: true });
  }
}
