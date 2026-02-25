---
allowed-tools: Read, Bash, Grep, Glob, mcp__kanban__create_card, mcp__kanban__save_tests, mcp__kanban__get_project_by_folder
argument-hint: [optional title]
description: Create a kanban card from current conversation context and move to Human Test
---

# Human Test Card Creator

Create a kanban card from the current conversation and move it to Human Test.

Optional argument: $ARGUMENTS (card title override)

## Instructions

### Step 1: Project Detection

Use `mcp__kanban__get_project_by_folder` with the current working directory to check if this project exists in kanban.

If the response has `found: false`:
- STOP immediately
- Tell the user the message from the response
- Do NOT proceed further

If `found: true`, extract the `project.id` and continue.

### Step 2: Context Analysis

Analyze the current conversation to extract:

1. **Title**: What was the main task/fix? Use $ARGUMENTS if provided, otherwise infer from conversation.

2. **Description (Details)**:
   - What was the problem?
   - What was the root cause?
   - Include relevant file paths and code references

3. **Solution Summary**:
   - What was changed?
   - Which files were modified?
   - Include code snippets showing before/after if applicable

4. **Test Scenarios**: MUST use this exact format:
   ```markdown
   ## Test Senaryolari

   ### [Feature/Area Name 1]
   - [ ] Test case 1
   - [ ] Test case 2

   ### [Feature/Area Name 2]
   - [ ] Test case 3
   - [ ] Test case 4
   ```

   Rules:
   - Group tests under descriptive H3 headings (###)
   - Each test item MUST start with `- [ ]` (checkbox format)
   - Include happy path, edge cases, and regression tests
   - NEVER use bullet points (-) without checkbox ([ ])

5. **Complexity**: Assess based on:
   - simple: Single file, straightforward fix
   - medium: Multiple files, moderate logic
   - complex: Architectural changes, many files

6. **Priority**: Assess based on:
   - low: Nice to have
   - medium: Should be done
   - high: Blocking or critical

### Step 3: Create Card

Use `mcp__kanban__create_card` with:
- title: Extracted title
- description: Detailed problem description in markdown
- solutionSummary: Solution details in markdown
- status: "progress" (will be moved to test after adding test scenarios)
- complexity: Assessed complexity
- priority: Assessed priority
- projectId: ID from Step 1

### Step 4: Add Tests and Move to Human Test

Use `mcp__kanban__save_tests` with:
- id: Card ID from Step 3
- testScenarios: Test scenarios in markdown with checkboxes

### Step 5: Confirm

Report to user:
- Card display ID (e.g., KAN-64)
- Title
- Link hint: "Kanban'da Human Test kolonunda gorebilirsin"

## Important Notes

- Always write description, solution, and tests in the language the conversation was conducted in
- Be thorough with test scenarios - think like a QA engineer
- Include both functional and edge case tests
- Reference specific file paths and line numbers where relevant
