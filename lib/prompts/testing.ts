import type { Voice } from "@/lib/types";
import { DEFAULT_VOICE } from "@/lib/types";
import { stripHtml } from "./utils";
import { detectCardLanguage } from "./test-style";
import { buildVoicePrompt } from "./voice-style";

/**
 * Interactive QA partner prompt: walks the user through manual test scenarios
 * one by one, helps debug failures, and updates/moves the card when done.
 */
export function buildTestTogetherPrompt(
  card: { id: string; title: string; testScenarios: string; description?: string },
  displayId: string | null,
  voice: Voice = DEFAULT_VOICE,
): string {
  const title = stripHtml(card.title);
  const scenarios = stripHtml(card.testScenarios);
  const taskHeader = displayId ? `[${displayId}] ${title}` : title;
  const styleContract = buildVoicePrompt(voice, "tests", {
    language: detectCardLanguage({ title: card.title, description: card.description }),
  });

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
- Record results as you go: passed = [x], failed or skipped = [ ]

## Workflow
For each test scenario:
1. Present the test clearly
2. Guide the user through the steps
3. Ask: "Did this test pass? (yes/no)"
4. If NO → Help debug, suggest fixes, run commands if needed
5. If YES → Move to the next test

## Recording Results

Write results back with \`save_tests\`, not \`update_card\` — \`update_card\`
rejects testScenarios outright, because save_tests is what protects existing
checkbox state.

\`save_tests\` is append-only: send the WHOLE checklist every time — every
existing item, its heading, and its current \`[x]\`/\`[ ]\` state — changing only
the boxes whose result you just learned. Dropping an item makes the call fail.

You can save after each scenario or batch a few together; either is fine, and
neither needs the user's permission. Only check a box for a test you actually
saw pass. A failed test stays \`[ ]\` and gets reported — never quietly checked.

\`\`\`
mcp__ideafy__save_tests({ id: "${card.id}", testScenarios: "<full checklist, updated boxes>" })
\`\`\`

## When All Tests Are Done

### If ALL tests passed:
Ask the user whether to close the card. On a clear yes:
\`\`\`
mcp__ideafy__move_card({ id: "${card.id}", status: "completed" })
\`\`\`

### If SOME tests failed:
1. Make sure the failures are saved as unchecked via \`save_tests\`, and say
   plainly which ones failed and what you observed.
2. Ask the user: "Should we move this back to In Progress for fixes?"
3. If yes:
\`\`\`
mcp__ideafy__move_card({ id: "${card.id}", status: "progress" })
\`\`\`

## Ideafy MCP Tools Available
- mcp__ideafy__get_card - Read card details
- mcp__ideafy__save_tests - Write test scenarios and checkbox state (append-only)
- mcp__ideafy__move_card - Move card between columns

Card ID: ${card.id}

${styleContract}

Let's start testing! I'll read the card first and then walk you through each test scenario.`;
}

/**
 * Unit-test generation prompt for cards in the Human Test column: converts
 * manual test scenarios into executable unit tests matching the project's
 * test framework.
 */
export function buildTestGenerationPrompt(
  card: { id: string; title: string; testScenarios: string; description?: string },
  displayId: string | null,
  selectedScenarios?: string | null,
  voice: Voice = DEFAULT_VOICE,
): string {
  const title = stripHtml(card.title);
  const allScenarios = stripHtml(card.testScenarios);
  const scenariosText = selectedScenarios
    ? `- ${selectedScenarios}`
    : allScenarios;
  const taskHeader = displayId ? `[${displayId}] ${title}` : title;
  const styleContract = buildVoicePrompt(voice, "tests", {
    language: detectCardLanguage({ title: card.title, description: card.description }),
  });

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

${styleContract}

Focus on:
- Testing happy paths and edge cases from scenarios
- Mocking external dependencies
- Following existing test patterns in the codebase`;
}
