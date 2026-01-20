# ideafy

Linear-inspired kanban board for solo founders working with Claude Code.

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

## Backup System

Automatic and manual backup options to protect your data:

- **Automatic Backups**: Every hour while the app is running
- **3-Day Retention**: Old backups are automatically cleaned up
- **Manual Backup**: Create backup on demand via menu
- **JSON Export**: Download all data (cards, projects, settings) as JSON
- **JSON Import**: Restore from exported JSON with automatic pre-import backup

Access backup options from the three-dot menu (⋮) in the header.

## Tech Stack

- **Framework**: Next.js 14 (App Router)
- **UI**: React 18 + Tailwind CSS + shadcn/ui
- **State**: Zustand
- **Database**: SQLite (better-sqlite3) + Drizzle ORM
- **Language**: TypeScript

## Getting Started

```bash
# Install dependencies
npm install

# Run development server
npm run dev

# Build for production
npm run build

# Start production server
npm start
```

## Database Commands

```bash
npm run db:push      # Apply schema to database
npm run db:generate  # Generate migration files
npm run db:migrate   # Run migrations
npm run db:studio    # Open Drizzle Studio (DB GUI)
```

## Project Structure

```
claude-kanban/
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
│   ├── store.ts           # Zustand state
│   └── types.ts           # TypeScript types
├── data/                   # SQLite database
└── backups/               # Automatic backups (gitignored)
```

## License

Private project for personal use.
