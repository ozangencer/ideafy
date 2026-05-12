# Ideafy

> `// the evolution of an idea, made physical · a kanban for thinking, not just tracking`

## Ideas don't arrive finished.

Ideafy gives them somewhere to evolve — a column for every stage of the thinking, not just the doing. It reads your project, argues with weak ideas, plans the strong ones in plain language, and keeps the receipts when an idea doesn't make it.

This repository is the **Solo edition**: a local-first SQLite kanban that wires cards to Claude Code, Gemini CLI, Codex CLI, or OpenCode through the Model Context Protocol. One file on your disk. No accounts. Zero cloud dependencies.

**Jump to:** [Install](#install) · [First run](#first-run) · [MCP integration](#mcp-integration) · [From source](#running-from-source)

## Why a kanban, and why this one

The most romantic story about building software is that you have an idea, sit down, and ship it. Nobody works that way. Ideas arrive soft, partial, and half-wrong. They have to be pressure-tested, cut down, argued with, and rebuilt — often several times — before they become anything you can point at and call a product.

Ideafy's bet is that the evolution of an idea is the thing worth tracking. The six-column board is a chain of thought made physical: a rough thought becomes an opinion, an opinion becomes a plan, a plan becomes an implementation, an implementation becomes a verified change. Each column is a different kind of thinking, and a card only moves right when its owner has done enough new thinking to deserve the next column.

## From a thought to a merged diff

1. **Capture.** Quick entry drops an idea straight into a card — title, description, priority, complexity. Pure capture, no AI interruption.
2. **Evaluate.** Run the agent on an Ideation card. It reads your project narrative, weighs the idea against goals and non-goals, and writes a verdict into the Opinion tab. You decide whether it's worth doing.
3. **Plan.** Chat with the agent in the Solution tab, or **Open in Terminal** to drop into the underlying CLI's plan mode. Type `@` for docs, `[[` for cross-referenced cards, `/` for skills and MCP tools — each is pulled into context. When the agent calls `save_plan`, the card moves to **In Progress** and an isolated git worktree is created for the work.
4. **Build.** Run autonomous mode, or open an interactive terminal. The agent implements the plan inside its worktree, on its own port, while you keep working on main.
5. **Test.** When the agent calls `save_tests`, the card lands in **Human Test** with a checkbox list of acceptance criteria. Tick them by hand. If something's wrong, ask the chat panel to fix, commit, and push without opening an IDE.
6. **Ship.** Merge the branch from the card modal. Ideafy rebases onto main, surfaces conflicts with a file list (or asks the agent to resolve them), and cleans up the worktree.

Nothing happens behind your back. Every stage produces a file you can read, edit, or throw away.

## The board

| Column | What lives here |
|---|---|
| **Ideation** | Rough thoughts. No scope yet, no plan, no obligation. |
| **Backlog** | Scoped and opinion-formed. A real candidate. |
| **Bugs** | A different evolution — from "something's wrong" to "it's fixed." |
| **In Progress** | A plan exists. Implementation is underway inside a worktree. |
| **Human Test** | Implementation done. Acceptance criteria waiting for a human tick. |
| **Completed** | Shipped. Merged. Frozen. |

Plus **Withdrawn**: a refused card is not deleted, it's filed. The chain of thought terminated honestly, and three months later when the same idea walks in dressed differently, you'll have the receipts.

## A card is not a ticket

A card is a stable surface where four kinds of thinking sit side by side. Collapsing them into a single description field collapses the thought.

| Tab | Question | Kind of thinking |
|---|---|---|
| **Detail** | What is this? | Description, constraints, context. The idea as given. |
| **Opinion** | Is it worth doing? | Evaluation against goals, non-goals, risks. The verdict. |
| **Solution** | How will we do it? | Plan, sequence, files touched, trade-offs. |
| **Tests** | How do we know it's done? | Acceptance criteria, written before the finish. |

The separation is what keeps each lens honest, and what makes a card legible to a second reader — whether that's a teammate tomorrow or the agent right now.

## Install

Ideafy Solo ships as a macOS desktop app, signed and notarized with an Apple Developer ID. Drag the DMG into **Applications**, launch it, and you're done. No account, no signup, no cloud.

[**↓ Apple Silicon (M1 / M2 / M3 / M4)**](https://github.com/ozangencer/ideafy/releases/latest/download/Ideafy.Personal.-0.1.4-arm64.dmg) — `Ideafy.Personal.-0.1.4-arm64.dmg`
[**↓ Intel**](https://github.com/ozangencer/ideafy/releases/latest/download/Ideafy.Personal.-0.1.4.dmg) — `Ideafy.Personal.-0.1.4.dmg`

All releases live on the [releases page](https://github.com/ozangencer/ideafy/releases).

### Prerequisites

Ideafy is a front-end for your coding agent. Before you launch the app, make sure the following are installed and reachable from your shell's `PATH`:

1. **Git** — required for worktree-based isolated builds. Install from [git-scm.com](https://git-scm.com/downloads) (or `brew install git`).
2. **Node.js (which includes `npm`)** — required to install the Ideafy plugin and its MCP server. Install from [nodejs.org](https://nodejs.org/) (LTS is fine, or `brew install node`).
3. **At least one supported coding CLI**, installed and **logged in once from your terminal** before opening Ideafy:
   - **[Claude Code](https://docs.anthropic.com/en/docs/claude-code)** — the reference platform. After install, run `claude` once and complete the sign-in prompt.
   - **[Gemini CLI](https://github.com/google-gemini/gemini-cli)** — run `gemini` once to authenticate.
   - **[Codex CLI](https://github.com/openai/codex)** — run `codex` once and sign in.
   - **[OpenCode](https://opencode.ai)** — run `opencode auth login` once.
4. **macOS** — Ideafy Solo is currently distributed as a signed/notarized macOS DMG.

Only one CLI is required; switching providers is a settings change, not a reinstall.

> **Tip — Why the one-time login matters.** The first authentication writes credentials to your home directory (e.g. `~/.claude`, `~/.config/gemini`). Ideafy then spawns the CLI on your behalf as a non-interactive child process, which cannot prompt you for a password. If you skip the login step, evaluating cards or sending chat messages will fail. Doing it once in the terminal solves this for every project.

When the app launches a CLI it prepends the following directories to its `PATH`, so installs from Homebrew, npm, or pipx are picked up without extra configuration: `~/.local/bin`, `~/.claude/bin`, `/usr/local/bin`, `/opt/homebrew/bin`. If your binary lives somewhere else, make sure it's reachable from your shell's `PATH` before opening Ideafy.

#### Quick verification

Run these in your terminal before launching Ideafy. All three should print a path or version:

```bash
git --version       # any 2.x is fine
npm --version       # any 9.x or newer is fine
claude --version    # or `gemini --version`, `codex --version`, `opencode --version`
```

If any command prints `command not found`, install the missing dependency above and re-open your terminal.

### First run

1. **Launch Ideafy** and create a project from the sidebar. Point it at a real git repository on disk — that folder becomes the working directory every agent session inherits.
2. **Give it a narrative** (optional, strongly recommended). The add-project modal lets you create one in-app, point at an existing file, or run the `/product-narrative` skill in your terminal for a guided interview. This is the file the agent reads before arguing with a bad idea.
3. **Connect your CLI.** The first time you open a project, Ideafy writes an MCP server entry into that project's `.claude/settings.json` (or the equivalent for the platform you pick in Settings). You don't have to register anything by hand — the agent sees the Ideafy tools as soon as it starts in that folder.
4. **File your first card** into Ideation. Click **Evaluate Idea** on the card to launch a terminal session; the agent reads your narrative and writes an opinion back to the card. From there, every stage — plan, build, test — happens through the same card.

Inside the card chat panel, three mention prefixes pull context into the conversation:

| Prefix | Resolves to |
|---|---|
| `@` | Project docs and `CLAUDE.md` files, fuzzy-searched. |
| `[[` | Other cards in the project. `[[[` filters to Completed only. |
| `/` | Skills, MCP tools, and agents — global and project-scoped. |

## MCP integration

Ideafy ships an MCP server that exposes the board to any MCP-compatible agent (Claude Code, Gemini CLI, Codex CLI, OpenCode). The agent reads and writes the same SQLite file the app is looking at.

| Tool | Purpose |
|---|---|
| `list_cards` | List cards, optionally filtered by column or project. |
| `get_card` | Fetch a single card by id. |
| `create_card` | Create a card — usually into Ideation or Bugs. |
| `update_card` | Update any card field. |
| `move_card` | Move a card between columns. |
| `save_opinion` | Write the Opinion tab (evaluation + verdict). |
| `save_plan` | Write the Solution tab and advance the card to In Progress. |
| `save_tests` | Write the Tests tab and advance the card to Human Test. |
| `get_project_by_folder` | Resolve a project from a working directory. |

The MCP server reads the same local database the UI uses, so nothing you do from the agent's side has to round-trip through a web API.

## Platform providers

Ideafy abstracts the underlying coding agent behind a small provider interface in `lib/platform/`. The active platform is stored in the `ai_platform` setting and resolved at runtime, so switching between Claude Code, Gemini CLI, Codex CLI, and OpenCode is a settings change, not a rewrite. Each provider advertises its own capabilities (plan mode, worktree support, autonomous mode) and the UI adapts accordingly.

## Tech stack

Next.js 14 (App Router) · React 18 · TypeScript · Tailwind + shadcn/ui · Zustand · SQLite via better-sqlite3 and Drizzle ORM · Electron for the desktop shell.

## Backups

Ideafy writes a daily JSON backup of the full database with a rolling seven-day retention window. Old backups are cleaned up automatically on the next read. Manual export/import is available from the menu if you want to move a board between machines.

## Two editions, one kanban

**Solo** (this repository) is a single SQLite file, a desktop app, and the CLI of your choice. Open source, self-hosted, free forever. It owes nothing to a server.

**Team** is the same board with a shared Pool, role-based access, and managed hosting — the same file, with longer reach. For teams, pricing, and everything cloud, go to **[ideafy.dev](https://ideafy.dev)**.

## Running from source

If you want to hack on Ideafy itself rather than use the DMG:

```bash
git clone https://github.com/ozangencer/ideafy.git
cd ideafy
npm install
npm run dev        # Next.js on http://localhost:3030
npm run electron   # optional: launch the desktop shell against the dev server
```

The SQLite database is stored under `data/` in dev mode. Schema lives in `lib/db/schema.ts` and can be iterated with `npm run db:push`; `drizzle/` holds the committed migrations the packaged DMG applies at boot.

## Contributing

Issues and pull requests are welcome. Open an issue first if you want to discuss a larger change — that's usually the fastest way to find out whether it belongs in Solo or on the other side of the line.

## License

[MIT](LICENSE)
