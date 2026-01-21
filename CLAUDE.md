# ideafy - Kanban for Claude Code

Solo founder'lar için Linear-inspired kanban. Task takibi, çözüm dokümantasyonu ve test senaryoları.

## Tech Stack

Next.js 14 | React 18 | TypeScript | Tailwind CSS | Zustand | SQLite (Drizzle + better-sqlite3)

## Kanban Sütunları

Ideation → Backlog → Bugs → In Progress → Test → Completed

## Card Yapısı

```typescript
interface Card {
  id: string;
  title: string;
  description: string;
  solutionSummary: string;
  testScenarios: string;
  status: Status;
  projectFolder: string;
  createdAt: string;
  updatedAt: string;
}
```

## Aktif Roadmap (v0.4)

- [ ] Tool: update_card
- [ ] Tool: move_card
- [ ] Tool: add_solution_summary
- [ ] Tool: add_test_scenarios
- [ ] `/kanban` skill güncelle

## MCP Tool'ları

| Tool | Açıklama |
|------|----------|
| `mcp__kanban__list_cards` | Kartları listele |
| `mcp__kanban__get_card` | Kart getir |
| `mcp__kanban__save_plan` | Plan kaydet → In Progress |
| `mcp__kanban__save_tests` | Test kaydet → Human Test |
| `mcp__kanban__move_card` | Kart taşı |
| `mcp__kanban__update_card` | Kart güncelle |

## MCP Workflow

1. **Plan onaylandığında** → Kullanıcıya sor, onay alırsan `save_plan` çağır
2. **İmplementasyon bittiğinde** → Kullanıcıya sor, onay alırsan `save_tests` çağır

## Komutlar

```bash
npm run dev          # Development server
npm run db:push      # Schema uygula
npm run db:studio    # DB GUI
```

## Kritik Notlar

- API-first: Tüm CRUD `/api/cards` üzerinden
- Schema değişikliği: `lib/db/schema.ts` → `npm run db:push`
- Types: `lib/types.ts`
- UI tema: Linear-inspired, emoji yok, minimal
