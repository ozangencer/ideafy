"use client";

import { useState, useEffect, type ReactNode } from "react";
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
import { Loader2, FileText, GitBranch, Plug, Terminal } from "lucide-react";
import { Textarea } from "@/components/ui/textarea";
import { BasicInfoFields } from "./project-form/basic-info-fields";

interface EditProjectModalProps {
  project: Project;
  onClose: () => void;
  teamAssignmentSlot?: ReactNode;
  extraSavePayload?: () => Record<string, unknown>;
  modal?: boolean;
}

export function EditProjectModal({
  project,
  onClose,
  teamAssignmentSlot,
  extraSavePayload,
  modal,
}: EditProjectModalProps) {
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
        ...(extraSavePayload?.() ?? {}),
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
    <Dialog open onOpenChange={(open) => !open && onClose()} modal={modal}>
      <DialogContent className="sm:max-w-[550px] max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Edit Project</DialogTitle>
        </DialogHeader>

        <div className="grid gap-4 py-4">
          <BasicInfoFields
            name={name}
            onNameChange={setName}
            folderPath={folderPath}
            onFolderPathChange={setFolderPath}
            idPrefix={idPrefix}
            onIdPrefixChange={setIdPrefix}
            color={color}
            onColorChange={setColor}
            inputIdPrefix="edit-"
            autoFocusName
          />
          <p className="text-xs text-muted-foreground -mt-2">
            Task IDs: {idPrefix || "PRJ"}-1, {idPrefix || "PRJ"}-2...
          </p>

          {teamAssignmentSlot}

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
                Install ideafy tools, phase-aware hook, and slash commands in this project
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
