import type { AiPlatform, Card, Complexity, Priority, Status } from "./types";

/** The card fields the modal form edits. */
export interface CardFormValues {
  title: string;
  description: string;
  solutionSummary: string;
  testScenarios: string;
  aiOpinion: string;
  status: Status;
  complexity: Complexity;
  priority: Priority;
  projectId: string | null;
  groupId: string | null;
  aiPlatform: AiPlatform | null;
}

/**
 * The form fields that differ from the card, compared by the same rules as
 * the modal's hasUnsavedChanges. The auto-save sends only these: a form left
 * behind by a run it never saw (IDE-366) would otherwise write back the
 * status, plan and description it opened with, over what the run wrote.
 * `projectFolder` rides along only when the project itself changed, and so
 * does `groupId`: the card the form compares against can still hold the
 * group from before an auto-save landed, so a group cleared by the project
 * change would look untouched and the server would refuse the move.
 */
export function buildDirtyCardPayload(
  form: CardFormValues,
  card: Card,
  projectFolderFor: (projectId: string | null) => string | null | undefined
): Partial<Card> {
  const payload: Partial<Card> = {};

  if (form.title !== card.title) payload.title = form.title;
  if (form.description !== card.description) payload.description = form.description;
  if (form.solutionSummary !== card.solutionSummary) payload.solutionSummary = form.solutionSummary;
  if (form.testScenarios !== card.testScenarios) payload.testScenarios = form.testScenarios;
  if (form.aiOpinion !== card.aiOpinion) payload.aiOpinion = form.aiOpinion;
  if (form.status !== card.status) payload.status = form.status;
  if (form.complexity !== (card.complexity || "medium")) payload.complexity = form.complexity;
  if (form.priority !== (card.priority || "medium")) payload.priority = form.priority;
  if (form.groupId !== (card.groupId ?? null)) payload.groupId = form.groupId;
  if (form.aiPlatform !== (card.aiPlatform ?? null)) payload.aiPlatform = form.aiPlatform;
  if (form.projectId !== card.projectId) {
    payload.projectId = form.projectId;
    payload.projectFolder = projectFolderFor(form.projectId) || card.projectFolder;
    payload.groupId = form.groupId;
  }

  return payload;
}
