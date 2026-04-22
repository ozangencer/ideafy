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

export default {
  ...buildConfig,
  mac: {
    ...buildConfig.mac,
    icon:
      variant === "team"
        ? "electron/icons/app-icon.icns"
        : "electron/icons/app-icon-personal.icns",
  },
};
