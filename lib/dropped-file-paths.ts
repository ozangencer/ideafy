"use client";

export interface DroppedEditorFile {
  file: File;
  path: string | null;
  formattedPath: string | null;
  isImage: boolean;
}

function normalizePath(pathValue: string): string {
  const withForwardSlashes = pathValue.replace(/\\/g, "/");
  const withoutTrailingSlash =
    withForwardSlashes.length > 1 ? withForwardSlashes.replace(/\/+$/, "") : withForwardSlashes;
  return withoutTrailingSlash || "/";
}

function readElectronFilePath(file: File): string | null {
  const electronApi = (
    window as Window & {
      electronAPI?: {
        getPathForFile?: (file: File) => string;
      };
    }
  ).electronAPI;

  if (typeof electronApi?.getPathForFile === "function") {
    const pathFromBridge = electronApi.getPathForFile(file);
    if (pathFromBridge) {
      return pathFromBridge;
    }
  }

  const fileWithPath = file as File & { path?: string };
  return typeof fileWithPath.path === "string" && fileWithPath.path.length > 0
    ? fileWithPath.path
    : null;
}

export function formatDroppedFilePath(filePath: string, projectPath?: string | null): string {
  const normalizedFilePath = normalizePath(filePath);
  const normalizedProjectPath = projectPath ? normalizePath(projectPath) : null;

  if (!normalizedProjectPath) {
    return normalizedFilePath;
  }

  if (normalizedFilePath === normalizedProjectPath) {
    return normalizedFilePath;
  }

  const prefix = `${normalizedProjectPath}/`;
  if (normalizedFilePath.startsWith(prefix)) {
    return normalizedFilePath.slice(prefix.length);
  }

  return normalizedFilePath;
}

export function getDroppedEditorFiles(
  dataTransfer: DataTransfer | null | undefined,
  projectPath?: string | null,
): DroppedEditorFile[] {
  if (!dataTransfer?.files?.length) {
    return [];
  }

  return Array.from(dataTransfer.files)
    .map((file) => {
      const filePath = readElectronFilePath(file);
      const isImage = file.type.startsWith("image/");
      if (!filePath && !isImage) {
        return null;
      }

      return {
        file,
        path: filePath ? normalizePath(filePath) : null,
        formattedPath: filePath ? formatDroppedFilePath(filePath, projectPath) : null,
        isImage,
      } satisfies DroppedEditorFile;
    })
    .filter((file): file is DroppedEditorFile => file !== null);
}

export function buildDroppedFilePathText(files: DroppedEditorFile[]): string {
  return files
    .map((file) => file.formattedPath)
    .filter((path): path is string => Boolean(path))
    .join("\n");
}
