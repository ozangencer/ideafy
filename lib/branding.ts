import fs from "node:fs";
import path from "node:path";

export type BrandVariant = "personal" | "team";

function normalizeVariant(value?: string | null): BrandVariant | null {
  const normalized = value?.trim().toLowerCase();
  if (!normalized) return null;
  if (normalized.includes("team")) return "team";
  if (normalized.includes("personal")) return "personal";
  return null;
}

export function resolveBrandVariant(options?: {
  envVariant?: string | null;
  productName?: string | null;
  fallback?: BrandVariant;
}): BrandVariant {
  return (
    normalizeVariant(options?.envVariant) ??
    normalizeVariant(options?.productName) ??
    options?.fallback ??
    "personal"
  );
}

export function readProductNameFromPackageJson(): string | null {
  try {
    const packageJsonPath = path.resolve(process.cwd(), "package.json");
    const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, "utf8")) as {
      build?: { productName?: string };
    };

    return packageJson.build?.productName ?? null;
  } catch {
    return null;
  }
}

export function getBrandAssetPath(assetPath: string, variant: BrandVariant): string {
  if (variant === "team") return assetPath;

  const extension = path.extname(assetPath);
  const basename = assetPath.slice(0, -extension.length);
  return `${basename}-personal${extension}`;
}
