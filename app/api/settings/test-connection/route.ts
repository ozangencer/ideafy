import { NextRequest, NextResponse } from "next/server";
import { execSync } from "child_process";
import type { AiPlatform } from "@/lib/types";
import { getPlatformProvider } from "@/lib/platform";

export async function GET(request: NextRequest) {
  const platform = (request.nextUrl.searchParams.get("platform") || "claude") as AiPlatform;

  try {
    const provider = getPlatformProvider(platform);
    const cliPath = provider.getCliPath();

    return NextResponse.json({
      found: true,
      path: cliPath,
      platform: provider.displayName,
    });
  } catch (error) {
    // CLI not found via provider, try which as fallback
    const binaryName = platform === "claude" ? "claude" : platform === "gemini" ? "gemini" : "codex";
    try {
      const result = execSync(`which ${binaryName}`, { encoding: "utf-8" }).trim();
      return NextResponse.json({
        found: !!result,
        path: result || null,
        platform: getPlatformProvider(platform).displayName,
      });
    } catch {
      const provider = getPlatformProvider(platform);
      return NextResponse.json({
        found: false,
        path: null,
        platform: provider.displayName,
        installCommand: provider.installCommand,
      });
    }
  }
}
