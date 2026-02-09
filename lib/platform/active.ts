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
