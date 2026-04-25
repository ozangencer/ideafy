import path from "node:path";
import fs from "node:fs";
import { appResourcesRoot } from "../paths";

export interface McpInvocation {
  command: string;
  args: string[];
  env?: Record<string, string>;
}

// How Claude Desktop / Gemini / Codex should spawn the Ideafy MCP server.
// Dev runs the TypeScript source through tsx; packaged runs the compiled
// JS under the bundled Electron Node so the better-sqlite3 binding (built
// against the Electron ABI at pack time) matches at runtime.
export function buildMcpInvocation(): McpInvocation {
  if (process.env.IDEAFY_PACKAGED === "1") {
    const electronExec = process.env.IDEAFY_ELECTRON_EXEC;
    const mcpEntry = process.env.IDEAFY_MCP_ENTRY;
    const userData = process.env.IDEAFY_USER_DATA;

    if (!electronExec || !mcpEntry || !userData) {
      throw new Error(
        "Packaged MCP invocation missing required env vars " +
          "(IDEAFY_ELECTRON_EXEC / IDEAFY_MCP_ENTRY / IDEAFY_USER_DATA)"
      );
    }

    return {
      command: electronExec,
      args: [mcpEntry],
      env: {
        ELECTRON_RUN_AS_NODE: "1",
        IDEAFY_USER_DATA: userData,
      },
    };
  }

  // Dev: prefer the compiled JS runtime so Claude plugin, Codex, Gemini, and
  // OpenCode all exercise the same MCP artifact. Fall back to tsx only when
  // the dist bundle is missing during local development.
  const distEntry = path.resolve(appResourcesRoot(), "mcp-server", "dist", "index.js");
  if (fs.existsSync(distEntry)) {
    return {
      command: "node",
      args: [distEntry],
    };
  }

  return {
    command: "npx",
    args: ["tsx", path.resolve(appResourcesRoot(), "mcp-server/index.ts")],
  };
}
