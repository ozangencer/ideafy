import { fileURLToPath } from "node:url";
import { dirname } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));

/** @type {import('next').NextConfig} */
const nextConfig = {
  // Self-contained build for the packaged DMG — produces .next/standalone/server.js
  // plus a minimal node_modules. Dev mode (`next dev`) is unaffected.
  output: "standalone",
  // Keep the tracing root anchored at the repo so standalone's dependency
  // resolution doesn't walk up out of a monorepo-style lockfile.
  outputFileTracingRoot: __dirname,
};

export default nextConfig;
