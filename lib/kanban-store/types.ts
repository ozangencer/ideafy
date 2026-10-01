import { StateCreator } from "zustand";
import type { QueueSnapshot } from "../card-queue";
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
  ProjectMode,
  ProjectSection,
  RunMode,
  SectionType,
  SkillListItem,
  SkillPreview,
  SkillSource,
  StaleThresholds,
  Status,
  ToolkitItem,
  ToolkitKind,
  UnifiedItem,
} from "../types";

export type CardUpdatePayload = Partial<Card> & {
  baseUpdatedAt?: string;
};

// One reversible board action. Only what the user does on the board lands
// here — moves made by Claude or over MCP are left alone, since silently
// undoing the AI's work would be more confusing than helpful.
export type UndoStep =
  | { kind: "delete"; cardId: string }
  | { kind: "move"; cardId: string; prevStatus: Status; prevCompletedAt: string | null };

// What one Cmd+Z reverses: usually a single step, or a whole batch (moving a
// stale group) so the user doesn't have to press it once per card.
export interface UndoEntry {
  id: string;
  label: string;
  steps: UndoStep[];
  at: number;
  /** Extra line for the announce toast, e.g. cards a bulk action skipped. */
  note?: string;
}

export interface UndoResult {
  entry: UndoEntry;
  undone: number;
  error: string | null;
}

