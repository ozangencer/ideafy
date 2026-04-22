import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";

const APP_BUNDLE_NAME = "Ideafy";
const APP_DISPLAY_NAME = "Ideafy (Personal)";
const EXECUTABLE_NAME = "Ideafy";

if (process.platform !== "darwin") {
  process.exit(0);
}

const projectRoot = path.resolve(import.meta.dirname, "..");
const electronDist = path.join(projectRoot, "node_modules", "electron", "dist");
const electronAppPath = path.join(electronDist, "Electron.app");
const appBundlePath = path.join(electronDist, `${APP_BUNDLE_NAME}.app`);
const sourceAppPath = fs.existsSync(appBundlePath) ? appBundlePath : electronAppPath;

if (!fs.existsSync(sourceAppPath)) {
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

if (fs.existsSync(plistPath)) {
  execFileSync("/usr/libexec/PlistBuddy", ["-c", `Set :CFBundleExecutable ${EXECUTABLE_NAME}`, plistPath]);
  execFileSync("/usr/libexec/PlistBuddy", ["-c", `Set :CFBundleName ${APP_DISPLAY_NAME}`, plistPath]);
  execFileSync("/usr/libexec/PlistBuddy", ["-c", `Set :CFBundleDisplayName ${APP_DISPLAY_NAME}`, plistPath]);
}

const sourceIconPath = path.join(projectRoot, "electron", "icons", "app-icon.icns");
const targetIconPath = path.join(resourcesDir, "electron.icns");

if (fs.existsSync(sourceIconPath)) {
  fs.copyFileSync(sourceIconPath, targetIconPath);
}
