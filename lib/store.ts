import { create } from "zustand";
import { persist } from "zustand/middleware";
import { Card, Status, Project, DocumentFile, AppSettings, CompletedFilter, ConversationMessage, SectionType, MentionData } from "./types";

interface KanbanStore {
  // Cards state
  cards: Card[];
  selectedCard: Card | null;
  draftCard: Card | null;
  isModalOpen: boolean;
  searchQuery: string;
  isLoading: boolean;

  // Projects state
  projects: Project[];
  activeProjectId: string | null;
  isProjectsLoading: boolean;

  // Documents state
  documents: DocumentFile[];
  selectedDocument: DocumentFile | null;
  documentContent: string;
  isDocumentEditorOpen: boolean;

  // Sidebar state
  isSidebarCollapsed: boolean;

  // Column collapse state
  collapsedColumns: Status[];

  // Completed column filter
  completedFilter: CompletedFilter;

  // Skills & MCPs state
  skills: string[];
  mcps: string[];

  // Claude integration state
  startingCardId: string | null;
  quickFixingCardId: string | null;
  evaluatingCardIds: string[];
  lockedCardIds: string[];

  // Settings state
  settings: AppSettings | null;
  isSettingsLoading: boolean;

  // Conversation state
  conversations: Record<string, ConversationMessage[]>; // key: `${cardId}-${sectionType}`
  streamingMessage: ConversationMessage | null;
  isConversationLoading: boolean;
  conversationAbortController: AbortController | null;

  // Card actions
  fetchCards: () => Promise<void>;
  setCards: (cards: Card[]) => void;
  addCard: (
    card: Omit<Card, "id" | "createdAt" | "updatedAt" | "taskNumber" | "completedAt">
  ) => Promise<void>;
  addCardAndOpen: (
    card: Omit<Card, "id" | "createdAt" | "updatedAt" | "taskNumber" | "completedAt">
  ) => Promise<void>;
  openNewCardModal: (status: Status, projectId: string | null) => void;
  saveDraftCard: (
    cardData: Omit<Card, "id" | "createdAt" | "updatedAt" | "taskNumber" | "completedAt">
  ) => Promise<void>;
  discardDraft: () => void;
  updateCard: (id: string, updates: Partial<Card>) => Promise<void>;
  deleteCard: (id: string) => Promise<void>;
  moveCard: (id: string, newStatus: Status) => Promise<void>;
  selectCard: (card: Card | null) => void;
  openModal: () => void;
  closeModal: () => void;
  setSearchQuery: (query: string) => void;

  // Project actions
  fetchProjects: () => Promise<void>;
  addProject: (
    project: Omit<Project, "id" | "createdAt" | "updatedAt" | "nextTaskNumber">
  ) => Promise<void>;
  updateProject: (id: string, updates: Partial<Project>) => Promise<void>;
  deleteProject: (id: string) => Promise<void>;
  setActiveProject: (projectId: string | null) => void;
  toggleProjectPin: (id: string) => Promise<void>;

  // Document actions
  fetchDocuments: (projectId: string) => Promise<void>;
  openDocument: (doc: DocumentFile) => Promise<void>;
  saveDocument: () => Promise<void>;
  closeDocumentEditor: () => void;
  setDocumentContent: (content: string) => void;

  // Sidebar actions
  toggleSidebar: () => void;

  // Column collapse actions
  toggleColumnCollapse: (columnId: Status) => void;

  // Completed filter actions
  setCompletedFilter: (filter: CompletedFilter) => void;

  // Skills & MCPs actions
  fetchSkills: () => Promise<void>;
  fetchMcps: () => Promise<void>;

  // Claude integration actions
  startTask: (cardId: string) => Promise<{ success: boolean; error?: string }>;
  openTerminal: (cardId: string) => Promise<{ success: boolean; error?: string }>;
  openIdeationTerminal: (cardId: string) => Promise<{ success: boolean; error?: string }>;
  quickFixTask: (cardId: string) => Promise<{ success: boolean; error?: string }>;
  evaluateIdea: (cardId: string) => Promise<{ success: boolean; error?: string }>;
  lockCard: (cardId: string) => void;
  unlockCard: (cardId: string) => void;

  // Dev server actions
  startDevServer: (cardId: string) => Promise<{ success: boolean; port?: number; error?: string }>;
  stopDevServer: (cardId: string) => Promise<{ success: boolean; error?: string }>;

