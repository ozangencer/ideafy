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
  createdAt: string;
  updatedAt: string;
  completedAt: string | null;
}

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
  createdAt: string;
  updatedAt: string;
}

export interface DocumentFile {
  name: string;
  path: string;
  relativePath: string;
  isClaudeMd: boolean;
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

export const STATUS_COLORS: Record<Status, string> = {
  ideation: "bg-status-ideation",
  backlog: "bg-status-backlog",
  bugs: "bg-status-bugs",
  progress: "bg-status-progress",
  test: "bg-status-test",
  completed: "bg-status-completed",
  withdrawn: "bg-status-withdrawn",
};

// Settings types
export type TerminalApp = "iterm2" | "ghostty" | "terminal";

export interface AppSettings {
  skillsPath: string;
  mcpConfigPath: string;
  terminalApp: TerminalApp;
  detectedTerminal: TerminalApp | null;
}

export const DEFAULT_SETTINGS: AppSettings = {
  skillsPath: "~/.claude/skills",
  mcpConfigPath: "~/.claude.json",
  terminalApp: "iterm2",
  detectedTerminal: null,
};

export const TERMINAL_OPTIONS: { value: TerminalApp; label: string }[] = [
  { value: "iterm2", label: "iTerm2" },
  { value: "ghostty", label: "Ghostty" },
  { value: "terminal", label: "Terminal.app" },
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
export type UnifiedItemType = "skill" | "mcp" | "plugin";

export interface MentionData {
  type: "skill" | "mcp" | "plugin" | "card" | "document";
  id: string;
  label: string;
}

// Unified item for slash command suggestions
export interface UnifiedItem {
  id: string;
  label: string;
  type: UnifiedItemType;
  description?: string;
}

// Tool call data from Claude responses
export interface ToolCall {
  name: string;
  input: Record<string, unknown>;
  output?: string;
}

// Conversation message interface
export interface ConversationMessage {
  id: string;
  cardId: string;
  sectionType: SectionType;
  role: "user" | "assistant";
  content: string;
  mentions: MentionData[];
  toolCalls?: ToolCall[];
  activeToolCall?: { name: string; status: "running" | "completed" };
  createdAt: string;
  isStreaming?: boolean;
}

// Background process tracking
export type ProcessType = "chat" | "autonomous" | "quick-fix" | "evaluate";

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
