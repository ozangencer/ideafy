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

    const documents: DocumentFile[] = [];
    const seen = new Set<string>();

    // Helper to add file without duplicates
    const addFile = (file: DocumentFile) => {
      if (!seen.has(file.path)) {
        seen.add(file.path);
        documents.push(file);
      }
    };

    // Check if project has custom document paths
    const customPaths = project.documentPaths
      ? JSON.parse(project.documentPaths)
      : null;

    if (customPaths && customPaths.length > 0) {
      // Use custom paths if configured
      const customFiles = findMarkdownFilesWithCustomPaths(
        project.folderPath,
        customPaths
      );
      customFiles.forEach(addFile);
    } else {
      // Default: Smart Discovery

      // 1. Find important root-level files
      try {
        const rootEntries = fs.readdirSync(project.folderPath, { withFileTypes: true });
        for (const entry of rootEntries) {
          if (entry.isFile() && entry.name.endsWith(".md")) {
            // Only include important root files or all root .md files
            const fullPath = path.join(project.folderPath, entry.name);
            addFile({
              name: entry.name,
              path: fullPath,
              relativePath: entry.name,
              isClaudeMd: entry.name === "CLAUDE.md",
            });
          }
        }
      } catch (error) {
        console.error("Error reading root directory:", error);
      }

      // 2. Scan document directories
      for (const dirName of DOCUMENT_DIRECTORIES) {
        const dirPath = path.join(project.folderPath, dirName);
        if (fs.existsSync(dirPath) && fs.statSync(dirPath).isDirectory()) {
          const dirFiles = findMarkdownFiles(dirPath, project.folderPath);
          dirFiles.forEach(addFile);
        }
      }
    }

    // Sort: CLAUDE.md first, README.md second, then by importance, then alphabetically
    documents.sort((a, b) => {
      // CLAUDE.md always first
      if (a.isClaudeMd) return -1;
      if (b.isClaudeMd) return 1;

      // README.md second
      if (a.name === "README.md") return -1;
      if (b.name === "README.md") return 1;

      // Important root files come before directory files
      const aIsImportant = IMPORTANT_ROOT_FILES.includes(a.name) && !a.relativePath.includes("/");
      const bIsImportant = IMPORTANT_ROOT_FILES.includes(b.name) && !b.relativePath.includes("/");
      if (aIsImportant && !bIsImportant) return -1;
      if (!aIsImportant && bIsImportant) return 1;

      // Then alphabetically by path
      return a.relativePath.localeCompare(b.relativePath);
    });

    return NextResponse.json(documents);
  } catch (error) {
    console.error("Failed to fetch documents:", error);
    return NextResponse.json(
      { error: "Failed to fetch documents" },
      { status: 500 }
    );
  }
}
