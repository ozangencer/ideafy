/**
 * Thin wrapper around the Claude provider.
 * Kept for backward compatibility - existing imports still work.
 */
import { claudeProvider } from "./platform/claude-provider";

export function getClaudePath(): string {
  return claudeProvider.getCliPath();
}

export function getClaudeEnv(): NodeJS.ProcessEnv {
  return claudeProvider.getEnv();
}

export function getClaudeCIEnv(): NodeJS.ProcessEnv {
  return claudeProvider.getCIEnv();
}
