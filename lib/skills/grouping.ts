import type {
  SkillListItem,
  SkillSource,
  UnifiedItem,
  UserSkillGroup,
} from "@/lib/types";

export type ResolvedSkillGroup = {
  id: string | null;
  name: string;
  items: SkillListItem[];
  source: SkillSource;
  isUngrouped: boolean;
  canManage: boolean;
};

function uniqueSkillNames(skillNames: string[]): string[] {
  return Array.from(new Set(skillNames.map((name) => name.trim()).filter(Boolean)));
}

export function normalizeGroupName(name: string): string {
  return name.trim().replace(/\s+/g, " ");
}

export function createSkillGroupId(): string {
  return `skill-group-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

export function upsertSkillGroup(
  groups: UserSkillGroup[],
  name: string
): { groups: UserSkillGroup[]; groupId: string } {
  const normalizedName = normalizeGroupName(name);
  const existing = groups.find(
    (group) => group.name.toLocaleLowerCase() === normalizedName.toLocaleLowerCase()
  );

  if (existing) {
    return { groups, groupId: existing.id };
  }

  const nextGroup: UserSkillGroup = {
    id: createSkillGroupId(),
    name: normalizedName,
    skillNames: [],
  };

  return {
    groups: [...groups, nextGroup],
    groupId: nextGroup.id,
  };
}

export function renameSkillGroupInCollection(
  groups: UserSkillGroup[],
  groupId: string,
  name: string
): UserSkillGroup[] {
  const normalizedName = normalizeGroupName(name);
  if (!normalizedName) return groups;

  const conflictingGroup = groups.find(
    (group) =>
      group.id !== groupId &&
      group.name.toLocaleLowerCase() === normalizedName.toLocaleLowerCase()
  );

  if (conflictingGroup) return groups;

  return groups.map((group) =>
    group.id === groupId ? { ...group, name: normalizedName } : group
  );
}

export function deleteSkillGroupFromCollection(
  groups: UserSkillGroup[],
  groupId: string
): UserSkillGroup[] {
  return groups.filter((group) => group.id !== groupId);
}

export function assignSkillToGroupInCollection(
  groups: UserSkillGroup[],
  skillName: string,
  groupId: string | null
): UserSkillGroup[] {
  const strippedGroups = groups.map((group) => ({
    ...group,
    skillNames: group.skillNames.filter((existingName) => existingName !== skillName),
  }));

  if (groupId === null) {
    return strippedGroups;
  }

  return strippedGroups.map((group) =>
    group.id === groupId
      ? { ...group, skillNames: uniqueSkillNames([...group.skillNames, skillName]) }
      : group
  );
}

export function findSkillGroupId(
  groups: UserSkillGroup[],
  skillName: string
): string | null {
  const match = groups.find((group) => group.skillNames.includes(skillName));
  return match?.id || null;
}

export function resolveSkillGroups(
  items: SkillListItem[],
  groups: UserSkillGroup[],
  source: SkillSource,
  ungroupedLabel = "Ungrouped",
  options?: {
    includeEmptyGroups?: boolean;
  }
): ResolvedSkillGroup[] {
  const includeEmptyGroups = options?.includeEmptyGroups ?? false;
  const itemsByName = new Map(items.map((item) => [item.name, item] as const));
  const groupedNames = new Set<string>();

  const resolvedGroups: ResolvedSkillGroup[] = groups
    .map((group) => {
      const groupItems = group.skillNames
        .map((skillName) => itemsByName.get(skillName))
        .filter((item): item is SkillListItem => item !== undefined);

      groupItems.forEach((item) => groupedNames.add(item.name));

      return {
        id: group.id,
        name: group.name,
        items: groupItems,
        source,
        isUngrouped: false,
        canManage: true,
      };
    })
    .filter((group) => includeEmptyGroups || group.items.length > 0);

  const ungroupedItems = items.filter((item) => !groupedNames.has(item.name));

  if (ungroupedItems.length > 0) {
    resolvedGroups.push({
      id: null,
      name: ungroupedLabel,
      items: ungroupedItems,
      source,
      isUngrouped: true,
      canManage: false,
    });
  }

  return resolvedGroups;
}

export function buildSkillGroupUnifiedItems(
  items: SkillListItem[],
  groups: UserSkillGroup[],
  source: SkillSource
): UnifiedItem[] {
  const itemsByName = new Map(items.map((item) => [item.name, item] as const));

  return groups
    .map((group) => {
      const children = group.skillNames
        .map((skillName) => itemsByName.get(skillName))
        .filter((item): item is SkillListItem => item !== undefined)
        .map((item) => ({
          id: item.name,
          label: item.name,
          type: "skill" as const,
          description: item.description || undefined,
        }));

      return {
        id: source === "project" ? `project:${group.id}` : `global:${group.id}`,
        label: group.name,
        type: "skillGroup" as const,
        description:
          children.length === 1 ? "1 skill" : `${children.length} skills`,
        children,
      };
    })
    .filter((group) => group.children.length > 0);
}
