export type Status =
  | "ideation"
  | "backlog"
  | "bugs"
  | "progress"
  | "test"
  | "completed"
  | "withdrawn";

export type Complexity = "low" | "medium" | "high";
export type Priority = "low" | "medium" | "high";
export type GitBranchStatus = "active" | "merged" | "rolled_back" | null;
export type GitWorktreeStatus = "active" | "removed" | null;
export type ProcessingType = "autonomous" | "quick-fix" | "evaluate" | null;

// What git itself says about a card's branch, as opposed to what the DB
// remembers. `gitBranchStatus` only ever leaves "active" when the merge or
// rollback route runs, so a branch merged by hand in a terminal leaves the
// card claiming there is still something to merge.
//   missing           - the branch is gone; nothing left to merge
//   nothing-to-merge  - branch exists but carries no change the default
//                       branch doesn't already have
//   ready             - there is something to merge
export type MergeRealityState = "missing" | "nothing-to-merge" | "ready";

export interface MergeReality {
  branchName: string;
  defaultBranch: string;
  exists: boolean;
  ahead: number;
  behind: number;
  contentIdentical: boolean;
  // Tracked, uncommitted changes in the worktree. Merge can still proceed —
  // it commits them first — but the button should say so.
  needsCommit: boolean;
  state: MergeRealityState;
}
export type AiVerdict = "positive" | "negative" | null;

export interface Card {
  id: string;
  title: string;
  description: string;
  solutionSummary: string;
  testScenarios: string;
  aiOpinion: string;
  aiVerdict: AiVerdict;
  status: Status;
  complexity: Complexity;
  priority: Priority;
  projectFolder: string;
  projectId: string | null;
  groupId: string | null;
  // Manual position in the group's chain (1..N), written the first time
  // someone moves a card in it. null = never placed, falls back to task
  // number order behind the placed ones. Cleared by the DB when the card
  // changes group.
  groupOrder: number | null;
  // Place in the autonomous run queue; the lowest runs next. Positions may
  // have gaps (a card that leaves the queue by status change is cleared by
  // the DB without renumbering the rest), so read rank from the order, not
  // the number. null = not queued.
  queuePosition: number | null;
  taskNumber: number | null;
  gitBranchName: string | null;
  gitBranchStatus: GitBranchStatus;
  gitWorktreePath: string | null;
  gitWorktreeStatus: GitWorktreeStatus;
  devServerPort: number | null;
  devServerPid: number | null;
  rebaseConflict: boolean | null;
  conflictFiles: string[] | null;
  processingType: ProcessingType;
  aiPlatform: AiPlatform | null;
  useWorktree: boolean | null; // null = follow project setting, true/false = per-card override
  // Files the card's work produced, relative to the project folder, in the
  // order they were recorded. Written by the MCP save_output tool — the
  // file-delivery contract a Work card's Generate run reports through. Local
  // by nature: never sent to the team pool. null = nothing recorded yet.
  outputPaths: string[] | null;
  createdAt: string;
  updatedAt: string;
  completedAt: string | null;
}

/**
 * A chain of cards that belong to one piece of work. `code` is the short chip
 * shown on the card face ("LOOP"); `name` is the heading on the group row
 * ("Loop Engineering"). Membership is the only thing a group carries — it has
 * no status of its own, which is why it is a group and not an epic.
 */
export interface CardGroup {
  id: string;
  projectId: string | null;
  code: string;
  name: string;
  color: string | null;
  createdAt: string;
}

/**
 * What kind of work a project holds. "development" is the code-and-git flow
 * the board was built for; "work" is everything with no repo behind it —
 * minutes, mail, proposals, research. The mode decides which workspace lists
 * the project, what its columns are called and whether dev-only actions
 * (branches, dev server, merge) exist. Status ids never change with it, so
 * MCP, the DB and the pool see the same card either way.
 */
export type ProjectMode = "development" | "work";

export const PROJECT_MODES = ["development", "work"] as const;

export const DEFAULT_PROJECT_MODE: ProjectMode = "development";

export const PROJECT_MODE_OPTIONS: { value: ProjectMode; label: string; description: string }[] = [
  {
    value: "development",
    label: "Development",
    description: "Code in a git repo. Branches, worktrees, tests and a dev server.",
  },
  {
    value: "work",
    label: "Work",
    description: "Documents, research, mail, planning. Outputs are saved in this folder.",
  },
];

