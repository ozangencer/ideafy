import fs from "node:fs";
import path from "node:path";

const packageJsonPath = path.resolve(import.meta.dirname, "..", "package.json");
const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, "utf8"));
const buildConfig = packageJson.build ?? {};
const productName = buildConfig.productName ?? "Ideafy";
const explicitVariant = process.env.IDEAFY_BRAND_VARIANT?.trim().toLowerCase();

const variant =
  explicitVariant?.includes("team")
    ? "team"
    : explicitVariant?.includes("personal")
      ? "personal"
      : String(productName).toLowerCase().includes("team")
        ? "team"
        : "personal";

// Version-free artifact names so `releases/latest/download/<name>` stays a
// stable URL across releases (the README links rely on this). electron-builder
// interpolates ${arch}/${ext} itself — keep them literal in this string.
const artifactName =
  (variant === "team" ? "Ideafy-Team-" : "Ideafy-Personal-") + "${arch}.${ext}";

export default {
  ...buildConfig,
  artifactName,
  mac: {
    ...buildConfig.mac,
    icon:
      variant === "team"
        ? "electron/icons/app-icon.icns"
        : "electron/icons/app-icon-personal.icns",
  },
};
