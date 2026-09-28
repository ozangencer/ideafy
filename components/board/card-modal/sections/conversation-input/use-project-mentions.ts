import { useCallback, useEffect, useRef, useState } from "react";
import { useKanbanStore } from "@/lib/store";
import { buildUnifiedItems } from "@/lib/mentions/unified-items";
import type { AgentListItem, SkillListItem, ToolkitItem, UnifiedItem } from "@/lib/types";

/**
 * Resolves the mention providers for a card's effective project:
 * - Documents are fetched (non-cached) when the card's project differs from
 *   the globally-active project; otherwise the globally-cached list is used.
 * - Skills/MCPs/Agents are fetched from the card's project and merged with
 *   the globally-loaded sets so the unified `/` picker covers both.
 * - The Toolkit comes from the store when the card belongs to the active
 *   project, and is fetched otherwise, so a card opened under "All Projects"
 *   still lists its own project's pins first.
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
    agentItems,
    projectAgentItems,
    toolkitItems,
  } = useKanbanStore();
  const documentsRef = useRef<typeof documents>([]);
  const memoryRef = useRef<typeof memoryFiles>([]);
  const [localProjectSkills, setLocalProjectSkills] = useState<string[]>([]);
  const [localProjectSkillItems, setLocalProjectSkillItems] = useState<SkillListItem[]>([]);
  const [localProjectMcps, setLocalProjectMcps] = useState<string[]>([]);
  const [localProjectAgents, setLocalProjectAgents] = useState<string[]>([]);
  const [localProjectAgentItems, setLocalProjectAgentItems] = useState<AgentListItem[]>([]);
  const [localToolkitItems, setLocalToolkitItems] = useState<ToolkitItem[]>([]);

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
      setLocalProjectSkillItems([]);
      setLocalProjectMcps([]);
      setLocalProjectAgents([]);
      setLocalProjectAgentItems([]);
      setLocalToolkitItems([]);
      return;
    }

    Promise.all([
      fetch(`/api/projects/${effectiveProjectId}/skills/list`).then((r) => r.json()).catch(() => ({ skills: [] })),
      fetch(`/api/projects/${effectiveProjectId}/mcps/list`).then((r) => r.json()).catch(() => ({ mcps: [] })),
      fetch(`/api/projects/${effectiveProjectId}/agents/list`).then((r) => r.json()).catch(() => ({ agents: [] })),
      fetch(`/api/projects/${effectiveProjectId}/toolkit`).then((r) => r.json()).catch(() => ({ items: [] })),
    ]).then(([skillsData, mcpsData, agentsData, toolkitData]) => {
      setLocalProjectSkills(skillsData.skills || []);
      setLocalProjectSkillItems(skillsData.items || []);
      setLocalProjectMcps(mcpsData.mcps || []);
      setLocalProjectAgents(agentsData.agents || []);
      setLocalProjectAgentItems(agentsData.items || []);
      setLocalToolkitItems(Array.isArray(toolkitData.items) ? toolkitData.items : []);
    });
  }, [projectId, activeProjectId]);

  const getDocuments = useCallback(
    () => [...documentsRef.current, ...memoryRef.current],
    []
  );

  const getUnifiedItems = useCallback((): UnifiedItem[] => {
    const effectiveProjectId = projectId || activeProjectId;
    return buildUnifiedItems({
      skills: [...skills, ...localProjectSkills],
      mcps: [...mcps, ...localProjectMcps],
      agents: [...agents, ...localProjectAgents],
      skillItems: [...skillItems, ...projectSkillItems, ...localProjectSkillItems],
      agentItems: [...agentItems, ...projectAgentItems, ...localProjectAgentItems],
      toolkit: !effectiveProjectId
        ? []
        : effectiveProjectId === activeProjectId
          ? toolkitItems
          : localToolkitItems,
    });
  }, [
    skills,
    mcps,
    agents,
    activeProjectId,
    agentItems,
    localProjectAgentItems,
    localProjectAgents,
    localProjectMcps,
    localProjectSkillItems,
    localProjectSkills,
    localToolkitItems,
    projectAgentItems,
    projectId,
    projectSkillItems,
    skillItems,
    toolkitItems,
  ]);

  return { getDocuments, getUnifiedItems };
}