export type Voice = "entrepreneur" | "builder" | "engineer";

export const DEFAULT_VOICE: Voice = "builder";

export const VOICE_OPTIONS: { value: Voice; label: string; description: string }[] = [
  {
    value: "entrepreneur",
    label: "Entrepreneur",
    description:
      "Product-first language. No file paths or code references. Focuses on user impact and trade-offs.",
  },
  {
    value: "builder",
    label: "Builder",
    description:
      "Plain-language technical. Names files and changes but skips spec bullets. Best for solo founders who code.",
  },
  {
    value: "engineer",
    label: "Engineer",
    description:
      "Terse, spec-style. Includes file:line, snippets, and trade-offs. Optimized for SWE workflow.",
  },
];

/**
 * How a project answers the run button. Web apps serve a port we can preview;
 * desktop apps just run; Xcode projects hand off to Xcode; some projects have
 * no meaningful "run from here" at all.
 */
export type RunMode = "server" | "app" | "xcode" | "none";

export const RUN_MODES = ["server", "app", "xcode", "none"] as const;

export const RUN_MODE_OPTIONS: {
  value: RunMode;
  label: string;
  description: string;
}[] = [
  {
    value: "server",
    label: "Open in browser",
    description: "Starts the app and opens it in a browser tab. For websites and web apps.",
  },
  {
    value: "app",
    label: "Open the app",
    description: "Launches the app in its own window. No browser involved.",
  },
  {
    value: "xcode",
    label: "Open in Xcode",
    description: "Opens the test copy in Xcode, where you press ⌘R to run it yourself.",
  },
  {
    value: "none",
    label: "Nothing",
    description: "Hides the button for this project.",
  },
];

/** Button copy per mode, keyed by whether something is already running. */
export const RUN_MODE_LABELS: Record<RunMode, { start: string; running: string }> = {
  server: { start: "Start Dev Server", running: "Stop Server" },
  app: { start: "Start App", running: "Stop App" },
  xcode: { start: "Open in Xcode", running: "Open in Xcode" },
  none: { start: "Run", running: "Run" },
};

export interface Project {
  id: string;
  name: string;
  folderPath: string;
  idPrefix: string;
  nextTaskNumber: number;
  color: string;
  isPinned: boolean;
  documentPaths: string[] | null; // Custom document paths, null = smart discovery
  narrativePath: string | null; // Relative path to narrative file, null = docs/product-narrative.md
  useWorktrees: boolean; // Whether to use git worktrees for isolation (default: true)
  voice: Voice; // Project-level voice for AI outputs (default: 'builder')
  mode: ProjectMode; // Which workspace lists the project and which card actions exist (default: 'development')
  runMode: RunMode | null; // Explicit override, null = detect from the project folder
  detectedRunMode: RunMode; // Server-computed: what the project folder looks like
  resolvedRunMode: RunMode; // Server-computed: the override, or the detected mode
  isGitRepo: boolean; // Server-computed: whether the folder sits inside a git repo — drives the Work suggestion
  runCommand: string | null; // Override for the run command, null = mode default
  previewUrl: string | null; // Override for the previewed URL ({port} placeholder)
  sharedPaths: string[] | null; // Paths symlinked from main checkout into worktrees, null = auto
  cmuxWorkspaceId: string | null; // cmux workspace UUID for this project's tabs, "new" for a fresh one per run, null = match by folder
  sectionId: string | null; // Sidebar section, null = listed under "Other"
  createdAt: string;
  updatedAt: string;
}

