// electron-builder afterPack hook.
//
// Runs AFTER the .app has been assembled for one specific target arch.
// By this point electron-builder's install-app-deps has rebuilt
// root/node_modules/better-sqlite3 against the target arch, and that
// binary has been copied into <app>/Contents/Resources/app.asar.unpacked.
//
// The problem this hook fixes: Next's standalone + mcp-server ship
// their own stripped copies of better-sqlite3 which electron-builder
// does NOT rebuild. We overwrite those copies with the arch-correct
// binary so arm64 and x64 DMGs both get a working SQLite.
//
// Fires once per target arch during `electron-builder --mac`.

import { copyFileSync, existsSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "..");

const ARCH_NAMES = { 1: "ia32", 3: "armv7l", 4: "arm64", 9: "x64" };

export default async function afterPack(context) {
  const archLabel = ARCH_NAMES[context.arch] ?? `unknown(${context.arch})`;
  const appOutDir = context.appOutDir;
  const productName = context.packager.appInfo.productName;
  const appResources = path.join(appOutDir, `${productName}.app`, "Contents", "Resources");

  // The root binary has just been rebuilt for the target arch by
  // electron-builder's install-app-deps pipeline and copied into
  // app.asar.unpacked/node_modules/better-sqlite3.
  const packedRootBinary = path.join(
    appResources,
    "app.asar.unpacked",
    "node_modules",
    "better-sqlite3",
    "build",
    "Release",
    "better_sqlite3.node"
  );
  if (!existsSync(packedRootBinary)) {
    console.warn(`[afterPack ${archLabel}] asar-unpacked binary missing at ${packedRootBinary}`);
    return;
  }

  const destinations = [
    path.join(appResources, "app-next", "node_modules", "better-sqlite3", "build", "Release", "better_sqlite3.node"),
    path.join(appResources, "mcp-server", "node_modules", "better-sqlite3", "build", "Release", "better_sqlite3.node"),
  ];

  for (const dst of destinations) {
    if (!existsSync(path.dirname(dst))) {
      console.warn(`[afterPack ${archLabel}] destination parent missing: ${dst}`);
      continue;
    }
    copyFileSync(packedRootBinary, dst);
    console.log(`[afterPack ${archLabel}] fixed → ${path.relative(appOutDir, dst)}`);
  }
}
