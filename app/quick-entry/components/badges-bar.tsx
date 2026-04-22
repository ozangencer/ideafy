import { COLUMNS, Complexity, Priority, Status, AiPlatform } from "@/lib/types";
import { STATUS_COLORS, PLATFORM_LABELS } from "../constants";
import { Project } from "../types";
import { TokenBadge } from "./token-badge";

interface BadgesBarProps {
  selectedProject: Project | null;
  onClearProject: () => void;
  priority: Priority;
  onClearPriority: () => void;
  status: Status;
  statusExplicit: boolean;
  onClearStatus: () => void;
  complexity: Complexity;
  onClearComplexity: () => void;
  aiPlatform: AiPlatform | null;
  onClearPlatform: () => void;
}

export function BadgesBar(props: BadgesBarProps) {
  const {
    selectedProject, onClearProject,
    priority, onClearPriority,
    status, statusExplicit, onClearStatus,
    complexity, onClearComplexity,
    aiPlatform, onClearPlatform,
  } = props;

  const hasBadges =
    !!selectedProject ||
    priority !== "medium" ||
    statusExplicit ||
    complexity !== "medium" ||
    !!aiPlatform;

  if (!hasBadges) return null;

  const statusLabel = COLUMNS.find((c) => c.id === status)?.title;

  return (
    <div className="px-5 pb-3 flex flex-wrap gap-1.5">
      {selectedProject && (
        <TokenBadge
          label={selectedProject.name}
          color={selectedProject.color}
          onRemove={onClearProject}
        />
      )}
      {priority !== "medium" && (
        <TokenBadge
          label={priority === "high" ? "P: High" : "P: Low"}
          color={priority === "high" ? "#f87171" : "#9ca3af"}
          onRemove={onClearPriority}
        />
      )}
      {statusExplicit && (
        <TokenBadge
          label={statusLabel ?? status}
          color={STATUS_COLORS[status]}
          onRemove={onClearStatus}
        />
      )}
      {complexity !== "medium" && (
        <TokenBadge
          label={complexity === "high" ? "C: High" : "C: Low"}
          color={complexity === "high" ? "#f87171" : "#22c55e"}
          onRemove={onClearComplexity}
        />
      )}
      {aiPlatform && (
        <TokenBadge
          label={PLATFORM_LABELS[aiPlatform].label}
          color={PLATFORM_LABELS[aiPlatform].color}
          onRemove={onClearPlatform}
        />
      )}
    </div>
  );
}