// Card actions whose effect should not be written to the undo stack pass
// recordHistory: false — undo's own moves use it so undoing doesn't create
// something new to undo.
export interface HistoryOptions {
  recordHistory?: boolean;
}

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
  // Which half of the board is showing. Mirrors settings.activeWorkspace so
  // components need not wait for the settings fetch to know it.
  activeWorkspace: ProjectMode;
  isProjectsLoading: boolean;
  projectSections: ProjectSection[];

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
  // Skills and agents pinned to the active project, in Toolkit order.
  toolkitItems: ToolkitItem[];

  // Sidebar state
  isSidebarCollapsed: boolean;
  sidebarWidth: number;
  isProjectListExpanded: boolean;

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

  // Multi-select on the board. Not `selectedCard`, which is the card open in
  // the modal — the two are never live at once (openModal clears this). The
  // anchor is where a Shift+click range starts. Session-only, never persisted.
  selectedCardIds: string[];
  selectionAnchorId: string | null;
  // Lives in the store so the action bar, the ⌫ shortcut and a card's context
  // menu all open the same confirmation.
  isBulkDeleteConfirmOpen: boolean;

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
  // In-flight assistant bubbles and the POSTs feeding them, keyed like
  // `conversations`. Keyed so two chats streaming at once never share a bubble.
  streamingMessages: Record<string, ConversationMessage>;
  conversationAbortControllers: Record<string, AbortController>;
  conversationError: string | null;
  // Bumped after a chat-stream that ran MCP tools finishes and fetchCards has
  // returned. Modals watch this to force-resync form fields with the freshly
  // written card, bypassing the "skip if user has unsaved changes" guard
  // (server-driven differences should win over the form's stale snapshot).
  mcpWriteVersion: number;
  // The card the latest bump wrote to. Only a modal showing that card takes
  // the forced resync; any other open card, or a draft, keeps its form.
  mcpWriteCardId: string | null;
  // Bumped after the user clicks Append/Replace on an assistant message and
  // the apply-message API has merged the new HTML into the card. Modals
  // watch this to force-resync form fields with the freshly written content,
  // bypassing the unsaved-changes guard.
  applyMessageVersion: number;
  bumpApplyMessageVersion: () => void;

  // Background processes state
  backgroundProcesses: BackgroundProcess[];

  // Run queue, as the server last reported it (null until the first poll)
  queueState: QueueSnapshot | null;

  // Activity inbox state (notification bell)
  activityEvents: ActivityEvent[];
  activityUnreadCount: number;
  // Badge count: unread events newer than the last time the bell was opened
  activityUnseenCount: number;
  activityLastSeenAt: string | null;

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
  /** Resolves false when the write did not land; the optimistic update is rolled back. */
  updateCard: (id: string, updates: CardUpdatePayload) => Promise<boolean>;
  deleteCard: (id: string, options?: HistoryOptions) => Promise<void>;
  moveCard: (id: string, newStatus: Status, options?: HistoryOptions) => Promise<void>;
  // Bulk versions for the multi-select bar. One Cmd+Z reverses the whole
  // group; cards with a run in flight are skipped and reported.
  deleteCards: (ids: string[]) => Promise<void>;
  moveCards: (ids: string[], newStatus: Status) => Promise<void>;
  selectCard: (card: Card | null) => void;
  openModal: () => void;
  closeModal: () => void;
  setSearchQuery: (query: string) => void;

  // Card-group actions. Membership itself is a card field, so joining a chain
  // goes through updateCard({ groupId }) — this only mints the chain.
  createCardGroup: (input: {
    code: string;
    name: string;
    color?: string | null;
    projectId?: string | null;
  }) => Promise<CardGroup | null>;
  updateCardGroup: (
    id: string,
    updates: { code?: string; name?: string; color?: string | null }
  ) => Promise<boolean>;
  // Deleting a chain releases its members rather than taking them with it, so
  // the only safe target is one nobody is in — which is what the picker
  // offers. The member release is mirrored locally anyway: a card left
  // pointing at a group that is gone renders as an ordinary card with no
  // explanation until the next poll.
  deleteCardGroup: (id: string) => Promise<boolean>;
  // Puts `cardId` right behind `afterCardId` in its chain (null = the start).
  // The whole chain is renumbered 1..N locally first, the same way the route
  // does it, so the popover reorders on click.
  placeCardInChain: (
    groupId: string,
    cardId: string,
    afterCardId: string | null
  ) => Promise<boolean>;

  // Undo history (Cmd+Z). Session-only: a reload starts with an empty stack,
  // though deleted cards stay restorable server-side for a week.
  undoStack: UndoEntry[];
  undoBatch: { label: string; steps: UndoStep[] } | null;
  isUndoing: boolean;
  pushUndoStep: (step: UndoStep, label: string) => void;
  beginUndoBatch: (label: string) => void;
  endUndoBatch: (note?: string) => void;
  undo: () => Promise<UndoResult | null>;

  // Project actions
  fetchProjects: () => Promise<void>;
  addProject: (
    project: Omit<Project, "id" | "createdAt" | "updatedAt" | "nextTaskNumber" | "sectionId">
  ) => Promise<void>;
  updateProject: (id: string, updates: Partial<Project>) => Promise<void>;
  deleteProject: (id: string, deleteCards?: boolean) => Promise<void>;
  setActiveProject: (projectId: string | null) => void;
  setActiveWorkspace: (workspace: ProjectMode) => Promise<void>;
  toggleProjectPin: (id: string) => Promise<void>;

  // Project section actions (sidebar-only grouping)
  createProjectSection: (name: string) => Promise<ProjectSection | null>;
  renameProjectSection: (id: string, name: string) => Promise<void>;
  deleteProjectSection: (id: string) => Promise<void>;
  moveProjectSection: (id: string, direction: "up" | "down") => Promise<void>;
  toggleProjectSectionCollapsed: (id: string) => Promise<void>;
  moveProjectToSection: (projectId: string, sectionId: string | null) => Promise<void>;

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

  // Multi-select actions. selectCardRange adds to the selection; the caller
  // works out which ids the range covers, since only it knows the visible order.
  toggleCardSelection: (id: string) => void;
  selectCardRange: (ids: string[]) => void;
  clearCardSelection: () => void;
  setBulkDeleteConfirmOpen: (open: boolean) => void;

  // Quick entry actions
  openQuickEntry: () => void;
  closeQuickEntry: () => void;
  toggleQuickEntry: () => void;

  // Deep-link section setter (activity bell → card modal)
  setPendingCardSection: (section: SectionType | null) => void;

  // Skills, MCPs, Agents & Plugins actions
  fetchSkills: () => Promise<void>;
  openAgentPreview: (agent: AgentListItem) => Promise<void>;
  closeAgentViewer: () => void;
  openSkillPreview: (skill: SkillListItem) => Promise<void>;
  closeSkillViewer: () => void;
  fetchMcps: () => Promise<void>;
  fetchAgents: () => Promise<void>;
  fetchPlugins: () => Promise<void>;
  fetchProjectExtensions: (projectId: string | null) => Promise<void>;
  getUnifiedItems: () => UnifiedItem[];

  // Toolkit actions. Pin/unpin act on the active project and are optimistic.
  fetchToolkit: (projectId: string | null) => Promise<void>;
  pinToolkitItem: (kind: ToolkitKind, name: string, source?: SkillSource | null) => Promise<void>;
  unpinToolkitItem: (kind: ToolkitKind, name: string) => Promise<void>;
  // `folder` null or empty moves the pin back to the top level.
  moveToolkitItem: (kind: ToolkitKind, name: string, folder: string | null) => Promise<void>;
  // An empty `to` dissolves the folder; its pins stay pinned at the top level.
  renameToolkitFolder: (from: string, to: string | null) => Promise<void>;

  // Claude integration actions
  startTask: (cardId: string, acknowledged?: boolean) => Promise<{ success: boolean; error?: string; warning?: string | null; stopped?: boolean }>;
  openTerminal: (cardId: string) => Promise<{ success: boolean; error?: string }>;
  openIdeationTerminal: (cardId: string) => Promise<{ success: boolean; error?: string }>;
  openTestTerminal: (cardId: string) => Promise<{ success: boolean; error?: string }>;
  resolveConflictWithAI: (
    cardId: string,
    conflict: { conflictFiles: string[]; worktreePath: string; branchName: string }
  ) => Promise<{ success: boolean; error?: string }>;
  quickFixTask: (cardId: string, acknowledged?: boolean) => Promise<{ success: boolean; error?: string; warning?: string | null }>;
  evaluateIdea: (cardId: string, acknowledged?: boolean) => Promise<{ success: boolean; error?: string; warning?: string | null }>;
  lockCard: (cardId: string) => void;
  unlockCard: (cardId: string) => void;
  clearProcessing: (cardId: string) => Promise<{ success: boolean; error?: string }>;
  /**
   * Pulls the card from the server after the heartbeat sees a run end that no
   * in-page handler is waiting on, and forces the open modal to resync.
   */
  syncCardAfterRunEnd: (cardId: string) => Promise<void>;
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
  cancelConversation: (cardId: string, sectionType: SectionType) => void;
  detachConversation: () => void;
  attachLiveStream: (cardId: string, sectionType: SectionType) => Promise<void>;
  clearConversation: (cardId: string, sectionType: SectionType) => Promise<void>;
  setStreamingMessage: (key: string, message: ConversationMessage | null) => void;
  appendToStreamingMessage: (key: string, text: string) => void;
  setConversationError: (error: string | null) => void;

  // Background processes actions
  fetchBackgroundProcesses: () => Promise<void>;
  killBackgroundProcess: (processKey: string) => Promise<void>;
  clearCompletedProcesses: () => Promise<void>;

  // Run queue actions. addToQueue appends in the order given;
  // moveInQueue's null afterCardId moves the card to the front.
  fetchQueue: () => Promise<void>;
  // `useWorktree` is the branch choice from the Add to queue submenu, written
  // onto each card (as an override only where it differs from its project)
  // before the card is queued. Omitted, cards keep whatever they had.
  addToQueue: (cardIds: string[], options?: { useWorktree?: boolean }) => Promise<void>;
  setQueuedCardWorktree: (cardId: string, useWorktree: boolean) => Promise<void>;
  removeFromQueue: (cardId: string) => Promise<void>;
  moveInQueue: (cardId: string, afterCardId: string | null) => Promise<void>;
  setQueueRunning: (running: boolean) => Promise<void>;

  // Activity inbox actions
  fetchActivity: () => Promise<void>;
  fetchActivityUnreadCount: () => Promise<void>;
  markActivityRead: (ids: string[]) => Promise<void>;
  markActivityReadForCard: (cardId: string) => Promise<void>;
  markActivitySeen: () => Promise<void>;
  markAllActivityRead: () => Promise<void>;
}

// Custom slice creator type that makes the store parameter optional
export type StoreSlice<T> = (
  set: Parameters<StateCreator<KanbanStore, [], [], T>>[0],
  get: Parameters<StateCreator<KanbanStore, [], [], T>>[1]
) => T;
