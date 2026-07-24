import * as path from "path";
import { NextResponse } from "next/server";
import { db, schema } from "@/lib/db";
import {
  getPluginStatus,
  installPlugin,
  uninstallPlugin,
  setPluginEnabled,
  checkForUpdates,
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

// Reject an absolute-looking path with `..` traversal segments before we ever
// let it reach the provider (which writes <projectPath>/.claude/settings.json).
function isSafeProjectPath(projectPath: string): boolean {
  if (typeof projectPath !== "string" || projectPath.length === 0) return false;
  if (projectPath.includes("\0")) return false;
  if (!path.isAbsolute(projectPath)) return false;
  return !projectPath.split(/[\\/]+/).includes("..");
}

// Containment for project-scope requests: the projectPath must be safe AND
// exactly match a folder registered in the projects table. This route is the
// only caller that accepts a request-body projectPath, so binding it to a known
// project stops a crafted path from writing a settings.json anywhere on disk.
// Returns an error string to reject with, or null when the request is allowed.
function validateProjectScope(opts: ScopeOptions): string | null {
  if (opts.scope !== "project") return null;
  if (!opts.projectPath) return "projectPath is required when scope is 'project'";
  if (!isSafeProjectPath(opts.projectPath)) {
    return "Invalid projectPath: must be an absolute path with no '..' segments";
  }
  try {
    const rows = db
      .select({ folderPath: schema.projects.folderPath })
      .from(schema.projects)
      .all();
    if (!rows.some((r) => r.folderPath === opts.projectPath)) {
      return "Unknown project: projectPath does not match a registered project";
    }
  } catch (error) {
    console.error("[/api/integrations/claude-code] project lookup failed:", error);
    return "Unable to verify project";
  }
  return null;
}

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const scopeOpts = readScopeFromQuery(url);
    const scopeError = validateProjectScope(scopeOpts);
    if (scopeError) return NextResponse.json({ error: scopeError }, { status: 400 });
    const status = await getPluginStatus(scopeOpts);
    return NextResponse.json(status);
  } catch (error) {
    // Log the full stack so testers reporting "settings randomly errors"
    // can paste a useful diagnostic instead of a bare 500.
    console.error("[/api/integrations/claude-code] GET failed:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to read status" },
      { status: 500 },
    );
  }
}

interface ActionBody {
  action: "install" | "uninstall" | "enable" | "disable" | "check-updates";
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

  const scopeError = validateProjectScope(scopeOpts);
  if (scopeError) return NextResponse.json({ success: false, error: scopeError }, { status: 400 });

  switch (body.action) {
    case "install": {
      // gitUrl/localSource are intentionally not accepted from the request:
      // no legitimate client sends them, and honoring them would allow an
      // attacker-chosen clone source / lifecycle-script execution. Installs
      // always use the trusted DEFAULT_GIT_URL inside the provider.
      const result = await installPlugin({
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
    case "check-updates": {
      const result = await checkForUpdates(scopeOpts);
      return NextResponse.json({ success: !result.error, ...result });
    }
    default:
      return NextResponse.json({ error: `Unknown action: ${body.action}` }, { status: 400 });
  }
}
