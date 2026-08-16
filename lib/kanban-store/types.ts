import { StateCreator } from "zustand";
import {
  ActivityEvent,
  AgentListItem,
  AgentPreview,
  AppSettings,
  BackgroundProcess,
  BoardView,
  BoardViewPreference,
  Card,
  CardGroup,
  CompletedFilter,
  ConversationMessage,
  DocumentFile,
  MentionData,
  Project,
  RunMode,
  SectionType,
  SkillListItem,
  SkillPreview,
  StaleThresholds,
  Status,
  UnifiedItem,
  UserSkillGroup,
} from "../types";

export type CardUpdatePayload = Partial<Card> & {
  baseUpdatedAt?: string;
};

export interface KanbanStore {
  // Cards state
  cards: Card[];
  cardGroups: CardGroup[];
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
  memoryFiles: DocumentFile[];
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
  isProjectListExpanded: boolean;
  collapsedSkillGroups: string[];

  // Column collapse state
  collapsedColumns: Status[];

  // Card-group fold state, keyed by groupFoldKey(groupId, columnId). Groups
  // fold by default, so this holds the rows the user opened — see the note in
  // slices/ui.ts.
  expandedGroups: string[];

  // Columns the user opened past the per-column render cap.
  uncappedColumns: Status[];

  // Completed column filter
  completedFilter: CompletedFilter;

  // Focus vs. the seven columns. `boardView` is what is showing;
  // `boardViewPreference` is what the board opens with.
  boardView: BoardView;
  boardViewPreference: BoardViewPreference;

  // Per-column staleness overrides. Columns absent here use the defaults.
  staleThresholds: StaleThresholds;

  // Quick entry state
  isQuickEntryOpen: boolean;

  // Deep-link target for the next card-modal open. Activity bell sets this
  // before calling selectCard()+openModal() so the modal lands on the right
  // section (e.g. AI Opinion). Modal consumes & clears it on mount.
  pendingCardSection: SectionType | null;

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
  /**
   * Set when a run was refused because the card's text was written by someone
   * else and the user has not confirmed it yet. Holds the text to review so
   * the dialog can show what it is asking approval for. Always null in the
   * solo edition — nothing there produces externally-authored cards.
   */
  pendingRunConfirmation: {
    cardId: string;
    action: "startTask" | "quickFixTask" | "evaluateIdea";
    title: string;
    description: string;
  } | null;
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
  // Bumped after a chat-stream that ran MCP tools finishes and fetchCards has
  // returned. Modals watch this to force-resync form fields with the freshly
  // written card, bypassing the "skip if user has unsaved changes" guard
  // (server-driven differences should win over the form's stale snapshot).
  mcpWriteVersion: number;
  // Bumped after the user clicks Append/Replace on an assistant message and
  // the apply-message API has merged the new HTML into the card. Modals
  // watch this to force-resync form fields with the freshly written content,
  // bypassing the unsaved-changes guard.
  applyMessageVersion: number;
  bumpApplyMessageVersion: () => void;

  // Background processes state
  backgroundProcesses: BackgroundProcess[];

  // Activity inbox state (notification bell)
  activityEvents: ActivityEvent[];
  activityUnreadCount: number;

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
  updateCard: (id: string, updates: CardUpdatePayload) => Promise<void>;
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
  fetchMemory: (projectId: string) => Promise<void>;
  openDocument: (doc: DocumentFile) => Promise<void>;
  saveDocument: () => Promise<void>;
  closeDocumentEditor: () => void;
  setDocumentContent: (content: string) => void;
  toggleDocFolder: (path: string) => void;

  // Sidebar actions
  toggleSidebar: () => void;
  setSidebarWidth: (width: number) => void;
  toggleProjectListExpanded: () => void;
  toggleSkillGroupCollapse: (groupKey: string) => void;

  // Column collapse actions
  toggleColumnCollapse: (columnId: Status) => void;

  // Card-group fold actions. Takes a groupFoldKey, not a bare group id.
  toggleGroupCollapse: (groupKey: string) => void;

  // Column render-cap actions
  toggleColumnCap: (columnId: Status) => void;

  // Completed filter actions
  setCompletedFilter: (filter: CompletedFilter) => void;

  // Board view actions
  setBoardView: (view: BoardView) => void;
  setBoardViewPreference: (preference: BoardViewPreference) => void;

  /** Pass null to drop the override and fall back to the column's default. */
  setStaleThreshold: (status: Status, days: number | null) => void;

  // Quick entry actions
  openQuickEntry: () => void;
  closeQuickEntry: () => void;
  toggleQuickEntry: () => void;

  // Deep-link section setter (activity bell → card modal)
  setPendingCardSection: (section: SectionType | null) => void;

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
  startTask: (cardId: string, acknowledged?: boolean) => Promise<{ success: boolean; error?: string }>;
  openTerminal: (cardId: string) => Promise<{ success: boolean; error?: string }>;
  openIdeationTerminal: (cardId: string) => Promise<{ success: boolean; error?: string }>;
  openTestTerminal: (cardId: string) => Promise<{ success: boolean; error?: string }>;
  quickFixTask: (cardId: string, acknowledged?: boolean) => Promise<{ success: boolean; error?: string }>;
  evaluateIdea: (cardId: string, acknowledged?: boolean) => Promise<{ success: boolean; error?: string }>;
  lockCard: (cardId: string) => void;
  unlockCard: (cardId: string) => void;
  clearProcessing: (cardId: string) => Promise<{ success: boolean; error?: string }>;
  /** Re-runs the refused action, this time carrying the user's confirmation. */
  confirmPendingRun: () => Promise<{ success: boolean; error?: string }>;
  /** Dismisses the confirmation without running anything. */
  cancelPendingRun: () => void;

  // Run actions (dev server, desktop app, or handing the worktree to Xcode)
  startDevServer: (cardId: string) => Promise<{
    success: boolean;
    port?: number | null;
    mode?: RunMode;
    /** True when the run handed off to another app and left nothing to stop. */
    oneShot?: boolean;
    message?: string;
    error?: string;
  }>;
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
  attachLiveStream: (cardId: string, sectionType: SectionType) => Promise<void>;
  clearConversation: (cardId: string, sectionType: SectionType) => Promise<void>;
  setStreamingMessage: (message: ConversationMessage | null) => void;
  appendToStreamingMessage: (text: string) => void;
  setConversationError: (error: string | null) => void;

  // Background processes actions
  fetchBackgroundProcesses: () => Promise<void>;
  killBackgroundProcess: (processKey: string) => Promise<void>;
  clearCompletedProcesses: () => Promise<void>;

  // Activity inbox actions
  fetchActivity: () => Promise<void>;
  fetchActivityUnreadCount: () => Promise<void>;
  markActivityRead: (ids: string[]) => Promise<void>;
  markAllActivityRead: () => Promise<void>;
}

// Custom slice creator type that makes the store parameter optional
export type StoreSlice<T> = (
  set: Parameters<StateCreator<KanbanStore, [], [], T>>[0],
  get: Parameters<StateCreator<KanbanStore, [], [], T>>[1]
) => T;
