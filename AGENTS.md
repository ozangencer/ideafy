# ideafy - Kanban for Codex

Solo founder'lar için kanban. Task takibi, çözüm dokümantasyonu ve test senaryoları.

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
| `mcp__ideafy__list_cards` | Kartları listele |
| `mcp__ideafy__get_card` | Kart getir |
| `mcp__ideafy__save_plan` | Plan kaydet → In Progress |
| `mcp__ideafy__save_tests` | Test kaydet → Human Test |
| `mcp__ideafy__move_card` | Kart taşı |
| `mcp__ideafy__update_card` | Kart güncelle |

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
- UI tema: Minimal dark theme, emoji yok

## Tier Kuralları (Solo - Open Source)

Bu repo Ideafy'nin open source solo versiyonudur. Cloud/team özellikleri BURAYA GIRMEZ.

### Yasak kodlar (bu repoda OLMAMALI):
- Supabase import veya referansları (`@supabase/supabase-js`, `lib/team/`)
- Pool/queue özellikleri (poolCardId, poolOrigin, pool_list, pool_push vb.)
- Team/auth özellikleri (team CRUD, OAuth, signup, notifications)
- `resend` veya `framer-motion` bağımlılıkları
- `app/api/team/` altında herhangi bir route
- Supabase auth/pool içerikli `middleware.ts` (rate limiting, auth redirect). Lokal güvenlik middleware'i (DNS rebinding + CSRF) izinli.
- `app/(marketing)/` veya `components/landing/`

### Bu repoya girmesi gereken kodlar:
- Lokal kanban özellikleri (sütunlar, kartlar, projeler)
- MCP lokal tools (list_cards, get_card, save_plan, save_tests, move_card, update_card)
- Platform provider abstraction (Codex, Gemini, Codex)
- Electron desteği
- UI iyileştirmeleri (tema, dark mode, drag-drop vb.)

### Pre-commit guard:
- `scripts/check-no-cloud-code.sh` cloud kodun bu repoya girmesini engeller
- Hook `.git/hooks/pre-commit` olarak kurulu
