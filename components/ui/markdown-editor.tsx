"use client";

import { useEditor, EditorContent } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Placeholder from "@tiptap/extension-placeholder";
import TaskList from "@tiptap/extension-task-list";
import TaskItem from "@tiptap/extension-task-item";
import ImageResize from "tiptap-extension-resize-image";
import { Table } from "@tiptap/extension-table";
import { TableRow } from "@tiptap/extension-table-row";
import { TableHeader } from "@tiptap/extension-table-header";
import { TableCell } from "@tiptap/extension-table-cell";
import { TextSelection } from "@tiptap/pm/state";
import type { EditorView } from "@tiptap/pm/view";
import { useEffect, useRef, useMemo, useCallback, useState } from "react";
import { useKanbanStore } from "@/lib/store";
import { buildSkillGroupUnifiedItems } from "@/lib/skills/grouping";
import { UnifiedMention, CardMention, DocumentMention } from "@/lib/mention-extension";
import { createUnifiedSuggestion, createCardSuggestion, createDocumentSuggestion } from "@/lib/suggestion";
import { getDisplayId } from "@/lib/types";
import { buildDroppedFilePathText, getDroppedEditorFiles } from "@/lib/dropped-file-paths";
import tippy, { Instance } from "tippy.js";

// Extend HTMLElement to include tippy instance
declare global {
  interface HTMLElement {
    _tippy?: Instance;
  }
}

interface MarkdownEditorProps {
  value: string;
  onChange: (html: string) => void;
  placeholder?: string;
  onCardClick?: (cardId: string) => void;
  projectId?: string | null;
  preferSelectionOnDrop?: boolean;
}

