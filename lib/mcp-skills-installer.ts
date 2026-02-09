/**
 * MCP & Skills installer - delegates to the active platform provider.
 * Kept for backward compatibility - existing imports still work.
 */
import { getActiveProvider } from "./platform/active";

export function installKanbanMcp(folderPath: string): { success: boolean; error?: string } {
  return getActiveProvider().installKanbanMcp(folderPath);
}

export function removeKanbanMcp(folderPath: string): { success: boolean; error?: string } {
  return getActiveProvider().removeKanbanMcp(folderPath);
}

export function hasKanbanMcp(folderPath: string): boolean {
  return getActiveProvider().hasKanbanMcp(folderPath);
}

export function installKanbanSkills(folderPath: string): { success: boolean; error?: string } {
  return getActiveProvider().installKanbanSkills(folderPath);
}

export function removeKanbanSkills(folderPath: string): { success: boolean; error?: string } {
  return getActiveProvider().removeKanbanSkills(folderPath);
}

export function hasKanbanSkills(folderPath: string): boolean {
  return getActiveProvider().hasKanbanSkills(folderPath);
}

export function listProjectSkills(folderPath: string): string[] {
  return getActiveProvider().listProjectSkills(folderPath);
}

export function listProjectMcps(folderPath: string): string[] {
  return getActiveProvider().listProjectMcps(folderPath);
}
