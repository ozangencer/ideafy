import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";

/**
 * MCP Settings Merge Tests
 *
 * Mevcut .claude/settings.json varsa bozulmuyor (merge çalışıyor) senaryosunu test eder.
 * ClaudeProvider.installKanbanMcp() ve removeKanbanMcp() doğrudan çağrılır.
 */

import { claudeProvider } from "../lib/platform/claude-provider";

let tmpDir: string;

function settingsPath(): string {
  return path.join(tmpDir, ".claude", "settings.json");
}

function writeSettings(content: Record<string, unknown>): void {
  const dir = path.join(tmpDir, ".claude");
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(settingsPath(), JSON.stringify(content, null, 2));
}

function readSettings(): Record<string, unknown> {
  return JSON.parse(fs.readFileSync(settingsPath(), "utf-8"));
}

describe("MCP Settings Merge — installKanbanMcp", () => {
  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "kanban-merge-test-"));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  // ── Happy Path ──

  it("boş klasöre kurulumda settings.json doğru oluşturulmalı", () => {
    const result = claudeProvider.installKanbanMcp(tmpDir);

    expect(result.success).toBe(true);
    expect(fs.existsSync(settingsPath())).toBe(true);

    const settings = readSettings();
    expect(settings.mcpServers).toBeDefined();
    expect((settings.mcpServers as any).kanban).toBeDefined();
    expect((settings.mcpServers as any).kanban.command).toBe("npx");
  });

  it("mevcut settings.json'daki diğer alanlar korunmalı", () => {
    writeSettings({
      permissions: { allow: ["Read", "Write"] },
      theme: "dark",
    });

    const result = claudeProvider.installKanbanMcp(tmpDir);

    expect(result.success).toBe(true);
    const settings = readSettings();
    expect(settings.permissions).toEqual({ allow: ["Read", "Write"] });
    expect(settings.theme).toBe("dark");
    expect((settings.mcpServers as any).kanban).toBeDefined();
  });

  it("mevcut mcpServers'daki diğer server'lar korunmalı", () => {
    writeSettings({
      mcpServers: {
        memory: { command: "npx", args: ["@anthropic/memory-server"] },
        fetch: { command: "npx", args: ["@anthropic/fetch-server"] },
      },
    });

    const result = claudeProvider.installKanbanMcp(tmpDir);

    expect(result.success).toBe(true);
    const settings = readSettings();
    const mcpServers = settings.mcpServers as Record<string, any>;
    expect(mcpServers.memory).toEqual({ command: "npx", args: ["@anthropic/memory-server"] });
    expect(mcpServers.fetch).toEqual({ command: "npx", args: ["@anthropic/fetch-server"] });
    expect(mcpServers.kanban).toBeDefined();
  });

  it("kanban zaten varsa tekrar kurulumda dosya değişmemeli", () => {
    claudeProvider.installKanbanMcp(tmpDir);
    const firstContent = fs.readFileSync(settingsPath(), "utf-8");

    const result = claudeProvider.installKanbanMcp(tmpDir);

    expect(result.success).toBe(true);
    const secondContent = fs.readFileSync(settingsPath(), "utf-8");
    expect(secondContent).toBe(firstContent);
  });

  it("settings.json + mcpServers + diğer alanlar birlikte merge edilmeli", () => {
    writeSettings({
      permissions: { allow: ["Bash"] },
      mcpServers: {
        sqlite: { command: "npx", args: ["sqlite-server"] },
      },
      allowedTools: ["Read", "Write"],
    });

    claudeProvider.installKanbanMcp(tmpDir);

    const settings = readSettings();
    expect(settings.permissions).toEqual({ allow: ["Bash"] });
    expect(settings.allowedTools).toEqual(["Read", "Write"]);
    expect((settings.mcpServers as any).sqlite).toEqual({ command: "npx", args: ["sqlite-server"] });
    expect((settings.mcpServers as any).kanban).toBeDefined();
  });

  // ── Edge Cases ──

  it("bozuk JSON içeren settings.json varsa sıfırdan oluşturmalı", () => {
    const dir = path.join(tmpDir, ".claude");
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(settingsPath(), "{ invalid json !!!");

    const result = claudeProvider.installKanbanMcp(tmpDir);

    expect(result.success).toBe(true);
    const settings = readSettings();
    expect((settings.mcpServers as any).kanban).toBeDefined();
  });

  it("boş settings.json ({}) varsa kanban eklenmeli", () => {
    writeSettings({});

    const result = claudeProvider.installKanbanMcp(tmpDir);

    expect(result.success).toBe(true);
    const settings = readSettings();
    expect((settings.mcpServers as any).kanban).toBeDefined();
  });

  // ── Remove + Merge ──

  it("removeKanbanMcp diğer mcpServers'ları korumalı", () => {
    writeSettings({
      mcpServers: {
        memory: { command: "npx", args: ["memory-server"] },
        kanban: { command: "npx", args: ["tsx", "mcp-server/index.ts"] },
      },
      permissions: { allow: ["Bash"] },
    });

    const result = claudeProvider.removeKanbanMcp(tmpDir);

    expect(result.success).toBe(true);
    const settings = readSettings();
    expect((settings.mcpServers as any).kanban).toBeUndefined();
    expect((settings.mcpServers as any).memory).toEqual({ command: "npx", args: ["memory-server"] });
    expect(settings.permissions).toEqual({ allow: ["Bash"] });
  });

  it("removeKanbanMcp — kanban tek server ise mcpServers key'i silinmeli", () => {
    writeSettings({
      mcpServers: {
        kanban: { command: "npx", args: ["tsx", "mcp-server/index.ts"] },
      },
      theme: "dark",
    });

    claudeProvider.removeKanbanMcp(tmpDir);

    const settings = readSettings();
    expect(settings.mcpServers).toBeUndefined();
    expect(settings.theme).toBe("dark");
  });

  it("install → remove → install döngüsünde diğer alanlar bozulmamalı", () => {
    writeSettings({
      permissions: { allow: ["Read"] },
      mcpServers: {
        fetch: { command: "npx", args: ["fetch-server"] },
      },
    });

    claudeProvider.installKanbanMcp(tmpDir);
    claudeProvider.removeKanbanMcp(tmpDir);
    claudeProvider.installKanbanMcp(tmpDir);

    const settings = readSettings();
    expect(settings.permissions).toEqual({ allow: ["Read"] });
    expect((settings.mcpServers as any).fetch).toEqual({ command: "npx", args: ["fetch-server"] });
    expect((settings.mcpServers as any).kanban).toBeDefined();
  });
});
