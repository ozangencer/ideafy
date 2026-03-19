# ideafy

A Linear-inspired kanban board for solo founders working with Claude Code.

Local-first, SQLite-powered, zero cloud dependencies.

## Features

- **6-Column Workflow**: Ideation, Backlog, Bugs, In Progress, Test, Completed
- **Project Management**: Multiple projects with custom prefixes and colors
- **Drag & Drop**: Smooth card movement between columns
- **Dark/Light Mode**: Theme toggle with system preference support
- **Keyboard Shortcuts**: Press `N` for new task
- **Search & Filter**: Find tasks quickly across all columns
- **Document Management**: Link and manage project documents
- **AI Integration**: Ideation flow, AI opinion, and quick fix features
- **MCP Server**: Claude Code integration for automated workflows
- **Platform Providers**: Claude, Gemini, Codex CLI support
- **Electron**: Optional desktop app

## Quick Start

```bash
npm install
npm run db:push     # Initialize database
npm run dev         # Start dev server (port 3030)
```

## MCP Integration

ideafy ships with an MCP server for Claude Code. Available tools:

| Tool | Description |
|------|-------------|
| `list_cards` | List cards with optional filters |
| `get_card` | Get card details by ID |
| `create_card` | Create a new card |
| `update_card` | Update card fields |
| `move_card` | Move card between columns |
| `save_plan` | Save solution plan, move to In Progress |
| `save_tests` | Save test scenarios, move to Test |

## Tech Stack

- **Framework**: Next.js 14 (App Router)
- **UI**: React 18 + Tailwind CSS + shadcn/ui
- **State**: Zustand
- **Database**: SQLite (better-sqlite3) + Drizzle ORM
- **Language**: TypeScript

## Database Commands

```bash
npm run db:push      # Apply schema to database
npm run db:generate  # Generate migration files
npm run db:migrate   # Run migrations
npm run db:studio    # Open Drizzle Studio (DB GUI)
```

## Project Structure

```
ideafy/
├── app/                    # Next.js App Router
│   ├── api/               # API routes
│   │   ├── backup/        # Backup endpoints
│   │   ├── cards/         # Card CRUD
│   │   └── projects/      # Project management
│   └── page.tsx           # Main page
├── components/
│   ├── board/             # Kanban board components
│   ├── sidebar/           # Sidebar navigation
│   └── ui/                # shadcn/ui components
├── lib/
│   ├── db/                # Database (Drizzle + SQLite)
│   ├── platform/          # AI platform providers
│   ├── kanban-store/      # Zustand store slices
│   └── types.ts           # TypeScript types
├── mcp-server/            # MCP server for Claude Code
├── electron/              # Electron desktop wrapper
├── data/                  # SQLite database (gitignored)
└── backups/               # Automatic backups (gitignored)
```

## Backup System

- **Automatic Backups**: Every hour while the app is running
- **3-Day Retention**: Old backups are automatically cleaned up
- **Manual Backup**: Create backup on demand via menu
- **JSON Export/Import**: Download and restore all data

## Cloud Features

Looking for team collaboration, shared pool, and real-time sync? Check out [ideafy-cloud](https://github.com/ozangencer/ideafy-cloud) (private).

## Contributing

Contributions are welcome! Please open an issue first to discuss what you'd like to change.

## License

[MIT](LICENSE)
