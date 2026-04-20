/**
 * Centralized prompt builders for Claude Code integration
 * All prompts used in API routes are defined here for easy maintenance
 */

import { writeFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

// ============================================================================
// Types
// ============================================================================

export type Phase = "planning" | "implementation" | "retest";

export interface CardForPrompt {
  id: string;
  title: string;
  description: string;
  solutionSummary?: string | null;
  testScenarios?: string | null;
}

export interface NarrativeData {
  storyBehindThis: string;
  problem: string;
  targetUsers: string;
  coreFeatures: string;
  nonGoals: string;
  techStack: string;
  successMetrics: string;
}

// ============================================================================
// Utility Functions
// ============================================================================

/**
 * Strip HTML tags from a string
 */
export function stripHtml(html: string): string {
  if (!html) return "";
  return html.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
}

/**
 * Convert marked checkbox output to TipTap TaskList format
 * marked outputs: <li><input disabled="" type="checkbox"> text</li>
 * TipTap expects: <ul data-type="taskList"><li data-type="taskItem" data-checked="false">text</li></ul>
 */
export function convertToTipTapTaskList(html: string): string {
  // First, convert checked items (must come before unchecked to avoid false positives)
  let result = html
    // Checked: <li><input checked="" ...> → <li data-type="taskItem" data-checked="true">
    .replace(/<li><input[^>]*checked[^>]*>\s*/gi, '<li data-type="taskItem" data-checked="true">')
    // Unchecked: <li><input ...> (no checked) → <li data-type="taskItem" data-checked="false">
    .replace(/<li><input[^>]*type="checkbox"[^>]*>\s*/gi, '<li data-type="taskItem" data-checked="false">');

  // Convert <ul> containing taskItems to taskList
  result = result.replace(/<ul>(\s*<li data-type="taskItem")/g, '<ul data-type="taskList">$1');

  return result;
}

/**
 * Escape shell arguments for safe command execution
 */
export function escapeShellArg(arg: string): string {
  return `'${arg.replace(/'/g, "'\\''")}'`;
}

// ============================================================================
// Image Extraction for CLI Context
// ============================================================================

export interface SavedImage {
  id: string;
  path: string;
  fieldName: string;
}

/**
 * Save embedded base64 images from card HTML fields to temp files.
 * Returns array of saved image metadata for reference in prompts.
 */
export function saveCardImagesToTemp(
  cardId: string,
  card: { description: string; solutionSummary?: string | null; testScenarios?: string | null }
): SavedImage[] {
  const savedImages: SavedImage[] = [];
  const timestamp = Date.now();

  const imgRegex = /<img[^>]*src=["']data:(image\/[^;]+);base64,([^"']+)["'][^>]*>/gi;

  const fields = [
    { name: 'description', value: card.description },
    { name: 'solutionSummary', value: card.solutionSummary },
    { name: 'testScenarios', value: card.testScenarios },
  ];

  for (const field of fields) {
    if (!field.value) continue;

    let match;
    let index = 0;
    while ((match = imgRegex.exec(field.value)) !== null) {
      const mimeType = match[1];
      const base64Data = match[2];
      const ext = mimeType.split('/')[1] || 'png';

      const filename = `kanban-${cardId.slice(0, 8)}-${field.name}-${index}-${timestamp}.${ext}`;
      const filepath = join(tmpdir(), filename);

      const buffer = Buffer.from(base64Data, 'base64');
      writeFileSync(filepath, buffer);

      savedImages.push({ id: `${field.name}_image_${index}`, path: filepath, fieldName: field.name });
      index++;
    }
    imgRegex.lastIndex = 0; // Reset regex state between fields
  }

  return savedImages;
}

/**
 * Extract base64 images from a conversation message content string,
 * save them to temp files, and return the content with images replaced
 * by file path references. Reduces token usage when chat history
 * is included in prompts.
 */
export function extractConversationImages(
  content: string,
  cardId: string,
  messageIndex: number
): { cleanContent: string; savedImages: SavedImage[] } {
  const savedImages: SavedImage[] = [];
  const timestamp = Date.now();
  const imgRegex = /<img[^>]*src=["']data:(image\/[^;]+);base64,([^"']+)["'][^>]*>/gi;

  let index = 0;
  const cleanContent = content.replace(imgRegex, (_match, mimeType: string, base64Data: string) => {
    const ext = mimeType.split('/')[1] || 'png';
    const filename = `kanban-${cardId.slice(0, 8)}-chat-${messageIndex}-${index}-${timestamp}.${ext}`;
    const filepath = join(tmpdir(), filename);

    const buffer = Buffer.from(base64Data, 'base64');
    writeFileSync(filepath, buffer);

    const imgId = `chat_image_${messageIndex}_${index}`;
    savedImages.push({ id: imgId, path: filepath, fieldName: 'conversation' });
    index++;

    return `[Image: see ${filepath}]`;
  });

  return { cleanContent, savedImages };
}

/**
 * Generate markdown reference section for saved images.
 * Tells Claude to use the Read tool to view them.
 */
export function generateImageReferences(images: SavedImage[]): string {
  if (images.length === 0) return '';

  return [
    '## Attached Images',
    '',
    ...images.map(img => `- **${img.id}** (${img.fieldName}): Read file at \`${img.path}\``),
    '',
    'Use the Read tool to view these images for visual context.',
    ''
  ].join('\n');
}

// ============================================================================
// Evaluate Prompt (Ideation cards)
// ============================================================================

export function buildEvaluatePrompt(
  card: { title: string; description: string },
  narrativePath?: string | null
): string {
  const title = stripHtml(card.title);
  const description = stripHtml(card.description);

  // Use custom narrative path if provided, otherwise default to docs/product-narrative.md
  const narrativeRef = narrativePath
    ? `@${narrativePath}`
    : "@docs/product-narrative.md";

  return `You are a Product Architect evaluating this idea. Be BRUTALLY HONEST.

## Context Files
Read these files for context:
- ${narrativeRef} (project vision & scope) - if it exists
- @CLAUDE.md (technical guidelines) - if it exists

## Idea to Evaluate
**Title:** ${title}

**Description:**
${description}

## Your Evaluation Task
Evaluate this idea from these perspectives:

1. **YAGNI (You Ain't Gonna Need It)**: Is this feature truly needed? Will it provide value?
2. **Scope Creep Risk**: Does this expand the project scope unnecessarily?
3. **Scalability**: Will this scale with the product growth?
4. **Technical Feasibility**: Is this technically achievable with reasonable effort?
5. **Alignment with Vision**: Does this fit the product's core mission?
6. **Implementation Complexity**: How hard is this to build?

## Output Format
You MUST provide your evaluation as markdown with EXACTLY these sections:

## Summary Verdict
[One sentence: Strong Yes / Yes / Maybe / No / Strong No]

## Strengths
- Point 1
- Point 2
(List the key strengths of this idea)

## Concerns
- Point 1
- Point 2
(List the main concerns, risks, or issues)

## Recommendations
- What should be considered before implementing
- Any suggested modifications to the idea

## Priority
[PRIORITY: low/medium/high] - Your reasoning for this priority level
(Based on urgency, impact, and alignment with project goals. Be honest - not everything is high priority!)

## Complexity
[COMPLEXITY: trivial/low/medium/high/very_high] - Your assessment
(trivial = few lines, low = simple change, medium = moderate effort, high = significant work, very_high = major undertaking)

## Final Score
[X/10] - Brief justification for the score

---
Be direct. Don't sugarcoat. Point out both good and bad aspects.`;
}

// ============================================================================
// Quick Fix Prompt (Bug cards)
// ============================================================================

export function buildQuickFixPrompt(card: { title: string; description: string }): string {
  const title = stripHtml(card.title);
  const description = stripHtml(card.description);

  return `You are a senior developer. Fix this bug quickly and efficiently.

## Bug Report
${title}

## Description
${description}

## Instructions
1. Analyze the bug description
2. Find the root cause in the codebase
3. Implement the fix
4. Verify the fix works

## Output Requirements
After fixing the bug, provide a brief summary in this format:

## Quick Fix Summary
- **Root Cause:** Brief description of what caused the bug
- **Fix Applied:** What was changed to fix it
- **Files Modified:** List of files that were changed

## Test Scenarios
- [ ] Bug no longer reproduces
- [ ] Related functionality still works
- [ ] No regression in existing tests

Focus on fixing the bug efficiently. Do NOT write extensive documentation or plans.`;
}

// ============================================================================
// Start/Phase Prompt (Backlog -> In Progress -> Test)
// ============================================================================

/**
 * Detect which phase the card is in based on existing content
 */
export function detectPhase(card: { solutionSummary: string | null; testScenarios: string | null }): Phase {
  const hasSolution = card.solutionSummary && stripHtml(card.solutionSummary) !== "";
  const hasTests = card.testScenarios && stripHtml(card.testScenarios) !== "";

  if (!hasSolution) return "planning";
  if (!hasTests) return "implementation";
  return "retest";
}

export function buildPhasePrompt(
  phase: Phase,
  card: CardForPrompt
): string {
  const title = stripHtml(card.title);

  switch (phase) {
    case "planning":
      return `Ideafy: ${card.id}

Read card via MCP (mcp__ideafy__get_card). Review title, description, and any existing notes.

Task: Create implementation plan for "${title}".

Plan format:
- Files to Modify
- Implementation Steps
- Edge Cases
- Dependencies

Must include at the end:
[COMPLEXITY: trivial/low/medium/high/very_high]
[PRIORITY: low/medium/high]

IMPORTANT: Do NOT implement yet - plan only.
IMPORTANT: Do NOT call save_plan, save_tests, save_opinion, or any MCP tools to save results. Do NOT ask whether to save. Output the complete plan directly as your response text. Your output will be automatically saved to the card.`;

    case "implementation":
      return `Ideafy: ${card.id}

Read card via MCP (mcp__ideafy__get_card). Follow the approved plan in solutionSummary.

Task: Implement "${title}".

After implementing the code, your FINAL response must be ONLY manual test scenarios in this EXACT format:

## Test Scenarios

### Happy Path
- [ ] Description of what to test manually and expected result
- [ ] Another test case

### Edge Cases
- [ ] Edge case to verify

### Regression
- [ ] Existing feature that should still work

Rules:
- Every line must be a markdown checkbox (- [ ])
- Write actionable manual test steps, NOT a summary of code changes
- Do NOT include code summaries, file lists, or implementation details in your output
- Your response text will be automatically saved as test scenarios

IMPORTANT: Do NOT call save_plan, save_tests, save_opinion, or any MCP tools to save results.`;

    case "retest":
      return `Ideafy: ${card.id}

Read card via MCP (mcp__ideafy__get_card). Review previous implementation and test scenarios.

Task: "${title}" failed during testing.

User will describe the error - wait and fix.
IMPORTANT: Do NOT call save_plan, save_tests, save_opinion, or any MCP tools to save results. Do NOT ask whether to save. Output your response directly as text. Your output will be automatically saved to the card.`;
  }
}

// ============================================================================
// Ideation Prompt (Interactive brainstorming)
// ============================================================================

export function buildIdeationPrompt(card: { id: string; title: string; description: string }): string {
  const title = stripHtml(card.title);
  const description = stripHtml(card.description);

  return `You are a Product Strategist. Let's brainstorm and refine this idea together.

## Idea to Discuss
**Title:** ${title}

**Description:**
${description}

## Your Role
1. Ask clarifying questions to understand the idea better
2. Challenge assumptions - consider YAGNI, scope creep risks
3. Explore alternatives and improvements
4. Help refine the concept into something actionable
5. Consider technical feasibility and implementation complexity

## Discussion Guidelines
- Be curious and ask probing questions
- Point out potential issues constructively
- Suggest improvements or alternatives
- Help prioritize if the idea is too broad
- Be honest but collaborative

## Ideafy MCP Tools Available
- mcp__ideafy__save_opinion - Save your final thoughts to the card
- mcp__ideafy__update_card - Update card fields (including priority)
- mcp__ideafy__get_card - Get card details

Card ID: ${card.id}

## CRITICAL: When Discussion Ends
Before finishing, you MUST do THREE things:

### 1. Update Priority
Based on our discussion, update the card priority:
\`\`\`
mcp__ideafy__update_card({ id: "${card.id}", priority: "low" | "medium" | "high" })
\`\`\`
Be BRUTALLY HONEST - not everything is high priority!

### 2. Update Complexity
Based on the scope of the idea, update the card complexity:
\`\`\`
mcp__ideafy__update_card({ id: "${card.id}", complexity: "trivial" | "low" | "medium" | "high" | "very_high" })
\`\`\`
(trivial = few lines, low = simple change, medium = moderate effort, high = significant work, very_high = major undertaking)

### 3. Save Your Opinion
Your opinion MUST include EXACTLY these sections:
\`\`\`
mcp__ideafy__save_opinion({ id: "${card.id}", aiOpinion: "## Summary Verdict\\n[Strong Yes / Yes / Maybe / No / Strong No]\\n\\n## Strengths\\n- Point 1\\n- Point 2\\n\\n## Concerns\\n- Point 1\\n- Point 2\\n\\n## Recommendations\\n- Recommendation 1\\n- Recommendation 2\\n\\n## Priority\\n[PRIORITY: low/medium/high] - Your reasoning\\n\\n## Final Score\\n[X/10] - Brief justification" })
\`\`\`

Do NOT end the session without updating priority, complexity, and saving your opinion.

Let's start! What would you like to explore about this idea?`;
}

// ============================================================================
// Test Together Prompt (Interactive testing session)
// ============================================================================

export function buildTestTogetherPrompt(
  card: { id: string; title: string; testScenarios: string },
  displayId: string | null
): string {
  const title = stripHtml(card.title);
  const scenarios = stripHtml(card.testScenarios);
  const taskHeader = displayId ? `[${displayId}] ${title}` : title;

  return `You are a QA Partner. Let's test "${taskHeader}" together step by step.

## Instructions
1. First, read the card details using: mcp__ideafy__get_card with id: "${card.id}"
2. Review the testScenarios field - it contains manual test checkboxes

## Test Scenarios Overview
${scenarios}

## Your Role
- Go through each test scenario ONE BY ONE
- For each test, explain what to do and what to expect
- Ask the user to perform the test and report the result
- If a test fails, help debug the issue right there
- Mark tests as you go (checked = passed, unchecked = failed/skipped)

## Workflow
For each test scenario:
1. Present the test clearly
2. Guide the user through the steps
3. Ask: "Did this test pass? (yes/no)"
4. If NO → Help debug, suggest fixes, run commands if needed
5. If YES → Move to the next test

## When All Tests Are Done

### If ALL tests passed:
1. Update test scenarios with all checkboxes checked:
\`\`\`
mcp__ideafy__update_card({ id: "${card.id}", testScenarios: "<updated with all checked>" })
\`\`\`
2. Move card to Completed:
\`\`\`
mcp__ideafy__move_card({ id: "${card.id}", status: "completed" })
\`\`\`

### If SOME tests failed:
1. Update test scenarios marking which passed and which failed:
\`\`\`
mcp__ideafy__update_card({ id: "${card.id}", testScenarios: "<updated with pass/fail status>" })
\`\`\`
2. Ask the user: "Should we move this back to In Progress for fixes?"
3. If yes:
\`\`\`
mcp__ideafy__move_card({ id: "${card.id}", status: "progress" })
\`\`\`

## Ideafy MCP Tools Available
- mcp__ideafy__get_card - Read card details
- mcp__ideafy__update_card - Update card fields
- mcp__ideafy__move_card - Move card between columns

Card ID: ${card.id}

Let's start testing! I'll read the card first and then walk you through each test scenario.`;
}

// ============================================================================
// Conflict Resolution Prompt
// ============================================================================

export function buildConflictPrompt(
  displayId: string,
  branchName: string,
  conflictFiles: string[]
): string {
  const filesStr = conflictFiles.join(", ");

  return `Rebase conflict resolution for ${displayId}. Branch: ${branchName}. Conflicting files: ${filesStr}. Help me resolve the git rebase conflict. Open the conflicting files, find the conflict markers, resolve them, then run git add and git rebase --continue.`;
}

// ============================================================================
// Narrative Prompt (Product narrative generation)
// ============================================================================

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

/**
 * Generate fallback narrative content when AI is unavailable
 */
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

// ============================================================================
// Test Generation Prompt (Human Test cards)
// ============================================================================

export function buildTestGenerationPrompt(
  card: { id: string; title: string; testScenarios: string },
  displayId: string | null,
  selectedScenarios?: string | null
): string {
  const title = stripHtml(card.title);
  const allScenarios = stripHtml(card.testScenarios);
  const scenariosText = selectedScenarios
    ? `- ${selectedScenarios}`
    : allScenarios;
  const taskHeader = displayId ? `[${displayId}] ${title}` : title;

  return `# ${taskHeader}

## Instructions
1. First, read the card details using: mcp__ideafy__get_card with id: "${card.id}"
2. Review the testScenarios field containing manual test cases
3. Detect the test framework from package.json (Jest, Vitest, or other)
4. Convert the manual test scenarios into unit test code
5. Create test files following project conventions

## Test Scenarios to Convert
${scenariosText}

## Output Format
After generating tests AND verifying they pass (run the test command and confirm 0 failures), update the testScenarios field with:

\`\`\`markdown
## Test Scenarios
[Keep the original manual scenarios as checkboxes. For every scenario now covered by a passing unit test, mark it as checked: \`- [x] ...\`. Scenarios that still require manual verification stay \`- [ ] ...\`.]

## Unit Test Files
| File | Description |
|------|-------------|
| \`path/to/test.test.ts\` | Unit tests for X |

**Running Tests:** \`npm test -- path/to/tests\`
\`\`\`

Use mcp__ideafy__save_tests to update the card with the new format.

**Checkbox rule (mandatory):** If a manual scenario is now covered by a passing unit test, its checkbox MUST be \`[x]\` in the markdown you send to save_tests. Do not wait for the user to tell you to tick passing scenarios — ticking them is part of the job. Only leave \`[ ]\` for scenarios that genuinely still need human verification (UI, regressions, integration-level checks).

Focus on:
- Testing happy paths and edge cases from scenarios
- Mocking external dependencies
- Following existing test patterns in the codebase`;
}
