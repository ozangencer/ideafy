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

// Auto-update feed. Without this electron-builder infers the repo from the git
// remote, which is right for the public build by accident and wrong for Team:
// the cloud checkout's remote is the private `ideafy-cloud`, where no release
// ever lands. Team binaries live in `ideafy-team-dist`, so name it explicitly.
// This value is baked into Resources/app-update.yml at pack time.
const publish = {
  provider: "github",
  owner: "ozangencer",
  repo: variant === "team" ? "ideafy-team-dist" : "ideafy",
};

export default {
  ...buildConfig,
  artifactName,
  publish,
  mac: {
    ...buildConfig.mac,
    icon:
      variant === "team"
        ? "electron/icons/app-icon.icns"
        : "electron/icons/app-icon-personal.icns",
  },
};
