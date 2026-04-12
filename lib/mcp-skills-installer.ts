/**
 * MCP & Skills installer - delegates to the active platform provider.
 * Kept for backward compatibility - existing imports still work.
 */
import { getActiveProvider } from "./platform/active";

export function installIdeafyMcp(folderPath: string): { success: boolean; error?: string } {
  return getActiveProvider().installIdeafyMcp(folderPath);
}

export function removeIdeafyMcp(folderPath: string): { success: boolean; error?: string } {
  return getActiveProvider().removeIdeafyMcp(folderPath);
}

export function hasIdeafyMcp(folderPath: string): boolean {
  return getActiveProvider().hasIdeafyMcp(folderPath);
}

export function installIdeafySkills(folderPath: string): { success: boolean; error?: string } {
  return getActiveProvider().installIdeafySkills(folderPath);
}

export function removeIdeafySkills(folderPath: string): { success: boolean; error?: string } {
  return getActiveProvider().removeIdeafySkills(folderPath);
}

export function hasIdeafySkills(folderPath: string): boolean {
  return getActiveProvider().hasIdeafySkills(folderPath);
}

export function listProjectSkills(folderPath: string): string[] {
  return getActiveProvider().listProjectSkills(folderPath);
}

export function listProjectMcps(folderPath: string): string[] {
  return getActiveProvider().listProjectMcps(folderPath);
}

export function listProjectAgents(folderPath: string): string[] {
  return getActiveProvider().listProjectAgents(folderPath);
}
