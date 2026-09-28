"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useKanbanStore } from "@/lib/store";
import { ProjectItem } from "./project-item";
import { AddProjectModal } from "./add-project-modal";
import { EditProjectModal } from "./edit-project-modal";
import { UnpushedDialog } from "./unpushed-dialog";
import { ProjectSectionHeader } from "./project-section-header";
import { SkillGroupDialog } from "./skill-group-dialog";
import { Project } from "@/lib/types";
import { OPEN_ADD_PROJECT_EVENT, projectsInWorkspace } from "@/lib/workspace";
import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { ChevronDown, FolderPlus, Layers, Plus } from "lucide-react";

// Slower than the card poll on purpose: every tick shells out to git once per
// project, and a commit count is not worth that at the board's cadence.
const UNPUSHED_POLL_MS = 15000;

type SectionDialogState =
  | { mode: "create"; project: Project | null }
  | { mode: "rename"; sectionId: string; initialValue: string };

export function ProjectList() {
  const {
    projects: allProjects,
    activeWorkspace,
    activeProjectId,
    setActiveProject,
    isProjectListExpanded,
    toggleProjectListExpanded,
    cards,
    projectSections,
    createProjectSection,
    renameProjectSection,
    deleteProjectSection,
    moveProjectSection,
    toggleProjectSectionCollapsed,
    moveProjectToSection,
  } = useKanbanStore();
  const [isAddModalOpen, setIsAddModalOpen] = useState(false);

  // The board's empty-workspace view has its own "New … project" button; the
  // modal lives here, so it asks through a window event rather than a store
  // flag that only these two places would ever read.
  useEffect(() => {
    const open = () => setIsAddModalOpen(true);
    window.addEventListener(OPEN_ADD_PROJECT_EVENT, open);
    return () => window.removeEventListener(OPEN_ADD_PROJECT_EVENT, open);
  }, []);
  const [editingProject, setEditingProject] = useState<Project | null>(null);
  const [unpushedProject, setUnpushedProject] = useState<Project | null>(null);
  const [unpushedCounts, setUnpushedCounts] = useState<Record<string, number>>({});
  const [sectionDialog, setSectionDialog] = useState<SectionDialogState | null>(null);

  // A slow git run must not let ticks stack up on each other.
  const isLoadingCountsRef = useRef(false);

  const loadUnpushedCounts = useCallback(async () => {
    if (isLoadingCountsRef.current) return;
    isLoadingCountsRef.current = true;
    try {
      const response = await fetch("/api/projects/unpushed");
      if (!response.ok) return;
      const rows: { projectId: string; count: number }[] = await response.json();
      setUnpushedCounts(
        Object.fromEntries(rows.map((row) => [row.projectId, row.count]))
      );
    } catch {
      // A sidebar badge is not worth surfacing an error for.
    } finally {
      isLoadingCountsRef.current = false;
    }
  }, []);

  // Completing a card is what puts a commit on the local default branch, so the
  // count moves the moment that number does, rather than waiting for the next
  // poll — each refresh shells out to git once per project.
  const completedCount = useMemo(
    () => cards.filter((card) => card.status === "completed").length,
    [cards]
  );

  useEffect(() => {
    loadUnpushedCounts();
  }, [loadUnpushedCounts, completedCount]);

  // Commits and pushes happen in a terminal at least as often as they happen
  // through a card, and neither one tells this window anything. Polling is what
  // keeps the badge honest about work done outside the app. Nothing here can go
  // stale while the window is hidden, so the ticks stand down until it is back.
  useEffect(() => {
    const interval = setInterval(() => {
      if (document.visibilityState !== "visible") return;
      loadUnpushedCounts();
    }, UNPUSHED_POLL_MS);
    return () => clearInterval(interval);
  }, [loadUnpushedCounts]);

  // Coming back to the window is the moment a stale number is most likely and
  // most visible — the user has usually just been in a terminal. Focus catches
  // the switch back from another app, which leaves the window visible the whole
  // time and so never fires visibilitychange.
  useEffect(() => {
    const refreshIfVisible = () => {
      if (document.visibilityState === "visible") loadUnpushedCounts();
    };
    document.addEventListener("visibilitychange", refreshIfVisible);
    window.addEventListener("focus", refreshIfVisible);
    return () => {
      document.removeEventListener("visibilitychange", refreshIfVisible);
      window.removeEventListener("focus", refreshIfVisible);
    };
  }, [loadUnpushedCounts]);

  // The sidebar only lists the workspace on screen. Everything below — pins,
  // sections, counts — is computed from this slice, not the whole list.
  const projects = useMemo(
    () => projectsInWorkspace(allProjects, activeWorkspace),
    [allProjects, activeWorkspace]
  );

  const pinnedProjects = projects.filter((p) => p.isPinned);
  const unpinnedProjects = projects.filter((p) => !p.isPinned);
  const activeUnpinnedProject =
    activeProjectId === null
      ? null
      : unpinnedProjects.find((project) => project.id === activeProjectId) ?? null;

  const sections = useMemo(
    () =>
      [...projectSections].sort(
        (a, b) => a.order - b.order || a.createdAt.localeCompare(b.createdAt)
      ),
    [projectSections]
  );
  const sectionIds = new Set(sections.map((section) => section.id));
  // A sectionId that names no section (a stale row) reads as "no section".
  const sectionOf = (project: Project) =>
    project.sectionId && sectionIds.has(project.sectionId) ? project.sectionId : null;
  const unsectionedProjects = unpinnedProjects.filter((project) => !sectionOf(project));

  const renderProject = (project: Project) => (
    <ProjectItem
      key={project.id}
      project={project}
      isActive={project.id === activeProjectId}
      onEdit={setEditingProject}
      unpushedCount={unpushedCounts[project.id] ?? 0}
      onShowUnpushed={setUnpushedProject}
      sections={sections}
      currentSectionId={sectionOf(project)}
      onMoveToSection={(target, sectionId) => moveProjectToSection(target.id, sectionId)}
      onCreateSection={(target) => setSectionDialog({ mode: "create", project: target })}
    />
  );

  const handleSectionDialogSubmit = async (name: string) => {
    if (!sectionDialog) return;
    if (sectionDialog.mode === "rename") {
      await renameProjectSection(sectionDialog.sectionId, name);
      return;
    }
    const created = await createProjectSection(name);
    // Opened from a project's "New section…": the project goes straight in.
    if (created && sectionDialog.project) {
      await moveProjectToSection(sectionDialog.project.id, created.id);
    }
  };

  return (
    <div className="px-2 relative z-20">
      <button
        type="button"
        aria-expanded={isProjectListExpanded}
        aria-controls="projects-collapsible-content"
        onClick={toggleProjectListExpanded}
        className="flex w-full items-center justify-between rounded-md px-3 py-2 text-left text-sm font-medium text-foreground transition-colors duration-150 hover:bg-muted"
      >
        <span className="flex items-center gap-2">
          <ChevronDown
            className={`h-4 w-4 text-muted-foreground transition-transform duration-200 ${
              isProjectListExpanded ? "rotate-0" : "-rotate-90"
            }`}
          />
          <span>Projects</span>
        </span>
        <span className="text-xs font-normal text-muted-foreground">
          {projects.length}
        </span>
      </button>

      {/* Pinned Projects */}
      {pinnedProjects.length > 0 && (
        <div className="mt-3">
          <span className="text-xs text-muted-foreground px-3 uppercase tracking-wider font-medium">
            Pinned
          </span>
          <div className="mt-1 space-y-0.5">
            {pinnedProjects.map((project) => (
              <ProjectItem
                key={project.id}
                project={project}
                isActive={project.id === activeProjectId}
                onEdit={setEditingProject}
                unpushedCount={unpushedCounts[project.id] ?? 0}
                onShowUnpushed={setUnpushedProject}
              />
            ))}
          </div>
        </div>
      )}

      {!isProjectListExpanded && activeUnpinnedProject && (
        <button
          type="button"
          onClick={() => setActiveProject(activeUnpinnedProject.id)}
          className="mt-3 flex w-full items-center gap-2 rounded-md border border-border/70 bg-muted/40 px-3 py-2 text-left text-sm text-foreground transition-colors duration-150 hover:bg-muted"
        >
          <span
            aria-hidden="true"
            className="h-2 w-2 shrink-0 rounded-full"
            style={{ backgroundColor: activeUnpinnedProject.color }}
          />
          <span className="min-w-0 flex-1 truncate font-medium">
            {activeUnpinnedProject.name}
          </span>
          <span className="shrink-0 rounded bg-background/80 px-1.5 py-0.5 text-[10px] font-mono text-muted-foreground">
            {activeUnpinnedProject.idPrefix}
          </span>
        </button>
      )}

      {/* grid-rows 0fr → 1fr animates to the content's real height, so section
          headers can never push projects past a fixed max-height. A long list
          scrolls inside instead of being clipped. */}
      <div
        id="projects-collapsible-content"
        className={`grid transition-[grid-template-rows,opacity,margin] duration-200 ease-out ${
          isProjectListExpanded ? "mt-3 grid-rows-[1fr] opacity-100" : "mt-0 grid-rows-[0fr] opacity-0"
        }`}
      >
        <div className="min-h-0 overflow-hidden">
        <div className="max-h-[70vh] overflow-y-auto">
        {/* All Projects option — nothing to gather in an empty workspace */}
        {projects.length > 0 && (
        <button
          onClick={() => setActiveProject(null)}
          className={`w-full text-left pl-4 pr-3 py-2 rounded-md text-sm transition-[background-color,box-shadow,color] duration-150 flex items-center gap-2 relative overflow-hidden ${
            activeProjectId === null
              ? "bg-muted text-foreground font-medium shadow-[inset_0_0_0_1px_hsl(var(--border))]"
              : "text-muted-foreground hover:bg-muted hover:text-foreground"
          }`}
        >
          <span
            aria-hidden="true"
            className={`absolute left-0 top-1.5 bottom-1.5 w-[3px] rounded-r-sm bg-ink transition-opacity duration-150 ${
              activeProjectId === null ? "opacity-100" : "opacity-0"
            }`}
          />
          <Layers className="h-4 w-4" />
          <span>All Projects</span>
        </button>
        )}

        {/* Sections — sidebar grouping only, the board never filters by them.
            With no sections the list looks exactly as it did before. */}
        {sections.map((section, index) => {
          const sectionProjects = unpinnedProjects.filter(
            (project) => sectionOf(project) === section.id
          );
          // Sections are shared by both workspaces. One whose projects all
          // live in the other workspace is noise here; an empty one is kept,
          // since it was just made and is waiting for projects.
          const hasProjectsElsewhere = allProjects.some(
            (project) => !project.isPinned && sectionOf(project) === section.id
          );
          if (sectionProjects.length === 0 && hasProjectsElsewhere) return null;
          // A collapsed section still shows the active project, so the
          // selection never disappears from the sidebar.
          const visibleProjects = section.collapsed
            ? sectionProjects.filter((project) => project.id === activeProjectId)
            : sectionProjects;
          return (
            <div key={section.id} className="mt-3">
              <ProjectSectionHeader
                section={section}
                projectCount={sectionProjects.length}
                isFirst={index === 0}
                isLast={index === sections.length - 1}
                onToggle={() => toggleProjectSectionCollapsed(section.id)}
                onRename={() =>
                  setSectionDialog({
                    mode: "rename",
                    sectionId: section.id,
                    initialValue: section.name,
                  })
                }
                onMove={(direction) => moveProjectSection(section.id, direction)}
                onDelete={() => deleteProjectSection(section.id)}
              />
              {visibleProjects.length > 0 && (
                <div className="mt-1 space-y-0.5">{visibleProjects.map(renderProject)}</div>
              )}
            </div>
          );
        })}

        {/* The board carries the first-visit guidance; the sidebar only
            says the list is empty. */}
        {projects.length === 0 && (
          <p className="px-3 text-xs text-muted-foreground">
            No {activeWorkspace === "work" ? "Work" : "Development"} projects yet
          </p>
        )}

        {/* Projects without a section */}
        {unsectionedProjects.length > 0 && (
          <div className="mt-3">
            <span className="text-xs text-muted-foreground px-3 uppercase tracking-wider font-medium">
              {sections.length > 0 ? "Other" : "All Projects"}
            </span>
            <div className="mt-1 space-y-0.5">
              {unsectionedProjects.map(renderProject)}
            </div>
          </div>
        )}
        </div>

        {/* Add Project / New section */}
        <div className="mt-3 flex items-center gap-1">
          <Button
            variant="ghost"
            size="sm"
            className="flex-1 text-muted-foreground justify-start h-9"
            onClick={() => setIsAddModalOpen(true)}
          >
            <Plus className="h-4 w-4 mr-2" />
            Add Project
          </Button>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                aria-label="New section"
                className="h-9 w-9 shrink-0 text-muted-foreground"
                onClick={() => setSectionDialog({ mode: "create", project: null })}
              >
                <FolderPlus className="h-4 w-4" />
              </Button>
            </TooltipTrigger>
            <TooltipContent side="right">
              <p>New section</p>
            </TooltipContent>
          </Tooltip>
        </div>
        </div>
      </div>

      {isAddModalOpen && (
        <AddProjectModal onClose={() => setIsAddModalOpen(false)} />
      )}

      {editingProject && (
        <EditProjectModal
          project={editingProject}
          onClose={() => setEditingProject(null)}
        />
      )}

      <SkillGroupDialog
        open={sectionDialog !== null}
        onOpenChange={(open) => {
          if (!open) setSectionDialog(null);
        }}
        title={sectionDialog?.mode === "rename" ? "Rename Section" : "New Section"}
        description={
          sectionDialog?.mode === "rename"
            ? "Update the section name shown in the sidebar."
            : sectionDialog?.project
              ? `Group projects in the sidebar. ${sectionDialog.project.name} moves into it.`
              : "Group projects in the sidebar, e.g. Development or Business."
        }
        submitLabel={sectionDialog?.mode === "rename" ? "Rename" : "Create"}
        initialValue={sectionDialog?.mode === "rename" ? sectionDialog.initialValue : ""}
        existingNames={sections.map((section) => section.name)}
        placeholder="Section name"
        conflictMessage="A section with this name already exists."
        onSubmit={handleSectionDialogSubmit}
      />

      {unpushedProject && (
        <UnpushedDialog
          project={unpushedProject}
          onClose={() => setUnpushedProject(null)}
          onRefreshed={loadUnpushedCounts}
        />
      )}
    </div>
  );
}
