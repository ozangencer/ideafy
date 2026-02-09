import type { AiPlatform } from "../types";
import type { PlatformProvider } from "./types";
import { claudeProvider } from "./claude-provider";
import { geminiProvider } from "./gemini-provider";
import { codexProvider } from "./codex-provider";

const providers: Record<AiPlatform, PlatformProvider> = {
  claude: claudeProvider,
  gemini: geminiProvider,
  codex: codexProvider,
};

export function getPlatformProvider(platform: AiPlatform): PlatformProvider {
  const provider = providers[platform];
  if (!provider) {
    throw new Error(`Unknown AI platform: ${platform}`);
  }
  return provider;
}

export type { PlatformProvider, PlatformCapabilities } from "./types";
