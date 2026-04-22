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
