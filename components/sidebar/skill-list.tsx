"use client";

import { useMemo, useState } from "react";
import { useKanbanStore } from "@/lib/store";
import type { SkillListItem, SkillSource, UserSkillGroup } from "@/lib/types";
import {
  findSkillGroupId,
  resolveSkillGroups,
  type ResolvedSkillGroup,
} from "@/lib/skills/grouping";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { Button } from "@/components/ui/button";
import { SkillGroupDialog } from "./skill-group-dialog";
import { SkillMovePopover } from "./skill-move-popover";
import {
  ChevronRight,
  Zap,
  Check,
  Copy,
  FileText,
  FolderPlus,
  MoreHorizontal,
  MoveRight,
  Pencil,
  Trash2,
} from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

type ScopeSection = {
  label: string;
  groups: ResolvedSkillGroup[];
};

type GroupDialogState =
  | {
      mode: "create";
      source: SkillSource;
      skillToAssign: SkillListItem | null;
    }
  | {
      mode: "rename";
      source: SkillSource;
      groupId: string;
      initialValue: string;
    };

const INLINE_SKILL_ACTIONS_MIN_WIDTH = 280;

type GroupActionsProps = {
  canInlineActions: boolean;
  group: ResolvedSkillGroup;
  onRename: () => void;
  onDelete: () => void;
};

