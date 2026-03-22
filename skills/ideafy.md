---
allowed-tools: mcp__ideafy__get_card, mcp__ideafy__update_card, mcp__ideafy__move_card, mcp__ideafy__list_cards, mcp__ideafy__create_card, mcp__ideafy__save_plan, mcp__ideafy__save_tests, mcp__ideafy__save_opinion, mcp__ideafy__get_project_by_folder
argument-hint: [action or query]
description: Manage ideafy cards - list, create, update, move cards and save plans/tests
---

# Ideafy - Card Management

Manage your kanban board directly from Claude Code. List, create, update, and move cards across columns.

Argument: $ARGUMENTS

## Instructions

### Step 1: Project Detection

Use `mcp__ideafy__get_project_by_folder` with the current working directory.

If `found: false`:
- STOP immediately
- Tell the user the message from the response
- Do NOT proceed further

If `found: true`, extract `project.id` and `project.idPrefix` for use in subsequent steps.

### Step 2: Understand the Request

Parse `$ARGUMENTS` to determine the intended action. If no argument is provided, default to listing cards in the current project.

Supported actions:

#### List Cards
Keywords: list, listele, kartlar, cards, board, show
- Use `mcp__ideafy__list_cards` with `projectId` from Step 1
- Optional: filter by `status` if the user specifies a column (e.g., "list backlog", "progress'tekiler")
- Display as a compact table with: ID, Title, Status, Priority, Complexity

#### Card Details
Keywords: show, detail, detay, gor, KAN-XX, #XX
- If user provides a display ID (e.g., KAN-42) or task number (e.g., #42), use `mcp__ideafy__get_card` with `displayId` or `taskNumber`
- If user provides a UUID, use `mcp__ideafy__get_card` with `id`
- Show all card fields in a readable format

#### Create Card
Keywords: create, olustur, yeni, new, ekle, add
- Use `mcp__ideafy__create_card`
- Required: `title` (from arguments)
- Optional: `description`, `complexity` (simple/medium/complex), `priority` (low/medium/high), `status` (defaults to "ideation")
- Always set `projectId` from Step 1
- Parse complexity and priority from natural language (e.g., "high priority complex task" -> priority: high, complexity: complex)

#### Update Card
Keywords: update, guncelle, duzenle, edit
- Use `mcp__ideafy__update_card`
- Identify the card by display ID, task number, or UUID
- Update only the fields mentioned by the user

#### Move Card
Keywords: move, tasi, tasima
- Use `mcp__ideafy__move_card`
- Valid statuses: ideation, backlog, bugs, progress, test, completed
- Accept natural language column names:
  - "ideation" / "fikir"
  - "backlog"
  - "bugs" / "bug"
  - "progress" / "in progress" / "devam"
  - "test" / "human test"
  - "completed" / "done" / "tamamlandi"

#### Save Plan
Keywords: plan, solution, cozum
- Use `mcp__ideafy__save_plan`
- Requires card ID and solution summary
- Moves card to In Progress

#### Save Tests
Keywords: test, senaryo, scenario
- Use `mcp__ideafy__save_tests`
- Requires card ID and test scenarios (in markdown checkbox format)
- Moves card to Human Test

#### Save Opinion
Keywords: opinion, fikir, degerlendirme, evaluate
- Use `mcp__ideafy__save_opinion`
- Requires card ID and AI opinion text

### Step 3: Execute and Report

After executing the action:
- Confirm what was done
- Show the relevant card info (display ID, title, new status if changed)
- Use the project's ID prefix for display IDs (e.g., KAN-42)

## Important Notes

- Always detect the project first before any operation
- Use the language the user is writing in (Turkish or English)
- Keep responses concise and actionable
- When listing cards, use a compact format - don't overwhelm with details
- For ambiguous requests, ask for clarification
