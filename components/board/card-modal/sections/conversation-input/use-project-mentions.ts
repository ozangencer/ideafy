import { useCallback, useEffect, useRef, useState } from "react";
import { useKanbanStore } from "@/lib/store";
import { buildSkillGroupUnifiedItems } from "@/lib/skills/grouping";

type UnifiedItemKind = "skill" | "mcp" | "agent" | "plugin" | "skillGroup";
interface UnifiedMentionItem {
  id: string;
  label: string;
  type: UnifiedItemKind;
  description?: string;
  children?: UnifiedMentionItem[];
}

/**
 * Resolves the mention providers for a card's effective project:
 * - Documents are fetched (non-cached) when the card's project differs from
 *   the globally-active project; otherwise the globally-cached list is used.
 * - Skills/MCPs/Agents are fetched from the card's project and merged with
 *   the globally-loaded sets so the unified `/` picker covers both.
 *
 * Returns stable getter fns (`getDocuments`, `getUnifiedItems`) suitable for
 * passing into TipTap suggestion factories.
 */
export function useProjectMentions(projectId: string | null, activeProjectId: string | null) {
  const {
    skills,
    mcps,
    agents,
    documents,
    memoryFiles,
    skillItems,
    projectSkillItems,
    globalSkillGroups,
    projectSkillGroups,
  } = useKanbanStore();
  const documentsRef = useRef<typeof documents>([]);
  const memoryRef = useRef<typeof memoryFiles>([]);
  const [localProjectSkills, setLocalProjectSkills] = useState<string[]>([]);
  const [localProjectMcps, setLocalProjectMcps] = useState<string[]>([]);
  const [localProjectAgents, setLocalProjectAgents] = useState<string[]>([]);

  useEffect(() => {
    const effectiveProjectId = projectId || activeProjectId;

    if (effectiveProjectId && effectiveProjectId !== activeProjectId) {
      fetch(`/api/projects/${effectiveProjectId}/documents`)
        .then((res) => res.json())
        .then((docs) => {
          documentsRef.current = Array.isArray(docs) ? docs : [];
        })
        .catch(() => {
          documentsRef.current = [];
        });
      fetch(`/api/projects/${effectiveProjectId}/memory`)
        .then((res) => res.json())
        .then((files) => {
          memoryRef.current = Array.isArray(files) ? files : [];
        })
        .catch(() => {
          memoryRef.current = [];
        });
    } else {
      documentsRef.current = documents;
      memoryRef.current = memoryFiles;
    }
  }, [projectId, activeProjectId, documents, memoryFiles]);

  useEffect(() => {
    const effectiveProjectId = projectId || activeProjectId;

    if (!effectiveProjectId) {
      setLocalProjectSkills([]);
      setLocalProjectMcps([]);
      setLocalProjectAgents([]);
      return;
    }

    Promise.all([
      fetch(`/api/projects/${effectiveProjectId}/skills/list`).then((r) => r.json()).catch(() => ({ skills: [] })),
      fetch(`/api/projects/${effectiveProjectId}/mcps/list`).then((r) => r.json()).catch(() => ({ mcps: [] })),
      fetch(`/api/projects/${effectiveProjectId}/agents/list`).then((r) => r.json()).catch(() => ({ agents: [] })),
    ]).then(([skillsData, mcpsData, agentsData]) => {
      setLocalProjectSkills(skillsData.skills || []);
      setLocalProjectMcps(mcpsData.mcps || []);
      setLocalProjectAgents(agentsData.agents || []);
    });
  }, [projectId, activeProjectId]);

  const getDocuments = useCallback(
    () => [...documentsRef.current, ...memoryRef.current],
    []
  );

  const getUnifiedItems = useCallback((): UnifiedMentionItem[] => {
    const items: UnifiedMentionItem[] = [];
    const addedIds = new Set<string>();
    const effectiveProjectId = projectId || activeProjectId;

    const allGlobalSkillItems = skillItems.length
      ? skillItems
      : Array.from(new Set(skills)).map((name) => ({
          name,
          title: name,
          path: "",
          group: null,
          description: null,
          source: "global" as const,
        }));

    const allProjectSkillItems = projectSkillItems.length
      ? projectSkillItems
      : Array.from(new Set(localProjectSkills)).map((name) => ({
          name,
          title: name,
          path: "",
          group: null,
          description: null,
          source: "project" as const,
        }));

    const addAll = (values: string[], type: UnifiedItemKind) => {
      Array.from(new Set(values)).forEach((value) => {
        const key = `${type}-${value}`;
        if (addedIds.has(key)) return;
        addedIds.add(key);
        items.push({ id: value, label: value, type });
      });
    };

    buildSkillGroupUnifiedItems(allGlobalSkillItems, globalSkillGroups, "global").forEach(
      (group) => {
        const key = `${group.type}-${group.id}`;
        if (addedIds.has(key)) return;
        addedIds.add(key);
        items.push(group);
      }
    );

    if (effectiveProjectId) {
      buildSkillGroupUnifiedItems(
        allProjectSkillItems,
        projectSkillGroups[effectiveProjectId] || [],
        "project"
      ).forEach((group) => {
        const key = `${group.type}-${group.id}`;
        if (addedIds.has(key)) return;
        addedIds.add(key);
        items.push(group);
      });
    }

    addAll([...skills, ...localProjectSkills], "skill");
    addAll([...mcps, ...localProjectMcps], "mcp");
    addAll([...agents, ...localProjectAgents], "agent");

    return items;
  }, [
    skills,
    mcps,
    agents,
    activeProjectId,
    globalSkillGroups,
    localProjectAgents,
    localProjectMcps,
    localProjectSkills,
    projectId,
    projectSkillGroups,
    projectSkillItems,
    skillItems,
  ]);

  return { getDocuments, getUnifiedItems };
}
