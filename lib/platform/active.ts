import { db } from "../db";
import { settings } from "../db/schema";
import { eq } from "drizzle-orm";
import type { AiPlatform } from "../types";
import type { PlatformProvider } from "./types";
import { getPlatformProvider } from "./index";

/**
 * Get the active platform provider based on the DB setting.
 * Falls back to Claude if no setting is found.
 */
export function getActiveProvider(): PlatformProvider {
  try {
    const row = db
      .select()
      .from(settings)
      .where(eq(settings.key, "ai_platform"))
      .get();

    const platform = (row?.value || "claude") as AiPlatform;
    return getPlatformProvider(platform);
  } catch {
    // If DB is not available, default to Claude
    return getPlatformProvider("claude");
  }
}

/**
 * Get the provider for a specific card. Uses card-level override if set,
 * otherwise falls back to the global setting.
 */
export function getProviderForCard(card: { aiPlatform?: string | null }): PlatformProvider {
  if (card.aiPlatform) {
    return getPlatformProvider(card.aiPlatform as AiPlatform);
  }
  return getActiveProvider();
}
