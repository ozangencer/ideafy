import { NextResponse } from "next/server";
import {
  getPluginStatus,
  installPlugin,
  uninstallPlugin,
  setPluginEnabled,
  type PluginScope,
  type ScopeOptions,
} from "@/lib/platform/claude-provider/plugin-install";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function parseScope(input: unknown): PluginScope | undefined {
  if (input === "user" || input === "project") return input;
  return undefined;
}

function readScopeFromQuery(url: URL): ScopeOptions {
  return {
    scope: parseScope(url.searchParams.get("scope")),
    projectPath: url.searchParams.get("projectPath") ?? undefined,
  };
}

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const scopeOpts = readScopeFromQuery(url);
    const status = await getPluginStatus(scopeOpts);
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
  scope?: PluginScope;
  projectPath?: string;
}

export async function POST(request: Request) {
  let body: ActionBody;
  try {
    body = (await request.json()) as ActionBody;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const scopeOpts: ScopeOptions = {
    scope: parseScope(body.scope),
    projectPath: body.projectPath,
  };

  switch (body.action) {
    case "install": {
      const result = await installPlugin({
        gitUrl: body.gitUrl,
        localSource: body.localSource,
        ...scopeOpts,
      });
      if (!result.success) return NextResponse.json(result, { status: 500 });
      const status = await getPluginStatus(scopeOpts);
      return NextResponse.json({ ...result, status });
    }
    case "uninstall": {
      const result = await uninstallPlugin(scopeOpts);
      if (!result.success) return NextResponse.json(result, { status: 500 });
      const status = await getPluginStatus(scopeOpts);
      return NextResponse.json({ ...result, status });
    }
    case "enable": {
      const result = await setPluginEnabled(true, scopeOpts);
      if (!result.success) return NextResponse.json(result, { status: 500 });
      const status = await getPluginStatus(scopeOpts);
      return NextResponse.json({ ...result, status });
    }
    case "disable": {
      const result = await setPluginEnabled(false, scopeOpts);
      if (!result.success) return NextResponse.json(result, { status: 500 });
      const status = await getPluginStatus(scopeOpts);
      return NextResponse.json({ ...result, status });
    }
    default:
      return NextResponse.json({ error: `Unknown action: ${body.action}` }, { status: 400 });
  }
}
