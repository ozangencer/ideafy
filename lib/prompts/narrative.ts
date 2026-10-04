export interface NarrativeData {
  storyBehindThis: string;
  problem: string;
  targetUsers: string;
  coreFeatures: string;
  nonGoals: string;
  techStack: string;
  successMetrics: string;
}

/**
 * Product narrative generation prompt: expands the user's bullet-point
 * answers into a full professional narrative document.
 */
export function buildNarrativePrompt(projectName: string, data: NarrativeData): string {
  return `You are a Product Architect creating a professional product narrative document.

## Project: ${projectName}

## User's Input (expand and professionalize these):

**Story Behind This:**
${data.storyBehindThis || "Not provided"}

**Problem:**
${data.problem || "Not provided"}

**Target Users:**
${data.targetUsers || "Not provided"}

**Core Features:**
${data.coreFeatures || "Not provided"}

**Non-Goals (Out of Scope):**
${data.nonGoals || "Not provided"}

**Tech Stack:**
${data.techStack || "Not provided"}

**Success Metrics:**
${data.successMetrics || "Not provided"}

## Your Task

Create a comprehensive, professional product narrative document in markdown format.

Requirements:
1. Expand the user's brief inputs into detailed, well-structured sections
2. Add professional context and depth to each section
3. Include a Vision Statement at the beginning
4. Add Problem Definition with sub-sections if relevant
5. Describe the Solution Architecture conceptually
6. Include Competitive Positioning if applicable
7. Add a Product-Architect Commentary section with design decisions
8. Keep the tone professional but accessible
9. Use tables, diagrams (ASCII), and structured lists where appropriate
10. End with document metadata (version, date)

Output ONLY the markdown content, no explanations.`;
}

/** Generate fallback narrative content when AI is unavailable. */
export function generateFallbackContent(projectName: string, data: NarrativeData): string {
  const now = new Date().toISOString().split("T")[0];

  return `# Product Narrative: ${projectName}

## Story Behind This
${data.storyBehindThis || "_Not provided_"}

## Problem
${data.problem || "_Not provided_"}

## Target Users
${data.targetUsers || "_Not provided_"}

## Core Features
${data.coreFeatures || "_Not provided_"}

## Non-Goals (Out of Scope)
${data.nonGoals || "_Not provided_"}

## Tech Stack
${data.techStack || "_Not provided_"}

## Success Metrics
${data.successMetrics || "_Not provided_"}

---
Generated: ${now}
`;
}

/**
 * The Work counterpart of NarrativeData. A Work project is a client
 * engagement, an area or a commitment, not a product, so the questions are
 * facts about the engagement. Tone and audience are deliberately not asked:
 * IDE-335 left those to the Work voice and the output templates.
 */
export interface WorkBriefData {
  context: string;
  stakeholders: string;
  outputs: string;
  outOfScope: string;
  references: string;
  doneAndRhythm: string;
}

/**
 * Project brief generation prompt for Work projects. Same job as
 * buildNarrativePrompt, but the document is a brief: no vision, architecture or
 * competitive sections that make no sense for a proposal or a rollout.
 */
export function buildWorkBriefPrompt(projectName: string, data: WorkBriefData): string {
  return `You are writing a project brief: the reference document an AI reads before working on any task in this project.

## Project: ${projectName}

## User's Input (expand and structure these):

**Context:**
${data.context || "Not provided"}

**Stakeholders:**
${data.stakeholders || "Not provided"}

**Outputs:**
${data.outputs || "Not provided"}

**Out of scope:**
${data.outOfScope || "Not provided"}

**References:**
${data.references || "Not provided"}

**Done & rhythm:**
${data.doneAndRhythm || "Not provided"}

## Your Task

Write a concise project brief in markdown with these sections, in this order:

1. Context: what the project is, for whom, and the commitment behind it
2. Stakeholders: who is involved, their role, and what each expects
3. Outputs: the kinds of documents and deliverables produced here, and who reads them
4. Out of scope: what this project does not cover
5. References: where the reference material lives, as paths relative to the project folder when given
6. Working rhythm: what done looks like, deadlines and recurring meetings or reports

Requirements:
- Stay with the facts the user gave. Do not invent names, dates or numbers.
- When an input is "Not provided", keep the section and write a one-line placeholder saying it is still open.
- Write in the language the user answered in.
- Use short paragraphs, lists and tables where they help.
- End with document metadata (date).

Output ONLY the markdown content, no explanations.`;
}

/** Generate fallback brief content when AI is unavailable. */
export function generateWorkBriefFallback(projectName: string, data: WorkBriefData): string {
  const now = new Date().toISOString().split("T")[0];

  return `# Project Brief: ${projectName}

## Context
${data.context || "_Not provided_"}

## Stakeholders
${data.stakeholders || "_Not provided_"}

## Outputs
${data.outputs || "_Not provided_"}

## Out of scope
${data.outOfScope || "_Not provided_"}

## References
${data.references || "_Not provided_"}

## Working rhythm
${data.doneAndRhythm || "_Not provided_"}

---
Generated: ${now}
`;
}
