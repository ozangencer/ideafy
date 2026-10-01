import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";

const packageJsonPath = path.resolve(import.meta.dirname, "..", "package.json");
const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, "utf8"));
const APP_DISPLAY_NAME = packageJson.build?.productName || "Ideafy";
const APP_BUNDLE_NAME = APP_DISPLAY_NAME;
const EXECUTABLE_NAME = "Ideafy";
const LSREGISTER_PATH =
  "/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister";

function resolveBrandVariant() {
  const explicitVariant = process.env.IDEAFY_BRAND_VARIANT;
  if (typeof explicitVariant === "string") {
    const normalized = explicitVariant.trim().toLowerCase();
    if (normalized.includes("team")) return "team";
    if (normalized.includes("personal")) return "personal";
  }

  if (typeof APP_DISPLAY_NAME === "string" && APP_DISPLAY_NAME.toLowerCase().includes("team")) {
    return "team";
  }

  return "personal";
}

if (process.platform !== "darwin") {
  process.exit(0);
}

const projectRoot = path.resolve(import.meta.dirname, "..");
const electronDist = path.join(projectRoot, "node_modules", "electron", "dist");
const electronAppPath = path.join(electronDist, "Electron.app");
const legacyAppBundlePath = path.join(electronDist, "Ideafy.app");
const appBundlePath = path.join(electronDist, `${APP_BUNDLE_NAME}.app`);
const sourceAppPath = [appBundlePath, legacyAppBundlePath, electronAppPath].find((candidate) =>
  fs.existsSync(candidate)
);

if (!sourceAppPath) {
  process.exit(0);
}

if (sourceAppPath !== appBundlePath) {
  fs.renameSync(sourceAppPath, appBundlePath);
}

const macOsDir = path.join(appBundlePath, "Contents", "MacOS");
const resourcesDir = path.join(appBundlePath, "Contents", "Resources");
const plistPath = path.join(appBundlePath, "Contents", "Info.plist");
const electronBinaryPath = path.join(macOsDir, "Electron");
const executablePath = path.join(macOsDir, EXECUTABLE_NAME);

if (fs.existsSync(electronBinaryPath) && !fs.existsSync(executablePath)) {
  fs.renameSync(electronBinaryPath, executablePath);
}

const electronPathEntry = `${APP_BUNDLE_NAME}.app/Contents/MacOS/${EXECUTABLE_NAME}`;

fs.writeFileSync(
  path.join(projectRoot, "node_modules", "electron", "path.txt"),
  electronPathEntry,
  "utf8"
);

fs.writeFileSync(
  path.join(electronDist, "path.txt"),
  electronPathEntry,
  "utf8"
);

// Stock Electron ships as com.github.Electron, an ID every unpackaged Electron
// app on the machine shares. Notification Center resolves the banner icon by
// that ID, so without our own the banner borrows whichever app registered it
// last. The .dev suffix keeps this apart from the packaged DMG's appId.
const bundleIdentifier =
  resolveBrandVariant() === "team" ? "com.ozangencer.ideafy.team.dev" : "com.ozangencer.ideafy.dev";
let bundleChanged = false;

if (fs.existsSync(plistPath)) {
  const currentIdentifier = execFileSync(
    "/usr/libexec/PlistBuddy",
    ["-c", "Print :CFBundleIdentifier", plistPath],
    { encoding: "utf8" }
  ).trim();

  execFileSync("/usr/libexec/PlistBuddy", ["-c", `Set :CFBundleExecutable ${EXECUTABLE_NAME}`, plistPath]);
  execFileSync("/usr/libexec/PlistBuddy", ["-c", `Set :CFBundleName ${APP_DISPLAY_NAME}`, plistPath]);
  execFileSync("/usr/libexec/PlistBuddy", ["-c", `Set :CFBundleDisplayName ${APP_DISPLAY_NAME}`, plistPath]);

  if (currentIdentifier !== bundleIdentifier) {
    execFileSync("/usr/libexec/PlistBuddy", ["-c", `Set :CFBundleIdentifier ${bundleIdentifier}`, plistPath]);
    bundleChanged = true;
  }
}

const sourceIconPath = path.join(
  projectRoot,
  "electron",
  "icons",
  resolveBrandVariant() === "team" ? "app-icon.icns" : "app-icon-personal.icns"
);
const targetIconPath = path.join(resourcesDir, "electron.icns");

if (fs.existsSync(sourceIconPath)) {
  const sourceIcon = fs.readFileSync(sourceIconPath);
  if (!fs.existsSync(targetIconPath) || !sourceIcon.equals(fs.readFileSync(targetIconPath))) {
    fs.writeFileSync(targetIconPath, sourceIcon);
    bundleChanged = true;
  }
}

// Re-signing takes a few seconds and this runs before every `npm run electron`,
// so only pay for it when the identity or icon actually moved. lsregister makes
// LaunchServices drop its cached record instead of serving the old ID and icon.
if (bundleChanged) {
  try {
    execFileSync("codesign", ["--force", "--deep", "--sign", "-", appBundlePath], { stdio: "ignore" });
  } catch (error) {
    console.warn(`[prepare-dev-electron] Ad-hoc re-sign failed: ${error.message}`);
  }

  const now = new Date();
  fs.utimesSync(appBundlePath, now, now);

  if (fs.existsSync(LSREGISTER_PATH)) {
    try {
      execFileSync(LSREGISTER_PATH, ["-f", appBundlePath], { stdio: "ignore" });
    } catch (error) {
      console.warn(`[prepare-dev-electron] LaunchServices re-register failed: ${error.message}`);
    }
  }
}