function GroupActions({
  canInlineActions,
  group,
  onRename,
  onDelete,
}: GroupActionsProps) {
  if (!group.canManage || !group.id) return null;

  if (canInlineActions) {
    return (
      <div className="flex items-center gap-1">
        <Button
          variant="ghost"
          size="icon"
          className="h-6 w-6 text-muted-foreground hover:text-foreground"
          onClick={(event) => {
            event.stopPropagation();
            onRename();
          }}
          title="Rename group"
        >
          <Pencil className="h-3.5 w-3.5" />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          className="h-6 w-6 text-muted-foreground hover:text-destructive"
          onClick={(event) => {
            event.stopPropagation();
            onDelete();
          }}
          title="Delete group"
        >
          <Trash2 className="h-3.5 w-3.5" />
        </Button>
      </div>
    );
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className="h-6 w-6 text-muted-foreground hover:text-foreground"
          onClick={(event) => event.stopPropagation()}
          title="Group actions"
        >
          <MoreHorizontal className="h-3.5 w-3.5" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-40">
        <DropdownMenuItem
          onClick={(event) => {
            event.stopPropagation();
            onRename();
          }}
        >
          <Pencil className="h-3.5 w-3.5" />
          Rename group
        </DropdownMenuItem>
        <DropdownMenuItem
          onClick={(event) => {
            event.stopPropagation();
            onDelete();
          }}
          className="text-destructive focus:text-destructive"
        >
          <Trash2 className="h-3.5 w-3.5" />
          Delete group
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

type SkillActionsProps = {
  canInlineActions: boolean;
  copiedSkill: string | null;
  currentGroupId: string | null;
  groups: UserSkillGroup[];
  isOrganizing: boolean;
  onCopy: () => void;
  onCreateGroup: () => void;
  onMoveToGroup: (groupId: string | null) => void;
  skillName: string;
};

function SkillActions({
  canInlineActions,
  copiedSkill,
  currentGroupId,
  groups,
  isOrganizing,
  onCopy,
  onCreateGroup,
  onMoveToGroup,
  skillName,
}: SkillActionsProps) {
  if (canInlineActions) {
    return (
      <div className="mr-1 flex h-full w-14 shrink-0 items-start justify-end gap-0.5 py-1">
        {isOrganizing && (
          <SkillMovePopover
            groups={groups}
            currentGroupId={currentGroupId}
            onMoveToGroup={onMoveToGroup}
            onCreateGroup={onCreateGroup}
          />
        )}

        <button
          onClick={onCopy}
          className="flex h-[26px] w-[26px] items-center justify-center rounded-md text-muted-foreground/80 transition-colors hover:bg-background hover:text-foreground"
          title={`Copy /${skillName}`}
        >
          {copiedSkill === skillName ? (
            <Check className="h-3.5 w-3.5 text-green-500" />
          ) : (
            <Copy className="h-3.5 w-3.5" />
          )}
        </button>
      </div>
    );
  }

  return (
    <div className="mr-1 w-8 shrink-0 py-1">
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7 text-muted-foreground hover:text-foreground"
            title="Skill actions"
          >
            <MoreHorizontal className="h-3.5 w-3.5" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-48">
          <DropdownMenuItem onClick={onCopy}>
            {copiedSkill === skillName ? (
              <Check className="h-3.5 w-3.5 text-green-500" />
            ) : (
              <Copy className="h-3.5 w-3.5" />
            )}
            Copy /{skillName}
          </DropdownMenuItem>

          {isOrganizing && (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuSub>
                <DropdownMenuSubTrigger>
                  <MoveRight className="h-3.5 w-3.5" />
                  Move to group
                </DropdownMenuSubTrigger>
                <DropdownMenuSubContent className="w-52">
                  {groups.map((skillGroup) => {
                    const isCurrent = currentGroupId === skillGroup.id;
                    return (
                      <DropdownMenuItem
                        key={skillGroup.id}
                        onClick={() => onMoveToGroup(skillGroup.id)}
                      >
                        <span className="truncate">{skillGroup.name}</span>
                        {isCurrent && (
                          <span className="ml-auto text-xs text-muted-foreground">Current</span>
                        )}
                      </DropdownMenuItem>
                    );
                  })}
                  <DropdownMenuItem onClick={() => onMoveToGroup(null)}>
                    <span>Ungrouped</span>
                    {currentGroupId === null && (
                      <span className="ml-auto text-xs text-muted-foreground">Current</span>
                    )}
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem onClick={onCreateGroup}>
                    <FolderPlus className="h-3.5 w-3.5" />
                    New Group
                  </DropdownMenuItem>
                </DropdownMenuSubContent>
              </DropdownMenuSub>
            </>
          )}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}

function resolveLegacyGroups(
  items: SkillListItem[],
  source: SkillSource,
  fallbackLabel: string
): ResolvedSkillGroup[] {
  const grouped = new Map<string, SkillListItem[]>();

  items.forEach((item) => {
    const groupName = item.group || fallbackLabel;
    const existing = grouped.get(groupName) || [];
    existing.push(item);
    grouped.set(groupName, existing);
  });

  return Array.from(grouped.entries())
    .sort(([groupA], [groupB]) => {
      if (groupA === fallbackLabel) return 1;
      if (groupB === fallbackLabel) return -1;
      return groupA.localeCompare(groupB);
    })
    .map(([name, groupedItems]) => ({
      id: null,
      name,
      items: groupedItems,
      source,
      isUngrouped: name === fallbackLabel,
      canManage: false,
    }));
}

function getSkillGroupKey(
  group: ResolvedSkillGroup,
  activeProjectId: string | null
): string {
  if (group.id) {
    return group.source === "project" && activeProjectId
      ? `project:${activeProjectId}:${group.id}`
      : `global:${group.id}`;
  }

  return group.source === "project" && activeProjectId
    ? `project:${activeProjectId}:legacy:${group.name}`
    : `global:legacy:${group.name}`;
}

export function SkillList() {
  const {
    skills,
    projectSkills,
    skillItems,
    projectSkillItems,
    selectedSkill,
    openSkillPreview,
    activeProjectId,
    sidebarWidth,
    collapsedSkillGroups,
    globalSkillGroups,
    projectSkillGroups,
    createSkillGroup,
    renameSkillGroup,
    deleteSkillGroup,
    moveSkillToGroup,
    toggleSkillGroupCollapse,
  } = useKanbanStore();

  const [copiedSkill, setCopiedSkill] = useState<string | null>(null);
  const [isOrganizing, setIsOrganizing] = useState(false);
  const [dialogState, setDialogState] = useState<GroupDialogState | null>(null);
  const canInlineActions = sidebarWidth >= INLINE_SKILL_ACTIONS_MIN_WIDTH;

  const globalItems = useMemo(() => {
    const deduped = new Map<string, SkillListItem>();
    skillItems.forEach((item) => deduped.set(item.name, item));

    const fallbackNames = Array.from(new Set(skills)).sort();
    fallbackNames.forEach((name) => {
      if (!deduped.has(name)) {
        deduped.set(name, {
          name,
          title: name,
          path: "",
          group: null,
          description: null,
          source: "global",
        });
      }
    });

    return Array.from(deduped.values()).sort((a, b) => a.name.localeCompare(b.name));
  }, [skillItems, skills]);

  const currentProjectGroups = activeProjectId
    ? projectSkillGroups[activeProjectId] || []
    : [];

  const projectItems = useMemo(() => {
    const deduped = new Map<string, SkillListItem>();
    projectSkillItems.forEach((item) => deduped.set(item.name, item));

    const fallbackNames = Array.from(new Set(projectSkills)).sort();
    fallbackNames.forEach((name) => {
      if (!deduped.has(name)) {
        deduped.set(name, {
          name,
          title: name,
          path: "",
          group: null,
          description: null,
          source: "project",
        });
      }
    });

    return Array.from(deduped.values()).sort((a, b) => a.name.localeCompare(b.name));
  }, [projectSkillItems, projectSkills]);

  const resolvedProjectGroups = useMemo(() => {
    if (projectItems.length === 0) return [];
    if (currentProjectGroups.length > 0) {
      return resolveSkillGroups(
        projectItems,
        currentProjectGroups,
        "project",
        "Project Skills",
        { includeEmptyGroups: isOrganizing }
      );
    }
    return resolveLegacyGroups(projectItems, "project", "Project Skills");
  }, [currentProjectGroups, isOrganizing, projectItems]);

  const resolvedGlobalGroups = useMemo(() => {
    if (globalItems.length === 0) return [];
    if (globalSkillGroups.length > 0) {
      return resolveSkillGroups(globalItems, globalSkillGroups, "global", "Ungrouped", {
        includeEmptyGroups: isOrganizing,
      });
    }
    return resolveLegacyGroups(globalItems, "global", "Ungrouped");
  }, [globalItems, globalSkillGroups, isOrganizing]);

  const scopeSections = useMemo<ScopeSection[]>(() => {
    const sections: ScopeSection[] = [];

    if (resolvedProjectGroups.length > 0) {
      sections.push({ label: "Project", groups: resolvedProjectGroups });
    }

    if (resolvedGlobalGroups.length > 0) {
      sections.push({
        label: resolvedProjectGroups.length > 0 ? "Global" : "Skills",
        groups: resolvedGlobalGroups,
      });
    }

    return sections;
  }, [resolvedGlobalGroups, resolvedProjectGroups]);

  const allSkillCount = scopeSections.reduce(
    (total, section) =>
      total + section.groups.reduce((groupTotal, group) => groupTotal + group.items.length, 0),
    0
  );

  const copyToClipboard = (skill: string) => {
    navigator.clipboard.writeText(`/${skill}`);
    setCopiedSkill(skill);
    setTimeout(() => setCopiedSkill(null), 1500);
  };

  const openCreateDialog = (source: SkillSource, skillToAssign: SkillListItem | null = null) => {
    setDialogState({
      mode: "create",
      source,
      skillToAssign,
    });
  };

  const handleDialogSubmit = async (name: string) => {
    if (!dialogState) return;

    if (dialogState.mode === "create") {
      const projectId = dialogState.source === "project" ? activeProjectId : null;
      const groupId = await createSkillGroup(name, dialogState.source, projectId);

      if (groupId && dialogState.skillToAssign) {
        await moveSkillToGroup(
          dialogState.skillToAssign.name,
          groupId,
          dialogState.source,
          projectId
        );
      }
      return;
    }

    const projectId = dialogState.source === "project" ? activeProjectId : null;
    await renameSkillGroup(dialogState.groupId, name, dialogState.source, projectId);
  };

  const globalGroupNames = globalSkillGroups.map((group) => group.name);
  const projectGroupNames = currentProjectGroups.map((group) => group.name);

  if (allSkillCount === 0) return null;

  return (
    <>
      <Collapsible defaultOpen={false} className="px-2 mt-4">
        <div className="flex items-center gap-2 pr-1">
          <CollapsibleTrigger className="flex min-w-0 flex-1 items-center gap-2 px-3 py-1.5 text-[11px] font-medium uppercase tracking-[0.14em] text-muted-foreground transition-colors hover:text-foreground group">
            <ChevronRight className="h-3 w-3 transition-transform group-data-[state=open]:rotate-90" />
            <Zap className="h-3 w-3" />
            <span>Skills</span>
            <span className="ml-auto text-[10px] opacity-60">{allSkillCount}</span>
          </CollapsibleTrigger>

          <Button
            variant="ghost"
            size="sm"
            className="h-7 px-2 text-[11px] font-normal text-muted-foreground hover:bg-muted hover:text-foreground"
            onClick={() => setIsOrganizing((current) => !current)}
          >
            {isOrganizing ? "Done" : "Organize"}
          </Button>
        </div>

        <CollapsibleContent className="mt-1 space-y-2">
          {isOrganizing && (
            <div className="space-y-2 px-3 pb-2 pt-1">
              <div className="text-[12px] leading-[1.2rem] text-muted-foreground/75">
                Create groups and move skills without editing any files.
              </div>
              <div className="flex flex-wrap gap-2">
                {globalItems.length > 0 && (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => openCreateDialog("global")}
                  >
                    <FolderPlus className="h-3.5 w-3.5" />
                    New Group
                  </Button>
                )}
                {activeProjectId && projectItems.length > 0 && (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => openCreateDialog("project")}
                  >
                    <FolderPlus className="h-3.5 w-3.5" />
                    New Project Group
                  </Button>
                )}
              </div>
            </div>
          )}

          {scopeSections.map((section) => {
            const scopedGroups =
              section.label === "Project" ? currentProjectGroups : globalSkillGroups;

            return (
              <div key={section.label}>
                {scopeSections.length > 1 && (
                  <div className="px-3 pb-1.5 pt-1 text-[11px] font-medium uppercase tracking-[0.12em] text-muted-foreground/65">
                    {section.label}
                  </div>
                )}

                <div className="space-y-1">
                  {section.groups.map((group) => (
                    <Collapsible
                      key={`${section.label}-${group.name}-${group.id ?? "fallback"}`}
                      open={!collapsedSkillGroups.includes(getSkillGroupKey(group, activeProjectId))}
                      onOpenChange={() =>
                        toggleSkillGroupCollapse(getSkillGroupKey(group, activeProjectId))
                      }
                    >
                      <div className="flex items-center justify-between gap-2 px-3 pb-1.5 pt-1">
                        <CollapsibleTrigger className="group flex min-w-0 flex-1 items-center gap-2 rounded-md py-1 text-left transition-colors hover:text-foreground">
                          <ChevronRight className="h-3 w-3 shrink-0 text-muted-foreground/70 transition-transform group-data-[state=open]:rotate-90" />
                          <div className="truncate text-[11px] font-medium uppercase tracking-[0.12em] text-muted-foreground/65">
                            {group.name}
                          </div>
                        </CollapsibleTrigger>

                        {isOrganizing && (
                          <GroupActions
                            canInlineActions={canInlineActions}
                            group={group}
                            onRename={() =>
                              setDialogState({
                                mode: "rename",
                                source: group.source,
                                groupId: group.id!,
                                initialValue: group.name,
                              })
                            }
                            onDelete={() =>
                              void deleteSkillGroup(
                                group.id!,
                                group.source,
                                group.source === "project" ? activeProjectId : null
                              )
                            }
                          />
                        )}
                      </div>

                      <CollapsibleContent className="space-y-0.5">
                        {group.items.length === 0 && isOrganizing && (
                          <div className="px-3 py-2 text-[12px] leading-[1.2rem] text-muted-foreground/70">
                            No skills yet. Use the arrow action on a skill to move it here.
                          </div>
                        )}
                        {group.items.map((skill) => {
                          const isSelected =
                            selectedSkill?.path === skill.path && skill.path !== "";
                          const currentGroupId = group.source === "project"
                            ? findSkillGroupId(currentProjectGroups, skill.name)
                            : findSkillGroupId(globalSkillGroups, skill.name);

                          return (
                            <div
                              key={`${group.name}-${skill.name}`}
                              className={`flex items-start gap-2 overflow-hidden rounded-md transition-colors ${
                                isSelected ? "bg-muted text-foreground" : "hover:bg-muted/80"
                              }`}
                            >
                              <button
                                onClick={() => skill.path && openSkillPreview(skill)}
                                disabled={!skill.path}
                                className="flex min-w-0 flex-1 items-start gap-2 px-3 py-1.5 text-left text-muted-foreground transition-colors hover:text-foreground disabled:cursor-default disabled:opacity-70"
                                title={skill.path ? "Open SKILL.md" : "Skill file not found"}
                              >
                                <FileText className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground/60" />
                                <div className="min-w-0 overflow-hidden pt-[1px]">
                                  <div className="truncate text-[13px] font-medium leading-[1.15rem] text-foreground/90">
                                    {skill.name}
                                  </div>
                                  {skill.description && (
                                    <div
                                      className="line-clamp-2 max-w-full overflow-hidden break-words pt-0.5 text-[12px] leading-[1.15rem] text-muted-foreground/68"
                                      style={{
                                        overflowWrap: "anywhere",
                                      }}
                                    >
                                      {skill.description}
                                    </div>
                                  )}
                                </div>
                              </button>

                              <SkillActions
                                canInlineActions={canInlineActions}
                                copiedSkill={copiedSkill}
                                currentGroupId={currentGroupId}
                                groups={scopedGroups}
                                isOrganizing={isOrganizing}
                                onCopy={() => copyToClipboard(skill.name)}
                                onCreateGroup={() => openCreateDialog(group.source, skill)}
                                onMoveToGroup={(groupId) =>
                                  void moveSkillToGroup(
                                    skill.name,
                                    groupId,
                                    group.source,
                                    group.source === "project" ? activeProjectId : null
                                  )
                                }
                                skillName={skill.name}
                              />
                            </div>
                          );
                        })}
                      </CollapsibleContent>
                    </Collapsible>
                  ))}
                </div>
              </div>
            );
          })}
        </CollapsibleContent>
      </Collapsible>

      <SkillGroupDialog
        open={dialogState !== null}
        onOpenChange={(open) => {
          if (!open) setDialogState(null);
        }}
        title={
          dialogState?.mode === "rename"
            ? "Rename Group"
            : "Create Skill Group"
        }
        description={
          dialogState?.mode === "rename"
            ? "Update the group name shown in the sidebar."
            : "Create a group to organize skills in the sidebar."
        }
        submitLabel={dialogState?.mode === "rename" ? "Save" : "Create"}
        initialValue={dialogState?.mode === "rename" ? dialogState.initialValue : ""}
        existingNames={
          dialogState?.source === "project" ? projectGroupNames : globalGroupNames
        }
        onSubmit={handleDialogSubmit}
      />
    </>
  );
}
