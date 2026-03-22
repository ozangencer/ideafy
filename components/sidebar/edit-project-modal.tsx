"use client";

import { useState, useEffect } from "react";
import { useKanbanStore } from "@/lib/store";
import { Project } from "@/lib/types";
import { Switch } from "@/components/ui/switch";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Folder, Loader2, FileText, GitBranch, Plug, Terminal } from "lucide-react";
import { Textarea } from "@/components/ui/textarea";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";

interface EditProjectModalProps {
  project: Project;
  onClose: () => void;
}

const PRESET_COLORS = [
  "#5e6ad2", // Indigo (default)
  "#ef4444", // Red
  "#f97316", // Orange
  "#eab308", // Yellow
  "#22c55e", // Green
  "#06b6d4", // Cyan
  "#3b82f6", // Blue
  "#8b5cf6", // Purple
  "#ec4899", // Pink
  "#6b7280", // Gray
];

export function EditProjectModal({ project, onClose }: EditProjectModalProps) {
  const { updateProject, deleteProject, cards } = useKanbanStore();

  // Form state initialized from project
  const [name, setName] = useState(project.name);
  const [folderPath, setFolderPath] = useState(project.folderPath);
  const [idPrefix, setIdPrefix] = useState(project.idPrefix);
  const [color, setColor] = useState(project.color);
  const [documentPathsText, setDocumentPathsText] = useState(
    project.documentPaths?.join("\n") || ""
  );
  const [narrativePath, setNarrativePath] = useState(
    project.narrativePath || ""
  );
  const [useWorktrees, setUseWorktrees] = useState(project.useWorktrees ?? true);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isPickingFolder, setIsPickingFolder] = useState(false);
  const [deleteWithCards, setDeleteWithCards] = useState(false);
  const [isPickingNarrativeFile, setIsPickingNarrativeFile] = useState(false);
  const [isLaunchingSkill, setIsLaunchingSkill] = useState(false);
  const [ideafyInstalled, setKanbanInstalled] = useState<boolean | null>(null);
  const [isTogglingIdeafy, setIsTogglingKanban] = useState(false);

  // Check hook and MCP/Skills status on mount
  useEffect(() => {
    const checkStatuses = async () => {
      try {
        const [hookRes, mcpRes, skillsRes] = await Promise.all([
          fetch(`/api/projects/${project.id}/hook`),
          fetch(`/api/projects/${project.id}/mcp`),
          fetch(`/api/projects/${project.id}/skills`),
        ]);

        const [hookData, mcpData, skillsData] = await Promise.all([
          hookRes.json(),
          mcpRes.json(),
          skillsRes.json(),
        ]);

        const allInstalled = (hookData.installed ?? false) && (mcpData.installed ?? false) && (skillsData.installed ?? false);
        setKanbanInstalled(allInstalled);
      } catch (error) {
        console.error("Failed to check statuses:", error);
        setKanbanInstalled(false);
      }
    };
    checkStatuses();
  }, [project.id]);

  const handleToggleIdeafy = async (enabled: boolean) => {
    setIsTogglingKanban(true);
    try {
      const method = enabled ? "POST" : "DELETE";
      const [hookRes, mcpRes, skillsRes] = await Promise.all([
        fetch(`/api/projects/${project.id}/hook`, { method }),
        fetch(`/api/projects/${project.id}/mcp`, { method }),
        fetch(`/api/projects/${project.id}/skills`, { method }),
      ]);

      const [hookData, mcpData, skillsData] = await Promise.all([
        hookRes.json(),
        mcpRes.json(),
        skillsRes.json(),
      ]);

      if (hookRes.ok && mcpRes.ok && skillsRes.ok) {
        setKanbanInstalled(hookData.installed && mcpData.installed && skillsData.installed);
      }
    } catch (error) {
      console.error("Failed to toggle ideafy:", error);
    } finally {
      setIsTogglingKanban(false);
    }
  };

  const handleFolderPick = async () => {
    setIsPickingFolder(true);
    try {
      const response = await fetch("/api/folder-picker");
      const data = await response.json();
      if (data.path) {
        setFolderPath(data.path);
      }
    } catch (error) {
      console.error("Failed to pick folder:", error);
    } finally {
      setIsPickingFolder(false);
    }
  };

  // Count cards linked to this project
  const linkedCardCount = cards.filter((c) => c.projectId === project.id).length;

  const handleSubmit = async () => {
    if (!name.trim() || !folderPath.trim()) return;

    // Parse document paths - filter empty lines
    const documentPaths = documentPathsText
      .split("\n")
      .map((p) => p.trim())
      .filter((p) => p.length > 0);

    setIsSubmitting(true);
    try {
      await updateProject(project.id, {
        name: name.trim(),
        folderPath: folderPath.trim(),
        idPrefix: idPrefix.trim() || project.idPrefix,
        color,
        documentPaths: documentPaths.length > 0 ? documentPaths : null,
        narrativePath: narrativePath.trim() || null,
        useWorktrees,
      });
      onClose();
    } catch (error) {
      console.error("Failed to update project:", error);
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleDelete = async () => {
    try {
      await deleteProject(project.id, deleteWithCards);
      onClose();
    } catch (error) {
      console.error("Failed to delete project:", error);
    }
  };

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-[425px]">
        <DialogHeader>
          <DialogTitle>Edit Project</DialogTitle>
        </DialogHeader>

        <div className="grid gap-4 py-4">
          {/* Project Name */}
          <div className="grid gap-2">
            <label htmlFor="edit-name" className="text-sm font-medium">
              Project Name
            </label>
            <Input
              id="edit-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="My Project"
              autoFocus
            />
          </div>

          {/* Folder Path */}
          <div className="grid gap-2">
            <label htmlFor="edit-folderPath" className="text-sm font-medium">
              Folder Path
            </label>
            <div className="flex gap-2">
              <Input
                id="edit-folderPath"
                value={folderPath}
                onChange={(e) => setFolderPath(e.target.value)}
                placeholder="/Users/username/projects/my-project"
                className="flex-1"
              />
              <Button
                type="button"
                variant="outline"
                size="icon"
                onClick={handleFolderPick}
                disabled={isPickingFolder}
                title="Browse folders"
              >
                <Folder className="h-4 w-4" />
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">
              Full path to the project directory
            </p>
          </div>

          {/* ID Prefix and Color */}
          <div className="grid grid-cols-2 gap-4">
            {/* ID Prefix */}
            <div className="grid gap-2">
              <label htmlFor="edit-idPrefix" className="text-sm font-medium">
                ID Prefix
              </label>
              <Input
                id="edit-idPrefix"
                value={idPrefix}
                onChange={(e) =>
                  setIdPrefix(e.target.value.toUpperCase().slice(0, 5))
                }
                placeholder="PRJ"
                maxLength={5}
              />
            </div>

            {/* Color */}
            <div className="grid gap-2">
              <label className="text-sm font-medium">Color</label>
              <Popover>
                <PopoverTrigger asChild>
                  <Button
                    variant="outline"
                    className="w-full justify-start gap-2 h-10"
                  >
                    <div
                      className="w-4 h-4 rounded-full"
                      style={{ backgroundColor: color }}
                    />
                    <span className="text-muted-foreground text-xs font-mono">
                      {color}
                    </span>
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-48 p-2">
                  <div className="grid grid-cols-5 gap-2">
                    {PRESET_COLORS.map((presetColor) => (
                      <button
                        key={presetColor}
                        className={`w-7 h-7 rounded-md transition-all ${
                          color === presetColor
                            ? "ring-2 ring-primary ring-offset-2 ring-offset-background"
                            : "hover:scale-110"
                        }`}
                        style={{ backgroundColor: presetColor }}
                        onClick={() => setColor(presetColor)}
                      />
                    ))}
                  </div>
                  {/* Custom color input */}
                  <div className="mt-2 pt-2 border-t">
                    <Input
                      type="text"
                      value={color}
                      onChange={(e) => setColor(e.target.value)}
                      placeholder="#000000"
                      className="h-8 text-xs font-mono"
                    />
                  </div>
                </PopoverContent>
              </Popover>
            </div>
          </div>
          <p className="text-xs text-muted-foreground -mt-2">
            Task IDs: {idPrefix || "PRJ"}-1, {idPrefix || "PRJ"}-2...
          </p>

          {/* Document Paths */}
          <div className="grid gap-2">
            <div className="flex items-center gap-2">
              <FileText className="h-4 w-4 text-muted-foreground" />
              <label htmlFor="edit-documentPaths" className="text-sm font-medium">
                Document Paths
              </label>
              <span className="text-xs text-muted-foreground">(optional)</span>
            </div>
            <Textarea
              id="edit-documentPaths"
              value={documentPathsText}
              onChange={(e) => setDocumentPathsText(e.target.value)}
              placeholder="docs/&#10;specs/&#10;README.md&#10;ARCHITECTURE.md"
              className="min-h-[80px] font-mono text-sm"
            />
            <p className="text-xs text-muted-foreground">
              One path per line. Leave empty for smart discovery (CLAUDE.md, README.md,
              docs/, notes/, specs/, plans/, .github/, etc.)
            </p>
          </div>

          {/* Narrative Path */}
          <div className="grid gap-2">
            <div className="flex items-center gap-2">
              <FileText className="h-4 w-4 text-muted-foreground" />
              <label htmlFor="edit-narrativePath" className="text-sm font-medium">
                Product Narrative Path
              </label>
              <span className="text-xs text-muted-foreground">(optional)</span>
            </div>
            <div className="flex gap-2">
              <Input
                id="edit-narrativePath"
                value={narrativePath}
                onChange={(e) => setNarrativePath(e.target.value)}
                placeholder="docs/product-narrative.md"
                className="flex-1 font-mono text-sm"
              />
              <Button
                type="button"
                variant="outline"
                size="icon"
                disabled={isPickingNarrativeFile}
                title="Browse files"
                onClick={async () => {
                  setIsPickingNarrativeFile(true);
                  try {
                    const url = folderPath
                      ? `/api/file-picker?path=${encodeURIComponent(folderPath)}`
                      : "/api/file-picker";
                    const response = await fetch(url);
                    const data = await response.json();
                    if (data.path && folderPath) {
                      // Make path relative to project folder
                      const relativePath = data.path.startsWith(folderPath)
                        ? data.path.slice(folderPath.length + 1)
                        : data.path;
                      setNarrativePath(relativePath);
                    }
                  } catch (error) {
                    console.error("Failed to pick file:", error);
                  } finally {
                    setIsPickingNarrativeFile(false);
                  }
                }}
              >
                <FileText className="h-4 w-4" />
              </Button>
            </div>
            <div className="flex items-center gap-2">
              <p className="text-xs text-muted-foreground flex-1">
                Relative path to the product narrative file. Leave empty to use default (docs/product-narrative.md).
              </p>
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="shrink-0 gap-1.5 text-xs"
                disabled={isLaunchingSkill}
                onClick={async () => {
                  setIsLaunchingSkill(true);
                  try {
                    const res = await fetch(`/api/projects/${project.id}/narrative-skill`, {
                      method: "POST",
                    });
                    if (!res.ok) {
                      const data = await res.json();
                      console.error("Failed to launch skill:", data.error);
                    }
                  } catch (error) {
                    console.error("Failed to launch skill:", error);
                  } finally {
                    setIsLaunchingSkill(false);
                  }
                }}
              >
                {isLaunchingSkill ? (
                  <Loader2 className="h-3 w-3 animate-spin" />
                ) : (
                  <Terminal className="h-3 w-3" />
                )}
                Generate with Skill
              </Button>
            </div>
          </div>

          {/* Divider */}
          <div className="border-t border-border" />

          {/* Ideafy MCP & Skills */}
          <div className="flex items-center justify-between">
            <div className="space-y-0.5">
              <div className="flex items-center gap-2">
                <Plug className="h-4 w-4 text-muted-foreground" />
                <label className="text-sm font-medium">Ideafy MCP & Skills</label>
              </div>
              <p className="text-xs text-muted-foreground">
                Install ideafy tools, hook, and slash commands to this project
              </p>
            </div>
            <div className="flex items-center gap-2">
              {isTogglingIdeafy && (
                <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
              )}
              <Switch
                checked={ideafyInstalled ?? false}
                onCheckedChange={handleToggleIdeafy}
                disabled={isTogglingIdeafy || ideafyInstalled === null}
              />
            </div>
          </div>

          {/* Git Worktrees */}
          <div className="flex items-center justify-between">
            <div className="space-y-0.5">
              <div className="flex items-center gap-2">
                <GitBranch className="h-4 w-4 text-muted-foreground" />
                <label className="text-sm font-medium">Git Worktrees</label>
              </div>
              <p className="text-xs text-muted-foreground">
                {useWorktrees
                  ? "Creates isolated branches for each task"
                  : "Works directly on main branch (flow mode)"}
              </p>
            </div>
            <Switch
              checked={useWorktrees}
              onCheckedChange={setUseWorktrees}
            />
          </div>
        </div>

        <DialogFooter className="flex-row justify-between sm:justify-between">
          {/* Delete button with confirmation */}
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button
                variant="ghost"
                className="text-destructive hover:bg-destructive/10 hover:text-destructive"
              >
                Delete
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Delete project?</AlertDialogTitle>
                <AlertDialogDescription asChild>
                  <div>
                    <span>
                      This action cannot be undone. This will permanently delete the
                      project &quot;{project.name}&quot;.
                    </span>
                    {linkedCardCount > 0 && (
                      <>
                        <span className="block mt-2 text-muted-foreground">
                          {deleteWithCards
                            ? `${linkedCardCount} task${linkedCardCount > 1 ? "s" : ""} will be permanently deleted.`
                            : `${linkedCardCount} task${linkedCardCount > 1 ? "s" : ""} will be unlinked from this project but not deleted.`}
                        </span>
                        <label className="flex items-center gap-2 mt-3 cursor-pointer text-sm text-foreground">
                          <input
                            type="checkbox"
                            checked={deleteWithCards}
                            onChange={(e) => setDeleteWithCards(e.target.checked)}
                            className="rounded border-border"
                          />
                          Also delete all {linkedCardCount} task{linkedCardCount > 1 ? "s" : ""}
                        </label>
                      </>
                    )}
                  </div>
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Cancel</AlertDialogCancel>
                <AlertDialogAction
                  onClick={handleDelete}
                  className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                >
                  Delete
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>

          {/* Save/Cancel buttons */}
          <div className="flex gap-2">
            <Button variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button
              onClick={handleSubmit}
              disabled={!name.trim() || !folderPath.trim() || isSubmitting}
            >
              {isSubmitting ? "Saving..." : "Save Changes"}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
