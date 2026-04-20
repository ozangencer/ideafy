import { NextRequest, NextResponse } from "next/server";
import { execFile } from "child_process";
import { promisify } from "util";

const execFileAsync = promisify(execFile);

export async function GET(request: NextRequest) {
  if (process.platform !== "darwin") {
    return NextResponse.json(
      { error: "File picker is only supported on macOS" },
      { status: 400 }
    );
  }
  try {
    // Get optional default path from query params
    const { searchParams } = new URL(request.url);
    const rawPath = searchParams.get("path");
    // Sanitize: strip anything that could terminate the AppleScript string literal
    // ("), re-enter it ('), escape within it (\), or inject a new statement via
    // newline/CR/tab/null. Prior regex missed \n which let `\nto shell script ...`
    // slip through and run arbitrary commands through the osascript dialog.
    const defaultPath = rawPath?.replace(/["'\\\r\n\t\0]/g, "") ?? null;

    let script: string;

    if (defaultPath) {
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

    // Use execFile instead of exec to avoid shell interpolation
    const { stdout } = await execFileAsync("osascript", ["-e", script]);
    const filePath = stdout.trim();

    return NextResponse.json({ path: filePath });
  } catch (error) {
    // User cancelled the dialog or error occurred
    return NextResponse.json({ path: null, cancelled: true });
  }
}
