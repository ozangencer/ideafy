import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import fs from "fs";
import path from "path";
import { DocumentFile } from "@/lib/types";
import { safeResolvePath } from "@/lib/path-utils";

// Smart discovery configuration
const IMPORTANT_ROOT_FILES = [
  "CLAUDE.md",
  "README.md",
  "CONTRIBUTING.md",
  "CHANGELOG.md",
  "LICENSE.md",
  "ARCHITECTURE.md",
  "SECURITY.md",
];

const DOCUMENT_DIRECTORIES = [
  "docs",
  "documentation",
  "wiki",
  "notes",
  "specs",
  "design",
  "architecture",
  "adr",
  "plans",
  ".github",
];

const SKIP_DIRECTORIES = [
  "node_modules",
  "dist",
  "build",
  ".git",
  ".next",
  "coverage",
  "__pycache__",
  "venv",
  ".venv",
];

function findMarkdownFiles(
  dir: string,
  baseDir: string,
  maxDepth: number = 3,
  currentDepth: number = 0
): DocumentFile[] {
  const files: DocumentFile[] = [];

  if (currentDepth > maxDepth) return files;

  try {
    const entries = fs.readdirSync(dir, { withFileTypes: true });

    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);

      if (entry.isDirectory()) {
        // Skip non-relevant directories
        if (SKIP_DIRECTORIES.includes(entry.name)) {
          continue;
        }
        // Skip hidden directories except .github
        if (entry.name.startsWith(".") && entry.name !== ".github") {
          continue;
        }

        // Recurse into subdirectories
        files.push(...findMarkdownFiles(fullPath, baseDir, maxDepth, currentDepth + 1));
      } else if (entry.name.endsWith(".md")) {
        const relativePath = path.relative(baseDir, fullPath);
        files.push({
          name: entry.name,
          path: fullPath,
          relativePath,
          isClaudeMd: entry.name === "CLAUDE.md",
        });
      }
    }
  } catch (error) {
    console.error("Error reading directory:", dir, error);
  }

  return files;
}

function findMarkdownFilesWithCustomPaths(
  baseDir: string,
  customPaths: string[]
): DocumentFile[] {
  const files: DocumentFile[] = [];
  const seen = new Set<string>();

  for (const pattern of customPaths) {
    // Validate path doesn't escape base directory
    const fullPath = safeResolvePath(baseDir, pattern);
    if (!fullPath) continue; // Skip paths that escape the base directory

    // Check if it's a directory
    if (fs.existsSync(fullPath) && fs.statSync(fullPath).isDirectory()) {
      const dirFiles = findMarkdownFiles(fullPath, baseDir);
      for (const file of dirFiles) {
        if (!seen.has(file.path)) {
          seen.add(file.path);
          files.push(file);
        }
      }
    }
    // Check if it's a direct file
    else if (fs.existsSync(fullPath) && fullPath.endsWith(".md")) {
      if (!seen.has(fullPath)) {
        seen.add(fullPath);
        const relativePath = path.relative(baseDir, fullPath);
        files.push({
          name: path.basename(fullPath),
          path: fullPath,
          relativePath,
          isClaudeMd: path.basename(fullPath) === "CLAUDE.md",
        });
      }
    }
  }

  return files;
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;

    const project = db
      .select()
      .from(schema.projects)
      .where(eq(schema.projects.id, id))
      .get();

    if (!project) {
      return NextResponse.json({ error: "Project not found" }, { status: 404 });
    }

    // Check if folder exists
    if (!fs.existsSync(project.folderPath)) {
      return NextResponse.json([]);
    }

    const seen = new Set<string>();
    const customDocs: DocumentFile[] = [];
    const discoveredDocs: DocumentFile[] = [];

    // Parse custom paths (preserves user order)
    const customPaths: string[] | null = project.documentPaths
      ? JSON.parse(project.documentPaths)
      : null;

    // 1. Custom paths — user-explicit, priority placement
    if (customPaths && customPaths.length > 0) {
      const customFiles = findMarkdownFilesWithCustomPaths(
        project.folderPath,
        customPaths
      );
      for (const file of customFiles) {
        if (seen.has(file.path)) continue;
        seen.add(file.path);
        customDocs.push({ ...file, source: "custom" });
      }
    }

    // 2. Smart discovery — always runs, fills gaps
    const discoveredBuffer: DocumentFile[] = [];

    try {
      const rootEntries = fs.readdirSync(project.folderPath, { withFileTypes: true });
      for (const entry of rootEntries) {
        if (entry.isFile() && entry.name.endsWith(".md")) {
          const fullPath = path.join(project.folderPath, entry.name);
          if (seen.has(fullPath)) continue;
          seen.add(fullPath);
          discoveredBuffer.push({
            name: entry.name,
            path: fullPath,
            relativePath: entry.name,
            isClaudeMd: entry.name === "CLAUDE.md",
            source: "discovered",
          });
        }
      }
    } catch (error) {
      console.error("Error reading root directory:", error);
    }

    for (const dirName of DOCUMENT_DIRECTORIES) {
      const dirPath = path.join(project.folderPath, dirName);
      if (fs.existsSync(dirPath) && fs.statSync(dirPath).isDirectory()) {
        const dirFiles = findMarkdownFiles(dirPath, project.folderPath);
        for (const file of dirFiles) {
          if (seen.has(file.path)) continue;
          seen.add(file.path);
          discoveredBuffer.push({ ...file, source: "discovered" });
        }
      }
    }

    // Sort discovered: CLAUDE.md > README.md > other important root files > alphabetical
    discoveredBuffer.sort((a, b) => {
      if (a.isClaudeMd) return -1;
      if (b.isClaudeMd) return 1;
      if (a.name === "README.md") return -1;
      if (b.name === "README.md") return 1;
      const aIsImportant = IMPORTANT_ROOT_FILES.includes(a.name) && !a.relativePath.includes("/");
      const bIsImportant = IMPORTANT_ROOT_FILES.includes(b.name) && !b.relativePath.includes("/");
      if (aIsImportant && !bIsImportant) return -1;
      if (!aIsImportant && bIsImportant) return 1;
      return a.relativePath.localeCompare(b.relativePath);
    });

    discoveredDocs.push(...discoveredBuffer);

    return NextResponse.json([...customDocs, ...discoveredDocs]);
  } catch (error) {
    console.error("Failed to fetch documents:", error);
    return NextResponse.json(
      { error: "Failed to fetch documents" },
      { status: 500 }
    );
  }
}
