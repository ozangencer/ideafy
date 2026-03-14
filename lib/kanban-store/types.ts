import { StateCreator } from "zustand";
import {
  AppSettings,
  BackgroundProcess,
  Card,
  CompletedFilter,
  ConversationMessage,
  DocumentFile,
  MentionData,
  Project,
  SectionType,
  Status,
  UnifiedItem,
} from "../types";
import type { TeamUser, Team, TeamMember, PoolCard } from "../team/types";

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

  // Sidebar state
  isSidebarCollapsed: boolean;
  sidebarWidth: number;

  // Column collapse state
  collapsedColumns: Status[];

  // Completed column filter
  completedFilter: CompletedFilter;

  // Quick entry state
  isQuickEntryOpen: boolean;

  // Skills, MCPs & Plugins state
  skills: string[];
  mcps: string[];
  plugins: string[];
  projectSkills: string[];
  projectMcps: string[];

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
  deleteCard: (id: string, options?: { removeFromPool?: boolean }) => Promise<void>;
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
  toggleDocFolder: (path: string) => void;

  // Sidebar actions
  toggleSidebar: () => void;
  setSidebarWidth: (width: number) => void;

  // Column collapse actions
  toggleColumnCollapse: (columnId: Status) => void;

  // Completed filter actions
  setCompletedFilter: (filter: CompletedFilter) => void;

  // Quick entry actions
  openQuickEntry: () => void;
  closeQuickEntry: () => void;
  toggleQuickEntry: () => void;

  // Skills, MCPs & Plugins actions
  fetchSkills: () => Promise<void>;
  fetchMcps: () => Promise<void>;
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

  // Team state
  teamMode: boolean;
  supabaseConfigured: boolean;
  currentUser: TeamUser | null;
  teams: Team[];
  activeTeamId: string | null;
  teamMembers: TeamMember[];
  teamMembersByTeamId: Record<string, TeamMember[]>;
  poolCards: PoolCard[];
  isTeamLoading: boolean;

  // Team actions
  initTeam: () => Promise<void>;
  signUp: (email: string, password: string, displayName: string) => Promise<{ user: TeamUser | null; error: string | null }>;
  signIn: (email: string, password: string) => Promise<{ user: TeamUser | null; error: string | null }>;
  signInOAuth: (provider: "google" | "github") => Promise<{ error: string | null }>;
  signOutUser: () => Promise<{ error: string | null }>;
  createTeam: (name: string) => Promise<{ error: string | null }>;
  joinTeam: (inviteCode: string) => Promise<{ error: string | null }>;
  leaveTeam: (teamId: string) => Promise<{ error: string | null }>;
  setActiveTeam: (teamId: string | null) => void;
  fetchTeam: () => Promise<void>;
  fetchTeamMembers: () => Promise<void>;
  fetchMembersForTeam: (teamId: string) => Promise<TeamMember[]>;
  fetchPoolCards: (teamId?: string) => Promise<void>;
  sendToPool: (cardId: string, assignedTo?: string) => Promise<{ error: string | null; poolCardId?: string }>;
  pullFromPool: (poolCardId: string) => Promise<{ error: string | null; cardId?: string }>;
  pushUpdate: (cardId: string) => Promise<{ error: string | null }>;
  removeFromPool: (poolCardId: string, localCardId?: string) => Promise<{ error: string | null }>;
  claimPoolCard: (poolCardId: string, action?: "claim" | "unclaim") => Promise<{ error: string | null }>;
  updateMemberRole: (targetUserId: string, newRole: "admin" | "member") => Promise<{ error: string | null }>;
}

// Custom slice creator type that makes the store parameter optional
export type StoreSlice<T> = (
  set: Parameters<StateCreator<KanbanStore, [], [], T>>[0],
  get: Parameters<StateCreator<KanbanStore, [], [], T>>[1]
) => T;