// Sidebar-only grouping of projects. Never filters the board.
export interface ProjectSection {
  id: string;
  name: string;
  order: number;
  collapsed: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface DocumentFile {
  name: string;
  path: string;
  relativePath: string;
  isClaudeMd: boolean;
  source?: "custom" | "discovered" | "memory";
}

export type SkillSource = "global" | "project";

export interface SkillListItem {
  name: string;
  title: string;
  path: string;
  description: string | null;
  source: SkillSource;
  pluginKey?: string | null;
}

// A skill or agent pinned to a project's Toolkit. `name` is the catalog name
// the active provider lists it under; a pin whose name the provider cannot
// resolve stays in the list, greyed out.
export type ToolkitKind = "skill" | "agent";

export interface ToolkitItem {
  id: string;
  projectId: string;
  kind: ToolkitKind;
  name: string;
  source: SkillSource | null;
  // Toolkit folder the pin sits in; null keeps it at the top level. A folder
  // exists only while something is in it.
  folder: string | null;
  order: number;
  createdAt: string;
}

export interface SkillPreview extends SkillListItem {
  rawContent: string;
  bodyContent: string;
  frontmatter: Record<string, string>;
  firstHeading: string | null;
}

export type AgentFormat = "md" | "toml";

export interface AgentListItem {
  name: string;
  title: string;
  path: string;
  description: string | null;
  source: SkillSource;
  format: AgentFormat;
  pluginKey?: string | null;
}

export interface AgentPreview extends AgentListItem {
  rawContent: string;
  bodyContent: string;
  frontmatter: Record<string, string>;
  firstHeading: string | null;
}

export interface TreeNode {
  name: string;
  type: "folder" | "file";
  path: string;
  document?: DocumentFile;
  children: TreeNode[];
  fileCount: number;
}

export function getDisplayId(
  card: Card,
  project: Project | null | undefined
): string | null {
  if (!project || !card.taskNumber) return null;
  return `${project.idPrefix}-${card.taskNumber}`;
}

export interface Column {
  id: Status;
  title: string;
  cards: Card[];
}

export const COLUMNS: { id: Status; title: string }[] = [
  { id: "ideation", title: "Ideation" },
  { id: "backlog", title: "Backlog" },
  { id: "bugs", title: "Bugs" },
  { id: "progress", title: "In Progress" },
  { id: "test", title: "Human Test" },
  { id: "completed", title: "Completed" },
  { id: "withdrawn", title: "Withdrawn" },
];

// Only the titles that name a dev step change; the ids, the order and the
// colours stay, so a project can switch modes without a single card moving.
const WORK_COLUMN_TITLES: Partial<Record<Status, string>> = {
  bugs: "Revisions",
  test: "In Review",
  completed: "Done",
};

const WORK_COLUMNS: { id: Status; title: string }[] = COLUMNS.map((column) => ({
  id: column.id,
  title: WORK_COLUMN_TITLES[column.id] ?? column.title,
}));

export function getColumns(mode: ProjectMode | null | undefined): { id: Status; title: string }[] {
  return mode === "work" ? WORK_COLUMNS : COLUMNS;
}

export function getColumnTitle(status: Status, mode: ProjectMode | null | undefined): string {
  return getColumns(mode).find((column) => column.id === status)?.title ?? status;
}

export const STATUS_COLORS: Record<Status, string> = {
  ideation: "bg-status-ideation",
  backlog: "bg-status-backlog",
  bugs: "bg-status-bugs",
  progress: "bg-status-progress",
  test: "bg-status-test",
  completed: "bg-status-completed",
  withdrawn: "bg-status-withdrawn",
};

/**
 * Which question the board is answering. "all" is the seven columns — what is
 * there. "focus" is the short list of cards whose next move is yours.
 */
export type BoardView = "focus" | "all";

/**
 * What the board opens with. "last" reopens whichever view was left open, so
 * the setting can express a habit as well as a preference. The toggle itself
 * is always in the header: a view this significant should not be reachable
 * only through a settings dialog, where it would be set once and forgotten.
 */
export type BoardViewPreference = BoardView | "last";

export const BOARD_VIEW_PREFERENCE_OPTIONS: {
  value: BoardViewPreference;
  label: string;
}[] = [
  { value: "focus", label: "Focus" },
  { value: "all", label: "All columns" },
  { value: "last", label: "Last used" },
];

/**
 * Per-column day counts that replace the built-in staleness thresholds. Only
 * the columns the user actually changed appear here; everything else falls
 * through to the defaults in `lib/card-age.ts`.
 */
export type StaleThresholds = Partial<Record<Status, number>>;

/**
 * How many live cards a column holds before the count starts saying so.
 *
 * Not a gate. Dropping a seventh card into In Progress still works — the
 * number just turns red, which is the whole intent: the limit exists to be
 * heard, not to be enforced. Columns missing from this map have no meaningful
 * ceiling; a Backlog is allowed to be long and Completed is supposed to be.
 */
export const COLUMN_WIP_LIMITS: Partial<Record<Status, number>> = {
  backlog: 15,
  progress: 5,
  test: 8,
};

// Settings types
export type TerminalApp = "iterm2" | "ghostty" | "terminal" | "warp" | "cmux";
export type AiPlatform = "claude" | "gemini" | "codex" | "opencode";

export interface AppSettings {
  aiPlatform: AiPlatform;
  skillsPath: string;
  mcpConfigPath: string;
  terminalApp: TerminalApp;
  detectedTerminal: TerminalApp | null;
  // OS banner when an AI run finishes while the window is in the background.
  // Desktop app only; the browser build has no bridge to raise one.
  systemNotifications: boolean;
  // Which half of the board is showing. Lives in the settings table rather than
  // localStorage because quick entry is its own Electron window and has to
  // offer the same projects the main window is showing.
  activeWorkspace: ProjectMode;
  // Library lists plugin-provided skills and agents only when this is on.
  // Settings table, not localStorage, for the same Electron/dev-port reason.
  showPluginItems: boolean;
}

export const DEFAULT_SETTINGS: AppSettings = {
  aiPlatform: "claude",
  skillsPath: "~/.claude/skills",
  mcpConfigPath: "~/.claude.json",
  terminalApp: "iterm2",
  detectedTerminal: null,
  systemNotifications: true,
  activeWorkspace: "development",
  showPluginItems: false,
};

export const AI_PLATFORM_OPTIONS: { value: AiPlatform; label: string; description: string }[] = [
  { value: "claude", label: "Claude Code", description: "Anthropic's coding CLI" },
  { value: "gemini", label: "Gemini CLI", description: "Google's AI coding CLI" },
  { value: "codex", label: "Codex CLI", description: "OpenAI's coding CLI" },
  { value: "opencode", label: "OpenCode", description: "OpenCode CLI" },
];

export const TERMINAL_OPTIONS: { value: TerminalApp; label: string }[] = [
  { value: "iterm2", label: "iTerm2" },
  { value: "ghostty", label: "Ghostty" },
  { value: "terminal", label: "Terminal.app" },
  { value: "warp", label: "Warp" },
  { value: "cmux", label: "cmux" },
];

// Section types for card modal tabs
export type SectionType = "detail" | "opinion" | "solution" | "tests";

export const SECTION_CONFIG: Record<SectionType, {
  label: string;
  icon: string;
  color: string;
  placeholder: string;
  chatPlaceholder: string;
}> = {
  detail: {
    label: "Detail",
    icon: "FileText",
    color: "#3b82f6", // blue
    placeholder: "Describe the task...",
    chatPlaceholder: "Ask about this task...",
  },
  opinion: {
    label: "AI's Opinion",
    icon: "Brain",
    color: "#a855f7", // purple
    placeholder: "AI's evaluation of this idea...",
    chatPlaceholder: "Ask for technical analysis...",
  },
  solution: {
    label: "Solution",
    icon: "Lightbulb",
    color: "#f59e0b", // amber
    placeholder: "Document the agreed solution...",
    chatPlaceholder: "Refine the solution approach...",
  },
  tests: {
    label: "Tests",
    icon: "TestTube2",
    color: "#22c55e", // green
    placeholder: "- [ ] Test case 1\n- [ ] Test case 2",
    chatPlaceholder: "Add test scenarios...",
  },
};

// Mention types for chat input
export type UnifiedItemType = "skill" | "mcp" | "agent" | "plugin";

export interface MentionData {
  type: "skill" | "mcp" | "agent" | "plugin" | "card" | "document";
  id: string;
  label: string;
}

// Unified item for slash command suggestions
export interface UnifiedItem {
  id: string;
  label: string;
  type: UnifiedItemType;
  description?: string;
  pluginKey?: string | null;
  // Pinned to the project's Toolkit: listed first in the `/` picker.
  pinned?: boolean;
  // The pin's Toolkit folder, shown as a heading in the picker.
  folder?: string | null;
}

// Tool call data from Claude responses
export interface ToolCall {
  name: string;
  input: Record<string, unknown>;
  output?: string;
}

export interface ConversationActivityEntry {
  type: "thinking" | "tool_use" | "tool_result";
  content: string;
  /**
   * Stream-only: a thinking block that is still receiving deltas. The next
   * `thinking` delta appends to it instead of opening a new row. Never
   * persisted; see lib/conversation-activity.ts.
   */
  open?: boolean;
}

export type SessionStatusStep =
  | { step: "checking" }
  | { step: "session_found"; sessionId: string }
  | { step: "session_missing" }
  | { step: "resuming"; sessionId: string }
  | { step: "creating"; sessionId: string };

// Conversation message interface
export interface ConversationMessage {
  id: string;
  cardId: string;
  sectionType: SectionType;
  role: "user" | "assistant";
  content: string;
  mentions: MentionData[];
  toolCalls?: ToolCall[];
  activityLog?: ConversationActivityEntry[];
  activeToolCall?: { name: string; status: "running" | "completed" };
  statusSteps?: SessionStatusStep[];
  createdAt: string;
  isStreaming?: boolean;
}

// Background process tracking
export type ProcessType = "chat" | "autonomous" | "quick-fix" | "evaluate";

export type ProcessEndReason = "completed" | "aborted" | "failed";

export interface BackgroundProcess {
  id: string;              // `${cardId}-${sectionType}` or `${cardId}-${processType}`
  cardId: string;
  sectionType: SectionType | null;
  processType: ProcessType;
  cardTitle: string;
  displayId: string | null;
  pid: number;
  status: "running" | "completed" | "error";
  startedAt: string;
  completedAt?: string;    // When the process finished
  endReason?: ProcessEndReason; // Present when status === "completed"
  warning?: string | null; // Finished, but the output was not (fully) written
  error?: string | null;   // Why a "failed" run failed (stderr tail, timeout, …)
}

// Activity inbox: completed AI-work events that back the topbar bell.
// Distinct from BackgroundProcess (running) — this is the persistent history.
export type ActivityType =
  | "opinion"
  | "plan"
  | "implementation"
  | "autonomous"
  | "quickfix"
  // Run queue: why it paused, or why a card was dropped from it.
  | "queue"
  | "chat-detail"
  | "chat-opinion"
  | "chat-solution"
  | "chat-tests"
  | "apply"
  | "sync"
  | "team";

export interface ActivityHistoryEntry {
  summary: string | null;
  payload: Record<string, unknown>;
  at: string; // ISO date
}

export interface ActivityEvent {
  id: string;
  type: ActivityType;
  cardId: string | null;
  projectId: string | null;
  title: string;
  summary: string | null;
  payload: Record<string, unknown> & {
    runCount?: number;
    history?: ActivityHistoryEntry[];
  };
  isRead: boolean;
  createdAt: string;
  updatedAt: string;
}

// Cloud wrapper feeds extra sources (Supabase team notifications) via slot
// props. Base bell merges them into a single popover without touching local
// activity_events table.
export interface ActivitySource {
  key: string;
  events: ActivityEvent[];
  unreadCount: number;
  // Badge contribution. Sources without a "seen" notion leave this unset and
  // fall back to unreadCount.
  unseenCount?: number;
  // Called when the bell opens so the source can clear its badge count
  // without touching per-row read state.
  onSeen?: () => void | Promise<void>;
  onMarkRead?: (ids: string[]) => void | Promise<void>;
  onMarkAllRead?: () => void | Promise<void>;
}

// Completed column filter - Updated in main for conflict test
export type CompletedFilter = 'today' | 'yesterday' | 'this_week' | 'all';

export const COMPLETED_FILTER_OPTIONS: { value: CompletedFilter; label: string }[] = [
  { value: 'today', label: 'Today' },
  { value: 'yesterday', label: 'Yesterday' },
  { value: 'this_week', label: 'This Week' },
  { value: 'all', label: 'All Time' },
];

// Complexity & Priority options
export const COMPLEXITY_OPTIONS: { value: Complexity; label: string; color: string }[] = [
  { value: "low", label: "Low", color: "#22c55e" },
  { value: "medium", label: "Medium", color: "#eab308" },
  { value: "high", label: "High", color: "#ef4444" },
];

export const PRIORITY_OPTIONS: { value: Priority; label: string; color: string }[] = [
  { value: "low", label: "Low", color: "#6b7280" },
  { value: "medium", label: "Medium", color: "#3b82f6" },
  { value: "high", label: "High", color: "#ef4444" },
];