  // Settings actions
  fetchSettings: () => Promise<void>;
  updateSettings: (updates: Partial<AppSettings>) => Promise<void>;

  // Conversation actions
  fetchConversation: (cardId: string, sectionType: SectionType) => Promise<void>;
  sendMessage: (cardId: string, sectionType: SectionType, content: string, mentions: MentionData[], projectPath: string, currentSectionContent: string) => Promise<void>;
  cancelConversation: () => void;
  clearConversation: (cardId: string, sectionType: SectionType) => Promise<void>;
  setStreamingMessage: (message: ConversationMessage | null) => void;
  appendToStreamingMessage: (text: string) => void;
}

export const useKanbanStore = create<KanbanStore>()(
  persist(
    (set, get) => ({
  // Initial state
  cards: [],
  selectedCard: null,
  draftCard: null,
  isModalOpen: false,
  searchQuery: "",
  isLoading: false,

  // Projects initial state
  projects: [],
  activeProjectId: null,
  isProjectsLoading: false,

  // Documents initial state
  documents: [],
  selectedDocument: null,
  documentContent: "",
  isDocumentEditorOpen: false,

  // Sidebar initial state
  isSidebarCollapsed: false,

  // Column collapse initial state (withdrawn collapsed by default)
  collapsedColumns: ["withdrawn"] as Status[],

  // Completed filter initial state (default: this_week)
  completedFilter: 'this_week',

  // Skills & MCPs initial state
  skills: [],
  mcps: [],

  // Claude integration initial state
  startingCardId: null,
  quickFixingCardId: null,
  evaluatingCardIds: [],
  lockedCardIds: [],

  // Settings initial state
  settings: null,
  isSettingsLoading: false,

  // Conversation initial state
  conversations: {},
  streamingMessage: null,
  isConversationLoading: false,
  conversationAbortController: null as AbortController | null,

  // Card actions
  fetchCards: async () => {
    set({ isLoading: true });
    try {
      const response = await fetch("/api/cards");
      const cards = await response.json();

      // Also update selectedCard if it matches one of the fetched cards
      const currentSelectedCard = get().selectedCard;
      let newSelectedCard = currentSelectedCard;
      if (currentSelectedCard) {
        const updatedCard = cards.find((c: Card) => c.id === currentSelectedCard.id);
        if (updatedCard) {
          newSelectedCard = updatedCard;
        }
      }

      set({ cards, selectedCard: newSelectedCard, isLoading: false });
    } catch (error) {
      console.error("Failed to fetch cards:", error);
      set({ isLoading: false });
    }
  },

  setCards: (cards) => set({ cards }),

  addCard: async (cardData) => {
    try {
      const response = await fetch("/api/cards", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(cardData),
      });
      const newCard = await response.json();
      set((state) => ({ cards: [...state.cards, newCard] }));
    } catch (error) {
      console.error("Failed to add card:", error);
    }
  },

  addCardAndOpen: async (cardData) => {
    try {
      const response = await fetch("/api/cards", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(cardData),
      });
      const newCard = await response.json();
      set((state) => ({
        cards: [...state.cards, newCard],
        selectedCard: newCard,
        isModalOpen: true,
      }));
    } catch (error) {
      console.error("Failed to add card:", error);
    }
  },

  openNewCardModal: (status, projectId) => {
    const project = get().projects.find((p) => p.id === projectId);
    const draft: Card = {
      id: `draft-${Date.now()}`,
      title: "",
      description: "",
      solutionSummary: "",
      testScenarios: "",
      aiOpinion: "",
      status,
      complexity: "medium",
      priority: "medium",
      projectFolder: project?.folderPath || "",
      projectId,
      taskNumber: null,
      gitBranchName: null,
      gitBranchStatus: null,
      gitWorktreePath: null,
      gitWorktreeStatus: null,
      devServerPort: null,
      devServerPid: null,
      rebaseConflict: null,
      conflictFiles: null,
      processingType: null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      completedAt: null,
    };
    set({ draftCard: draft, selectedCard: draft, isModalOpen: true });
  },

  saveDraftCard: async (cardData) => {
    try {
      const response = await fetch("/api/cards", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(cardData),
      });
      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || "Failed to create card");
      }
      const newCard = await response.json();
      set((state) => ({
        cards: [...state.cards, newCard],
        draftCard: null,
        selectedCard: null,
        isModalOpen: false,
      }));
    } catch (error) {
      console.error("Failed to create card:", error);
      alert(error instanceof Error ? error.message : "Failed to create card");
    }
  },

  discardDraft: () => set({ draftCard: null, selectedCard: null, isModalOpen: false }),

  updateCard: async (id, updates) => {
    // Optimistic update - update UI immediately (except taskNumber which comes from API)
    const previousCards = get().cards;
    set((state) => ({
      cards: state.cards.map((card) =>
        card.id === id
          ? { ...card, ...updates, updatedAt: new Date().toISOString() }
          : card
      ),
    }));

    try {
      const response = await fetch(`/api/cards/${id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(updates),
      });
      const updatedCard = await response.json();

      // Update with server response to get correct taskNumber
      set((state) => ({
        cards: state.cards.map((card) =>
          card.id === id ? updatedCard : card
        ),
      }));
    } catch (error) {
      console.error("Failed to update card:", error);
      // Rollback on error
      set({ cards: previousCards });
    }
  },

  deleteCard: async (id) => {
    try {
      await fetch(`/api/cards/${id}`, { method: "DELETE" });
      set((state) => ({
        cards: state.cards.filter((card) => card.id !== id),
        selectedCard: state.selectedCard?.id === id ? null : state.selectedCard,
        isModalOpen: state.selectedCard?.id === id ? false : state.isModalOpen,
      }));
    } catch (error) {
      console.error("Failed to delete card:", error);
    }
  },

  moveCard: async (id, newStatus) => {
    const previousCards = get().cards;
    set((state) => ({
      cards: state.cards.map((card) =>
        card.id === id
          ? { ...card, status: newStatus, updatedAt: new Date().toISOString() }
          : card
      ),
    }));

    try {
      await fetch(`/api/cards/${id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: newStatus }),
      });
    } catch (error) {
      console.error("Failed to move card:", error);
      set({ cards: previousCards });
    }
  },

  selectCard: (card) => set({ selectedCard: card }),

  openModal: () => set({ isModalOpen: true }),

  closeModal: () => set({ isModalOpen: false, selectedCard: null }),

  setSearchQuery: (query) => set({ searchQuery: query }),

  // Project actions
  fetchProjects: async () => {
    set({ isProjectsLoading: true });
    try {
      const response = await fetch("/api/projects");
      const projects = await response.json();
      set({ projects, isProjectsLoading: false });
    } catch (error) {
      console.error("Failed to fetch projects:", error);
      set({ isProjectsLoading: false });
    }
  },

  addProject: async (projectData) => {
    try {
      const response = await fetch("/api/projects", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(projectData),
      });
      const newProject = await response.json();
      set((state) => ({
        projects: [...state.projects, newProject].sort((a, b) => {
          if (a.isPinned !== b.isPinned) return b.isPinned ? 1 : -1;
          return a.name.localeCompare(b.name);
        }),
      }));
    } catch (error) {
      console.error("Failed to add project:", error);
    }
  },

  updateProject: async (id, updates) => {
    try {
      const response = await fetch(`/api/projects/${id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(updates),
      });
      const updatedProject = await response.json();
      set((state) => ({
        projects: state.projects
          .map((p) => (p.id === id ? updatedProject : p))
          .sort((a, b) => {
            if (a.isPinned !== b.isPinned) return b.isPinned ? 1 : -1;
            return a.name.localeCompare(b.name);
          }),
      }));
    } catch (error) {
      console.error("Failed to update project:", error);
    }
  },

  deleteProject: async (id) => {
    try {
      await fetch(`/api/projects/${id}`, { method: "DELETE" });
      set((state) => ({
        projects: state.projects.filter((p) => p.id !== id),
        activeProjectId:
          state.activeProjectId === id ? null : state.activeProjectId,
        documents: state.activeProjectId === id ? [] : state.documents,
      }));
    } catch (error) {
      console.error("Failed to delete project:", error);
    }
  },

  setActiveProject: (projectId) => {
    set({
      activeProjectId: projectId,
      documents: [],
      selectedDocument: null,
      documentContent: "",
      isDocumentEditorOpen: false,
    });
    if (projectId) {
      get().fetchDocuments(projectId);
    }
  },

  toggleProjectPin: async (id) => {
    const project = get().projects.find((p) => p.id === id);
    if (project) {
      await get().updateProject(id, { isPinned: !project.isPinned });
    }
  },

  // Document actions
  fetchDocuments: async (projectId) => {
    try {
      const response = await fetch(`/api/projects/${projectId}/documents`);
      const documents = await response.json();
      set({ documents: Array.isArray(documents) ? documents : [] });
    } catch (error) {
      console.error("Failed to fetch documents:", error);
      set({ documents: [] });
    }
  },

  openDocument: async (doc) => {
    try {
      const response = await fetch(
        `/api/documents?path=${encodeURIComponent(doc.path)}`
      );
      const data = await response.json();
      set({
        selectedDocument: doc,
        documentContent: data.content || "",
        isDocumentEditorOpen: true,
      });
    } catch (error) {
      console.error("Failed to open document:", error);
    }
  },

  saveDocument: async () => {
    const { selectedDocument, documentContent } = get();
    if (!selectedDocument) return;

    try {
      await fetch(
        `/api/documents?path=${encodeURIComponent(selectedDocument.path)}`,
        {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ content: documentContent }),
        }
      );
    } catch (error) {
      console.error("Failed to save document:", error);
    }
  },

  closeDocumentEditor: () => {
    set({
      selectedDocument: null,
      documentContent: "",
      isDocumentEditorOpen: false,
    });
  },

  setDocumentContent: (content) => set({ documentContent: content }),

  // Sidebar actions
  toggleSidebar: () =>
    set((state) => ({ isSidebarCollapsed: !state.isSidebarCollapsed })),

  // Column collapse actions
  toggleColumnCollapse: (columnId) =>
    set((state) => ({
      collapsedColumns: state.collapsedColumns.includes(columnId)
        ? state.collapsedColumns.filter((id) => id !== columnId)
        : [...state.collapsedColumns, columnId],
    })),

  // Completed filter actions
  setCompletedFilter: (filter) => set({ completedFilter: filter }),

  // Skills & MCPs actions
  fetchSkills: async () => {
    try {
      const response = await fetch("/api/skills");
      const data = await response.json();
      set({ skills: data.skills || [] });
    } catch (error) {
      console.error("Failed to fetch skills:", error);
    }
  },

  fetchMcps: async () => {
    try {
      const response = await fetch("/api/mcps");
      const data = await response.json();
      set({ mcps: data.mcps || [] });
    } catch (error) {
      console.error("Failed to fetch MCPs:", error);
    }
  },

  // Claude integration actions
  startTask: async (cardId) => {
    set((state) => ({
      startingCardId: cardId,
      lockedCardIds: state.lockedCardIds.includes(cardId)
        ? state.lockedCardIds
        : [...state.lockedCardIds, cardId],
    }));

    try {
      const response = await fetch(`/api/cards/${cardId}/start`, {
        method: "POST",
      });

      const data = await response.json();

      if (!response.ok) {
        set((state) => ({
          startingCardId: null,
          lockedCardIds: state.lockedCardIds.filter((id) => id !== cardId),
        }));
        return { success: false, error: data.error || "Failed to start task" };
      }

      // Update card based on phase
      // data.phase: "planning" | "implementation" | "retest"
      // data.newStatus: new status after operation
      // data.response: content to save (solutionSummary or testScenarios)
      // data.complexity, data.priority: extracted from planning phase
      set((state) => ({
        cards: state.cards.map((card) => {
          if (card.id !== cardId) return card;

          const updates: Partial<Card> = {
            status: data.newStatus,
            updatedAt: new Date().toISOString(),
          };

          // Update the appropriate field based on phase
          if (data.phase === "planning") {
            updates.solutionSummary = data.response;
            // Update complexity and priority if provided
            if (data.complexity) {
              updates.complexity = data.complexity;
            }
            if (data.priority) {
              updates.priority = data.priority;
            }
          } else if (data.phase === "implementation" || data.phase === "retest") {
            updates.testScenarios = data.response;
          }

          return { ...card, ...updates };
        }),
        startingCardId: null,
        lockedCardIds: state.lockedCardIds.filter((id) => id !== cardId),
      }));

      return { success: true, phase: data.phase, newStatus: data.newStatus };
    } catch (error) {
      console.error("Failed to start task:", error);
      set((state) => ({
        startingCardId: null,
        lockedCardIds: state.lockedCardIds.filter((id) => id !== cardId),
      }));
      return {
        success: false,
        error: error instanceof Error ? error.message : "Unknown error",
      };
    }
  },

  openTerminal: async (cardId) => {
    // Lock the card immediately (manual unlock required)
    set((state) => ({
      lockedCardIds: state.lockedCardIds.includes(cardId)
        ? state.lockedCardIds
        : [...state.lockedCardIds, cardId],
    }));

    try {
      const response = await fetch(`/api/cards/${cardId}/open-terminal`, {
        method: "POST",
      });

      const data = await response.json();

      if (!response.ok) {
        // Unlock on error
        set((state) => ({
          lockedCardIds: state.lockedCardIds.filter((id) => id !== cardId),
        }));
        return { success: false, error: data.error || "Failed to open terminal" };
      }

      // Update card status in UI to match database
      // data.phase: "planning" | "implementation" | "retest"
      // data.newStatus: new status after operation
      // Keep card locked - manual unlock required
      set((state) => ({
        cards: state.cards.map((card) =>
          card.id === cardId
            ? {
                ...card,
                status: data.newStatus,
                updatedAt: new Date().toISOString(),
              }
            : card
        ),
      }));

      return { success: true, phase: data.phase, newStatus: data.newStatus, message: data.message };
    } catch (error) {
      console.error("Failed to open terminal:", error);
      // Unlock on error
      set((state) => ({
        lockedCardIds: state.lockedCardIds.filter((id) => id !== cardId),
      }));
      return {
        success: false,
        error: error instanceof Error ? error.message : "Unknown error",
      };
    }
  },

  openIdeationTerminal: async (cardId) => {
    // Lock the card immediately (manual unlock required after ideation)
    set((state) => ({
      lockedCardIds: state.lockedCardIds.includes(cardId)
        ? state.lockedCardIds
        : [...state.lockedCardIds, cardId],
    }));

    try {
      const response = await fetch(`/api/cards/${cardId}/ideate`, {
        method: "POST",
      });

      const data = await response.json();

      if (!response.ok) {
        // Unlock on error
        set((state) => ({
          lockedCardIds: state.lockedCardIds.filter((id) => id !== cardId),
        }));
        return { success: false, error: data.error || "Failed to open ideation terminal" };
      }

      // Card stays locked - manual unlock required after ideation session
      return { success: true, message: data.message };
    } catch (error) {
      console.error("Failed to open ideation terminal:", error);
      // Unlock on error
      set((state) => ({
        lockedCardIds: state.lockedCardIds.filter((id) => id !== cardId),
      }));
      return {
        success: false,
        error: error instanceof Error ? error.message : "Unknown error",
      };
    }
  },

  quickFixTask: async (cardId) => {
    set((state) => ({
      quickFixingCardId: cardId,
      lockedCardIds: state.lockedCardIds.includes(cardId)
        ? state.lockedCardIds
        : [...state.lockedCardIds, cardId],
    }));

    try {
      const response = await fetch(`/api/cards/${cardId}/quick-fix`, {
        method: "POST",
      });

      const data = await response.json();

      if (!response.ok) {
        set((state) => ({
          quickFixingCardId: null,
          lockedCardIds: state.lockedCardIds.filter((id) => id !== cardId),
        }));
        return { success: false, error: data.error || "Failed to quick fix" };
      }

      // Update card with results
      set((state) => ({
        cards: state.cards.map((card) => {
          if (card.id !== cardId) return card;

          return {
            ...card,
            status: data.newStatus,
            solutionSummary: data.solutionSummary,
            testScenarios: data.testScenarios,
            updatedAt: new Date().toISOString(),
          };
        }),
        quickFixingCardId: null,
        lockedCardIds: state.lockedCardIds.filter((id) => id !== cardId),
      }));

      return { success: true };
    } catch (error) {
      console.error("Failed to quick fix:", error);
      set((state) => ({
        quickFixingCardId: null,
        lockedCardIds: state.lockedCardIds.filter((id) => id !== cardId),
      }));
      return {
        success: false,
        error: error instanceof Error ? error.message : "Unknown error",
      };
    }
  },

  evaluateIdea: async (cardId) => {
    set((state) => ({
      evaluatingCardIds: state.evaluatingCardIds.includes(cardId)
        ? state.evaluatingCardIds
        : [...state.evaluatingCardIds, cardId],
      lockedCardIds: state.lockedCardIds.includes(cardId)
        ? state.lockedCardIds
        : [...state.lockedCardIds, cardId],
    }));

    try {
      const response = await fetch(`/api/cards/${cardId}/evaluate`, {
        method: "POST",
      });

      const data = await response.json();

      if (!response.ok) {
        set((state) => ({
          evaluatingCardIds: state.evaluatingCardIds.filter((id) => id !== cardId),
          lockedCardIds: state.lockedCardIds.filter((id) => id !== cardId),
        }));
        return { success: false, error: data.error || "Failed to evaluate idea" };
      }

      // Update card with AI opinion, priority, and complexity
      set((state) => ({
        cards: state.cards.map((card) => {
          if (card.id !== cardId) return card;

          const updates: Partial<Card> = {
            aiOpinion: data.aiOpinion,
            updatedAt: new Date().toISOString(),
          };

          // Update priority if provided
          if (data.priority) {
            updates.priority = data.priority;
          }

          // Update complexity if provided
          if (data.complexity) {
            updates.complexity = data.complexity;
          }

          return { ...card, ...updates };
        }),
        evaluatingCardIds: state.evaluatingCardIds.filter((id) => id !== cardId),
        lockedCardIds: state.lockedCardIds.filter((id) => id !== cardId),
      }));

      return { success: true };
    } catch (error) {
      console.error("Failed to evaluate idea:", error);
      set((state) => ({
        evaluatingCardIds: state.evaluatingCardIds.filter((id) => id !== cardId),
        lockedCardIds: state.lockedCardIds.filter((id) => id !== cardId),
      }));
      return {
        success: false,
        error: error instanceof Error ? error.message : "Unknown error",
      };
    }
  },

  lockCard: (cardId) => {
    set((state) => ({
      lockedCardIds: state.lockedCardIds.includes(cardId)
        ? state.lockedCardIds
        : [...state.lockedCardIds, cardId],
    }));
  },

  unlockCard: (cardId) => {
    set((state) => ({
      lockedCardIds: state.lockedCardIds.filter((id) => id !== cardId),
    }));
  },

  // Dev server actions
  startDevServer: async (cardId) => {
    try {
      const response = await fetch(`/api/cards/${cardId}/dev-server`, {
        method: "POST",
      });

      const data = await response.json();

      if (!response.ok) {
        return { success: false, error: data.error || "Failed to start dev server" };
      }

      // Update card with server info
      set((state) => ({
        cards: state.cards.map((card) =>
          card.id === cardId
            ? {
                ...card,
                devServerPort: data.port,
                devServerPid: data.pid,
                updatedAt: new Date().toISOString(),
              }
            : card
        ),
      }));

      return { success: true, port: data.port };
    } catch (error) {
      console.error("Failed to start dev server:", error);
      return {
        success: false,
        error: error instanceof Error ? error.message : "Unknown error",
      };
    }
  },

  stopDevServer: async (cardId) => {
    try {
      const response = await fetch(`/api/cards/${cardId}/dev-server`, {
        method: "DELETE",
      });

      const data = await response.json();

      if (!response.ok) {
        return { success: false, error: data.error || "Failed to stop dev server" };
      }

      // Update card to clear server info
      set((state) => ({
        cards: state.cards.map((card) =>
          card.id === cardId
            ? {
                ...card,
                devServerPort: null,
                devServerPid: null,
                updatedAt: new Date().toISOString(),
              }
            : card
        ),
      }));

      return { success: true };
    } catch (error) {
      console.error("Failed to stop dev server:", error);
      return {
        success: false,
        error: error instanceof Error ? error.message : "Unknown error",
      };
    }
  },

  // Settings actions
  fetchSettings: async () => {
    set({ isSettingsLoading: true });
    try {
      const response = await fetch("/api/settings");
      const settings = await response.json();
      set({ settings, isSettingsLoading: false });
    } catch (error) {
      console.error("Failed to fetch settings:", error);
      set({ isSettingsLoading: false });
    }
  },

  updateSettings: async (updates) => {
    try {
      const response = await fetch("/api/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(updates),
      });
      const settings = await response.json();
      set({ settings });

      // Refresh skills and MCPs if paths changed
      if (updates.skillsPath) {
        get().fetchSkills();
      }
      if (updates.mcpConfigPath) {
        get().fetchMcps();
      }
    } catch (error) {
      console.error("Failed to update settings:", error);
    }
  },

  // Conversation actions
  fetchConversation: async (cardId, sectionType) => {
    const key = `${cardId}-${sectionType}`;
    try {
      const response = await fetch(`/api/cards/${cardId}/conversations?section=${sectionType}`);
      const messages = await response.json();
      set((state) => ({
        conversations: {
          ...state.conversations,
          [key]: Array.isArray(messages) ? messages : [],
        },
      }));
    } catch (error) {
      console.error("Failed to fetch conversation:", error);
    }
  },

  sendMessage: async (cardId, sectionType, content, mentions, projectPath, currentSectionContent) => {
    const key = `${cardId}-${sectionType}`;

    // Create new abort controller
    const abortController = new AbortController();
    set({ isConversationLoading: true, conversationAbortController: abortController });

    // Create streaming placeholder
    const streamingId = `streaming-${Date.now()}`;
    set({
      streamingMessage: {
        id: streamingId,
        cardId,
        sectionType,
        role: "assistant",
        content: "",
        mentions: [],
        createdAt: new Date().toISOString(),
        isStreaming: true,
      },
    });

    try {
      const response = await fetch(`/api/cards/${cardId}/chat-stream`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sectionType,
          content,
          mentions,
          projectPath,
          currentSectionContent,
        }),
        signal: abortController.signal,
      });

      if (!response.ok || !response.body) {
        throw new Error("Failed to start chat stream");
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let fullContent = "";
      let assistantMessageId = "";
      let hadToolCalls = false;

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const messages = buffer.split("\n\n");
        buffer = messages.pop() || "";

        for (const message of messages) {
          if (!message.trim()) continue;

          const match = message.match(/^data:\s*(.+)$/m);
          if (match) {
            try {
              const event = JSON.parse(match[1]);

              switch (event.type) {
                case "start":
                  assistantMessageId = event.data.messageId;
                  break;
                case "text":
                  fullContent += event.data;
                  get().appendToStreamingMessage(event.data);
                  break;
                case "tool_use":
                case "tool_result":
                  hadToolCalls = true;
                  break;
                case "close":
                  // Message was saved on backend, refresh conversation
                  await get().fetchConversation(cardId, sectionType);
                  // If there were tool calls, refresh cards (they might have been updated)
                  if (hadToolCalls) {
                    await get().fetchCards();
                  }
                  break;
              }
            } catch {
              // Invalid JSON, skip
            }
          }
        }
      }
    } catch (error) {
      // Don't log abort errors
      if (error instanceof Error && error.name !== "AbortError") {
        console.error("Failed to send message:", error);
      }
    } finally {
      set({ isConversationLoading: false, streamingMessage: null, conversationAbortController: null });
    }
  },

  cancelConversation: () => {
    const controller = get().conversationAbortController;
    if (controller) {
      controller.abort();
      set({ isConversationLoading: false, streamingMessage: null, conversationAbortController: null });
    }
  },

  clearConversation: async (cardId, sectionType) => {
    const key = `${cardId}-${sectionType}`;
    try {
      await fetch(`/api/cards/${cardId}/conversations?section=${sectionType}`, {
        method: "DELETE",
      });
      set((state) => ({
        conversations: {
          ...state.conversations,
          [key]: [],
        },
      }));
    } catch (error) {
      console.error("Failed to clear conversation:", error);
    }
  },

  setStreamingMessage: (message) => set({ streamingMessage: message }),

  appendToStreamingMessage: (text) => {
    set((state) => {
      if (!state.streamingMessage) return state;
      return {
        streamingMessage: {
          ...state.streamingMessage,
          content: state.streamingMessage.content + text,
        },
      };
    });
  },
    }),
    {
      name: "kanban-preferences",
      partialize: (state) => ({
        collapsedColumns: state.collapsedColumns,
        isSidebarCollapsed: state.isSidebarCollapsed,
        completedFilter: state.completedFilter,
      }),
      merge: (persistedState, currentState) => {
        const persisted = persistedState as Partial<KanbanStore>;
        // Ensure withdrawn is always collapsed
        const collapsedColumns = persisted.collapsedColumns || [];
        if (!collapsedColumns.includes("withdrawn")) {
          collapsedColumns.push("withdrawn");
        }
        return {
          ...currentState,
          ...persisted,
          collapsedColumns,
        };
      },
    }
  )
);
