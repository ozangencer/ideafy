import { StateCreator } from "zustand";
import {
  AgentListItem,
  AgentPreview,
  AppSettings,
  BackgroundProcess,
  Card,
  CompletedFilter,
  ConversationMessage,
  DocumentFile,
  MentionData,
  Project,
  SectionType,
  SkillListItem,
  SkillPreview,
  Status,
  UnifiedItem,
  UserSkillGroup,
} from "../types";

export interface KanbanStore {
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
  expandedDocFolders: string[];
  agentItems: AgentListItem[];
  projectAgentItems: AgentListItem[];
  selectedAgent: AgentPreview | null;
  isAgentViewerOpen: boolean;
  skillItems: SkillListItem[];
  projectSkillItems: SkillListItem[];
  selectedSkill: SkillPreview | null;
  isSkillViewerOpen: boolean;
  globalSkillGroups: UserSkillGroup[];
  projectSkillGroups: Record<string, UserSkillGroup[]>;

  // Sidebar state
  isSidebarCollapsed: boolean;
  sidebarWidth: number;
  collapsedSkillGroups: string[];

  // Column collapse state
  collapsedColumns: Status[];

  // Completed column filter
  completedFilter: CompletedFilter;

  // Quick entry state
  isQuickEntryOpen: boolean;

  // Skills, MCPs, Agents & Plugins state
  skills: string[];
  mcps: string[];
  agents: string[];
  plugins: string[];
  projectSkills: string[];
  projectMcps: string[];
  projectAgents: string[];

  // Claude integration state
  startingCardIds: string[];
  quickFixingCardIds: string[];
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
  conversationError: string | null;

  // Background processes state
  backgroundProcesses: BackgroundProcess[];

  // Card actions
  fetchCards: () => Promise<void>;
  setCards: (cards: Card[]) => void;
  addCard: (
    card: Omit<Card, "id" | "createdAt" | "updatedAt" | "taskNumber" | "completedAt">
  ) => Promise<Card | null>;
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
  deleteProject: (id: string, deleteCards?: boolean) => Promise<void>;
  setActiveProject: (projectId: string | null) => void;
  toggleProjectPin: (id: string) => Promise<void>;

  // Document actions
  fetchDocuments: (projectId: string) => Promise<void>;
  openDocument: (doc: DocumentFile) => Promise<void>;
  saveDocument: () => Promise<void>;
  closeDocumentEditor: () => void;
  setDocumentContent: (content: string) => void;
  toggleDocFolder: (path: string) => void;

  // Sidebar actions
  toggleSidebar: () => void;
  setSidebarWidth: (width: number) => void;
  toggleSkillGroupCollapse: (groupKey: string) => void;

  // Column collapse actions
  toggleColumnCollapse: (columnId: Status) => void;

  // Completed filter actions
  setCompletedFilter: (filter: CompletedFilter) => void;

  // Quick entry actions
  openQuickEntry: () => void;
  closeQuickEntry: () => void;
  toggleQuickEntry: () => void;

  // Skills, MCPs, Agents & Plugins actions
  fetchSkills: () => Promise<void>;
  fetchSkillGroups: () => Promise<void>;
  openAgentPreview: (agent: AgentListItem) => Promise<void>;
  closeAgentViewer: () => void;
  openSkillPreview: (skill: SkillListItem) => Promise<void>;
  closeSkillViewer: () => void;
  createSkillGroup: (
    name: string,
    source: "global" | "project",
    projectId?: string | null
  ) => Promise<string | null>;
  renameSkillGroup: (
    groupId: string,
    name: string,
    source: "global" | "project",
    projectId?: string | null
  ) => Promise<void>;
  deleteSkillGroup: (
    groupId: string,
    source: "global" | "project",
    projectId?: string | null
  ) => Promise<void>;
  moveSkillToGroup: (
    skillName: string,
    groupId: string | null,
    source: "global" | "project",
    projectId?: string | null
  ) => Promise<void>;
  fetchMcps: () => Promise<void>;
  fetchAgents: () => Promise<void>;
  fetchPlugins: () => Promise<void>;
  fetchProjectExtensions: (projectId: string | null) => Promise<void>;
  getUnifiedItems: () => UnifiedItem[];

  // Claude integration actions
  startTask: (cardId: string) => Promise<{ success: boolean; error?: string }>;
  openTerminal: (cardId: string) => Promise<{ success: boolean; error?: string }>;
  openIdeationTerminal: (cardId: string) => Promise<{ success: boolean; error?: string }>;
  openTestTerminal: (cardId: string) => Promise<{ success: boolean; error?: string }>;
  quickFixTask: (cardId: string) => Promise<{ success: boolean; error?: string }>;
  evaluateIdea: (cardId: string) => Promise<{ success: boolean; error?: string }>;
  lockCard: (cardId: string) => void;
  unlockCard: (cardId: string) => void;
  clearProcessing: (cardId: string) => Promise<{ success: boolean; error?: string }>;

  // Dev server actions
  startDevServer: (cardId: string) => Promise<{ success: boolean; port?: number; error?: string }>;
  stopDevServer: (cardId: string) => Promise<{ success: boolean; error?: string }>;

  // Settings actions
  fetchSettings: () => Promise<void>;
  updateSettings: (updates: Partial<AppSettings>) => Promise<void>;

  // Conversation actions
  fetchConversation: (cardId: string, sectionType: SectionType) => Promise<void>;
  sendMessage: (
    cardId: string,
    sectionType: SectionType,
    content: string,
    mentions: MentionData[],
    projectPath: string,
    currentSectionContent: string
  ) => Promise<void>;
  cancelConversation: () => void;
  detachConversation: () => void;
  clearConversation: (cardId: string, sectionType: SectionType) => Promise<void>;
  setStreamingMessage: (message: ConversationMessage | null) => void;
  appendToStreamingMessage: (text: string) => void;
  setConversationError: (error: string | null) => void;

  // Background processes actions
  fetchBackgroundProcesses: () => Promise<void>;
  killBackgroundProcess: (processKey: string) => Promise<void>;
  clearCompletedProcesses: () => Promise<void>;
}

// Custom slice creator type that makes the store parameter optional
export type StoreSlice<T> = (
  set: Parameters<StateCreator<KanbanStore, [], [], T>>[0],
  get: Parameters<StateCreator<KanbanStore, [], [], T>>[1]
) => T;
