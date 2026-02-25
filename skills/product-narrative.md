---
allowed-tools: Read, Write, Bash, Grep, Glob, Edit
argument-hint: [optional project name]
description: Generate a product narrative document for any software project by analyzing its codebase and gathering the creator's vision through an interactive interview.
---

# Product Narrative Generator

Generate a comprehensive product narrative document by analyzing the codebase and interviewing the creator.

Optional argument: $ARGUMENTS (project name override or output path override)

**Output Path Override**: If $ARGUMENTS contains a file path (ends with `.md`), use it as the output path instead of the default `docs/product-narrative.md`. For example: `$ARGUMENTS = "PRODUCT_NARRATIVE.md"` means write to `PRODUCT_NARRATIVE.md` in the project root.

## Instructions

### Step 1: Detect Project Name

If $ARGUMENTS is provided, use it as the project name. Otherwise:
1. Check `package.json` for `name` field
2. Check `CLAUDE.md` for project references
3. Fall back to the current directory name

### Step 2: Determine Output Path

If $ARGUMENTS ends with `.md`, use it as the output path (the **configured narrative path**). Otherwise, use the default `docs/product-narrative.md`.

Then check for an existing narrative file at:
- The configured output path (if overridden)
- `docs/product-narrative.md`
- `product-narrative.md`

If found, read it and tell the user: "I found an existing product narrative. I'll use it as a reference and update it with your new input."

### Step 3: Analyze the Codebase

Before interviewing, gather context:
1. Read `package.json` for dependencies and scripts
2. Read `CLAUDE.md` or `README.md` for project guidelines
3. Scan the project structure (key directories and files)
4. Identify the tech stack from dependencies

### Step 4: Interactive Interview

Ask the user these questions ONE AT A TIME. Wait for each answer before proceeding. Use context from Step 3 to ask informed follow-up questions.

1. **Story Behind This**: "What's the story behind this project? What motivated you to build it?"
2. **Problem**: "What specific problem does this solve? Who was struggling with this and how?"
3. **Target Users**: "Who are the target users? Describe your ideal user persona."
4. **Core Features**: "What are the core features? What makes this different from alternatives?"
5. **Non-Goals**: "What is explicitly OUT of scope? What will this project NOT do?"
6. **Tech Stack**: "I detected [detected stack]. Any specific tech decisions worth noting? Why these choices?"
7. **Success Metrics**: "How do you measure success for this project? What does 'working well' look like?"

Guidelines:
- Keep it conversational, not interrogative
- If the user gives a brief answer, ask a follow-up to dig deeper
- Use codebase context to make questions specific (e.g., "I see you're using SQLite instead of PostgreSQL - what drove that decision?")
- It's OK if the user skips a question - note it as "Not provided"

### Step 5: Generate the Narrative

Using the interview answers and codebase analysis, create a comprehensive product narrative document with these sections:

```markdown
# {Project Name} - Product Narrative

## Vision Statement
[One paragraph synthesizing the story and problem into a clear vision]

## Problem Definition
### The Core Problem
[Expanded from user's answer with professional context]

### Why Existing Solutions Fall Short
[Based on user's differentiation points]

## Target Users
[User personas with details]

## Solution Architecture
### Core Concept
[What the product does and how]

### Core Features
[Feature list with descriptions]

### Non-Goals
[Explicit boundaries]

## Technical Stack
[Tech decisions with rationale]

## Competitive Positioning
[Table comparing with alternatives if applicable]

## Success Metrics
[How success is measured]

## Product-Architect Commentary
### Design Decisions & Rationale
[Key architectural choices and why]

### Scalability Considerations
[Future growth considerations]

---
*Document Version: 1.0*
*Generated: {date}*
*Author: Product-Architect Agent*
```

### Step 6: Save the Document

1. Use the output path determined in Step 2 (either from $ARGUMENTS or default `docs/product-narrative.md`)
2. Create the parent directory if it doesn't exist
3. Write the narrative to the determined output path
4. Tell the user the file path

## Important Notes

- Write in the same language the user uses during the interview
- Expand brief answers into professional, detailed sections
- Include ASCII diagrams where they add clarity
- Use tables for comparisons
- Keep the tone professional but accessible
- If an existing narrative exists, preserve its structure and enhance it with new information
