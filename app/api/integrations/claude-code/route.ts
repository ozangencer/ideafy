import { NextResponse } from "next/server";
import {
  getPluginStatus,
  installPlugin,
  uninstallPlugin,
  setPluginEnabled,
} from "@/lib/platform/claude-provider/plugin-install";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const status = await getPluginStatus();
    return NextResponse.json(status);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to read status" },
      { status: 500 },
    );
  }
}

interface ActionBody {
  action: "install" | "uninstall" | "enable" | "disable";
  gitUrl?: string;
  localSource?: string;
}

export async function POST(request: Request) {
  let body: ActionBody;
  try {
    body = (await request.json()) as ActionBody;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  switch (body.action) {
    case "install": {
      const result = await installPlugin({ gitUrl: body.gitUrl, localSource: body.localSource });
      if (!result.success) return NextResponse.json(result, { status: 500 });
      const status = await getPluginStatus();
      return NextResponse.json({ ...result, status });
    }
    case "uninstall": {
      const result = await uninstallPlugin();
      if (!result.success) return NextResponse.json(result, { status: 500 });
      const status = await getPluginStatus();
      return NextResponse.json({ ...result, status });
    }
    case "enable": {
      const result = await setPluginEnabled(true);
      if (!result.success) return NextResponse.json(result, { status: 500 });
      const status = await getPluginStatus();
      return NextResponse.json({ ...result, status });
    }
    case "disable": {
      const result = await setPluginEnabled(false);
      if (!result.success) return NextResponse.json(result, { status: 500 });
      const status = await getPluginStatus();
      return NextResponse.json({ ...result, status });
    }
    default:
      return NextResponse.json({ error: `Unknown action: ${body.action}` }, { status: 400 });
  }
}