export function MarkdownEditor({
  value,
  onChange,
  placeholder = "Write here...",
  onCardClick,
  projectId,
  preferSelectionOnDrop = false,
}: MarkdownEditorProps) {
  const isUpdatingFromExternal = useRef(false);
  const lastSyncedValue = useRef<string | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const lastSelectionRef = useRef<number | null>(null);
  const lastProcessedDropRef = useRef<number | null>(null);
  const {
    cards,
    projects,
    activeProjectId,
    documents,
    skills,
    mcps,
    agents,
    skillItems,
    projectSkillItems,
    globalSkillGroups,
    projectSkillGroups,
  } = useKanbanStore();

  // Local state for project-specific skills/mcps/agents
  const [localProjectSkills, setLocalProjectSkills] = useState<string[]>([]);
  const [localProjectMcps, setLocalProjectMcps] = useState<string[]>([]);
  const [localProjectAgents, setLocalProjectAgents] = useState<string[]>([]);
  const effectiveProjectId = projectId || activeProjectId;
  const projectFolderPath =
    projects.find((project) => project.id === effectiveProjectId)?.folderPath || null;

  // Ref to hold current documents for the callback
  const documentsRef = useRef<typeof documents>([]);

  // Fetch and maintain documents for the card's project
  useEffect(() => {
    if (effectiveProjectId && effectiveProjectId !== activeProjectId) {
      // Card has a project but sidebar shows "All Projects" - fetch card's project documents
      fetch(`/api/projects/${effectiveProjectId}/documents`)
        .then(res => res.json())
        .then(docs => {
          documentsRef.current = Array.isArray(docs) ? docs : [];
        })
        .catch(() => {
          documentsRef.current = [];
        });
    } else {
      // Use store's documents
      documentsRef.current = documents;
    }
  }, [projectId, activeProjectId, documents]);

  // Fetch project-specific skills/mcps based on card's project
  useEffect(() => {
    if (!effectiveProjectId) {
      setLocalProjectSkills([]);
      setLocalProjectMcps([]);
      setLocalProjectAgents([]);
      return;
    }

    // Fetch project's skills, mcps and agents
    Promise.all([
      fetch(`/api/projects/${effectiveProjectId}/skills/list`).then(r => r.json()).catch(() => ({ skills: [] })),
      fetch(`/api/projects/${effectiveProjectId}/mcps/list`).then(r => r.json()).catch(() => ({ mcps: [] })),
      fetch(`/api/projects/${effectiveProjectId}/agents/list`).then(r => r.json()).catch(() => ({ agents: [] })),
    ]).then(([skillsData, mcpsData, agentsData]) => {
      setLocalProjectSkills(skillsData.skills || []);
      setLocalProjectMcps(mcpsData.mcps || []);
      setLocalProjectAgents(agentsData.agents || []);
    });
  }, [projectId, activeProjectId]);

  // Create unified items getter that merges global + card's project items
  const getUnifiedItems = useCallback(() => {
    const items: Array<{
      id: string;
      label: string;
      type: "skill" | "mcp" | "agent" | "plugin" | "skillGroup";
      description?: string;
      children?: Array<{
        id: string;
        label: string;
        type: "skill" | "mcp" | "agent" | "plugin" | "skillGroup";
        description?: string;
      }>;
    }> = [];
    const addedIds = new Set<string>();
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

    buildSkillGroupUnifiedItems(allGlobalSkillItems, globalSkillGroups, "global").forEach(
      (group) => {
        if (!addedIds.has(`skillGroup-${group.id}`)) {
          addedIds.add(`skillGroup-${group.id}`);
          items.push(group);
        }
      }
    );

    if (effectiveProjectId) {
      buildSkillGroupUnifiedItems(
        allProjectSkillItems,
        projectSkillGroups[effectiveProjectId] || [],
        "project"
      ).forEach((group) => {
        if (!addedIds.has(`skillGroup-${group.id}`)) {
          addedIds.add(`skillGroup-${group.id}`);
          items.push(group);
        }
      });
    }

    // Merge global + project skills
    const allSkills = Array.from(new Set([...skills, ...localProjectSkills]));
    allSkills.forEach((skill) => {
      if (!addedIds.has(`skill-${skill}`)) {
        addedIds.add(`skill-${skill}`);
        items.push({ id: skill, label: skill, type: "skill" });
      }
    });

    // Merge global + project MCPs
    const allMcps = Array.from(new Set([...mcps, ...localProjectMcps]));
    allMcps.forEach((mcp) => {
      if (!addedIds.has(`mcp-${mcp}`)) {
        addedIds.add(`mcp-${mcp}`);
        items.push({ id: mcp, label: mcp, type: "mcp" });
      }
    });

    // Merge global + project agents
    const allAgents = Array.from(new Set([...agents, ...localProjectAgents]));
    allAgents.forEach((agent) => {
      if (!addedIds.has(`agent-${agent}`)) {
        addedIds.add(`agent-${agent}`);
        items.push({ id: agent, label: agent, type: "agent" });
      }
    });

    return items;
  }, [
    activeProjectId,
    agents,
    globalSkillGroups,
    localProjectAgents,
    localProjectMcps,
    localProjectSkills,
    mcps,
    projectId,
    projectSkillGroups,
    projectSkillItems,
    skillItems,
    skills,
  ]);

  // Callback to get current documents (used by suggestion)
  const getDocuments = useCallback(() => documentsRef.current, []);

  // Unified suggestion for / trigger (skills, MCPs, plugins)
  const unifiedSuggestion = useMemo(
    () => createUnifiedSuggestion({ getItems: getUnifiedItems }),
    [getUnifiedItems]
  );

  const cardSuggestion = useMemo(
    () => createCardSuggestion({ cards, projects, activeProjectId }),
    [cards, projects, activeProjectId]
  );

  const documentSuggestion = useMemo(
    () => createDocumentSuggestion({ getDocuments }),
    [getDocuments]
  );

  const handleEditorDrop = useCallback((view: EditorView, event: DragEvent): boolean => {
    if (lastProcessedDropRef.current === event.timeStamp) {
      return true;
    }

    const droppedFiles = getDroppedEditorFiles(event.dataTransfer, projectFolderPath);
    if (droppedFiles.length === 0) {
      return false;
    }

    lastProcessedDropRef.current = event.timeStamp;
    event.preventDefault();
    view.focus();

    let insertPos = view.state.selection.from;
    if (!preferSelectionOnDrop) {
      const coords = view.posAtCoords({ left: event.clientX, top: event.clientY });
      if (coords?.pos != null) {
        insertPos = coords.pos;
      }
    } else if (lastSelectionRef.current != null) {
      insertPos = Math.min(lastSelectionRef.current, view.state.doc.content.size);
      const tr = view.state.tr.setSelection(TextSelection.near(view.state.doc.resolve(insertPos)));
      view.dispatch(tr);
      insertPos = view.state.selection.from;
    }

    const imageFiles = droppedFiles.filter((file) => file.isImage);
    const pathFiles = droppedFiles.filter((file) => !file.isImage);
    const pathText = buildDroppedFilePathText(pathFiles);

    if (pathFiles.length > 0) {
      view.dispatch(view.state.tr.insertText(pathText, insertPos, insertPos).scrollIntoView());
      insertPos += pathText.length;
    }

    if (imageFiles.length > 0) {
      const oversizedImage = imageFiles.find((droppedFile) => droppedFile.file.size > 5 * 1024 * 1024);
      if (oversizedImage) {
        console.warn("Image too large (max 5MB)");
        return true;
      }

      void Promise.all(
        imageFiles.map(
          (droppedFile) =>
            new Promise<string>((resolve, reject) => {
              const reader = new FileReader();
              reader.onload = () => resolve(reader.result as string);
              reader.onerror = () => reject(reader.error);
              reader.readAsDataURL(droppedFile.file);
            }),
        ),
      ).then((images) => {
        const nodeType = view.state.schema.nodes.imageResize || view.state.schema.nodes.image;
        if (!nodeType) {
          return;
        }

        let imageInsertPos = insertPos;
        let tr = view.state.tr;
        images.forEach((base64) => {
          const imageNode = nodeType.create({ src: base64 });
          tr = tr.insert(imageInsertPos, imageNode);
          imageInsertPos += imageNode.nodeSize;
        });
        view.dispatch(tr.scrollIntoView());
      }).catch((error) => {
        console.error("Failed to process dropped image:", error);
      });
    }

    return true;
  }, [preferSelectionOnDrop, projectFolderPath]);

  const editor = useEditor({
    immediatelyRender: false,
    extensions: [
      StarterKit.configure({
        heading: {
          levels: [1, 2, 3],
        },
      }),
      TaskList,
      TaskItem.configure({
        nested: true,
      }),
      Placeholder.configure({
        placeholder,
        emptyEditorClass: "is-editor-empty",
      }),
      UnifiedMention.configure({
        suggestion: unifiedSuggestion,
      }),
      CardMention.configure({
        suggestion: cardSuggestion,
      }),
      DocumentMention.configure({
        suggestion: documentSuggestion,
      }),
      ImageResize.configure({
        inline: false,
        allowBase64: true,
      }),
      Table.configure({
        resizable: false,
      }),
      TableRow,
      TableHeader,
      TableCell,
    ],
    content: "",
    editorProps: {
      attributes: {
        class: "prose-kanban",
      },
      handlePaste: (view, event) => {
        const items = event.clipboardData?.items;
        if (!items) return false;

        for (let i = 0; i < items.length; i++) {
          const item = items[i];
          if (item.type.startsWith("image/")) {
            event.preventDefault();
            const file = item.getAsFile();
            if (!file) continue;

            // Check file size (max 5MB)
            const MAX_SIZE = 5 * 1024 * 1024;
            if (file.size > MAX_SIZE) {
              console.warn("Image too large (max 5MB)");
              return true;
            }

            const reader = new FileReader();
            reader.onload = () => {
              const base64 = reader.result as string;
              const nodeType = view.state.schema.nodes.imageResize || view.state.schema.nodes.image;
              if (nodeType) {
                view.dispatch(
                  view.state.tr.replaceSelectionWith(
                    nodeType.create({ src: base64 })
                  )
                );
              }
            };
            reader.readAsDataURL(file);
            return true;
          }
        }
        return false;
      },
      handleDrop: (view, event) => {
        return handleEditorDrop(view, event);
      },
    },
    onUpdate: ({ editor }) => {
      if (isUpdatingFromExternal.current) return;

      const html = editor.getHTML();
      lastSyncedValue.current = html;
      onChange(html);
    },
    onSelectionUpdate: ({ editor }) => {
      lastSelectionRef.current = editor.state.selection.from;
    },
  });

  // Sync value to editor
  useEffect(() => {
    if (!editor) return;
    if (value === lastSyncedValue.current) return;

    isUpdatingFromExternal.current = true;
    editor.commands.setContent(value || "");
    lastSyncedValue.current = value;
    isUpdatingFromExternal.current = false;
  }, [value, editor]);

  useEffect(() => {
    if (!editor) return;
    lastSelectionRef.current = editor.state.selection.from;
  }, [editor]);

  // Setup hover tooltips for card mentions
  useEffect(() => {
    if (!containerRef.current) return;

    // Small delay to ensure DOM is updated after editor renders
    const timeoutId = setTimeout(() => {
      const mentions = containerRef.current?.querySelectorAll(".card-mention");
      if (!mentions) return;

      mentions.forEach((mention) => {
        // Skip if already has tippy
        if ((mention as HTMLElement)._tippy) return;

        const cardId = mention.getAttribute("data-id");
        const card = cards.find((c) => c.id === cardId);
        if (!card) return;

        const project = projects.find((p) => p.id === card.projectId);
        const displayId = getDisplayId(card, project);

        // Strip HTML for description preview
        const descriptionPreview = card.description
          ? card.description.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim().slice(0, 120)
          : "";

        // Build the tooltip via DOM APIs instead of innerHTML. card.title,
        // project.name, and the description can originate from MCP callers
        // (prompt-injected AI agents) with attacker-controlled markup.
        // innerHTML here was a stored-XSS sink → RCE in the local-app origin.
        const content = document.createElement("div");
        content.className = "card-preview-tooltip";
        content.style.maxWidth = "320px";

        const titleDiv = document.createElement("div");
        titleDiv.className = "tooltip-title";
        if (displayId) {
          const idSpan = document.createElement("span");
          idSpan.className = "tooltip-id";
          idSpan.textContent = displayId;
          titleDiv.appendChild(idSpan);
        }
        titleDiv.append(card.title);
        content.appendChild(titleDiv);

        const metaDiv = document.createElement("div");
        metaDiv.className = "tooltip-meta";
        const statusText = card.status.replace("progress", "in progress");
        metaDiv.textContent = project ? `${statusText} · ${project.name}` : statusText;
        content.appendChild(metaDiv);

        if (descriptionPreview) {
          const descDiv = document.createElement("div");
          descDiv.className = "tooltip-description";
          descDiv.textContent =
            descriptionPreview + (card.description.length > 120 ? "..." : "");
          content.appendChild(descDiv);
        }

        tippy(mention as HTMLElement, {
          content,
          allowHTML: false,
          placement: "top",
          theme: "card-preview",
          delay: [300, 0],
          interactive: false,
        });
      });
    }, 100);

    return () => {
      clearTimeout(timeoutId);
    };
  }, [value, cards, projects]);

  // Handle card mention clicks
  const handleContainerClick = useCallback((e: React.MouseEvent) => {
    const target = e.target as HTMLElement;
    if (target.classList.contains("card-mention") || target.closest(".card-mention")) {
      const mention = target.classList.contains("card-mention") ? target : target.closest(".card-mention") as HTMLElement;
      const cardId = mention?.getAttribute("data-id");
      if (cardId && onCardClick) {
        e.preventDefault();
        e.stopPropagation();
        onCardClick(cardId);
      }
    }
  }, [onCardClick]);

  return (
    <div
      ref={containerRef}
      className="tiptap-editor h-full"
      onClick={handleContainerClick}
      onDragOverCapture={(event) => {
        if (!editor || !event.dataTransfer?.files?.length) {
          return;
        }
        event.preventDefault();
        event.dataTransfer.dropEffect = "copy";
      }}
      onDropCapture={(event) => {
        if (!editor) {
          return;
        }
        if (event.dataTransfer?.files?.length) {
          event.preventDefault();
        }
        handleEditorDrop(editor.view, event.nativeEvent);
      }}
    >
      <EditorContent editor={editor} />
    </div>
  );
}
