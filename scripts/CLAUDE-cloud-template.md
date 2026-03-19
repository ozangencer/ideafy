# ideafy-cloud - Kanban for Teams

Solo founder'lar ve takimlar icin Linear-inspired kanban. Cloud versiyonu: team/pool/auth/notification destegi.

## Tech Stack

Next.js 14 | React 18 | TypeScript | Tailwind CSS | Zustand | SQLite (Drizzle + better-sqlite3) | Supabase

## Tier Kurallari (Cloud - Private)

Bu repo Ideafy'nin cloud versiyonudur. Solo (public) repo uzerine cloud katmani ekler.

### Upstream sync kurali:
- Solo ozellikler ASLA dogrudan bu repoda gelistirilmez
- Solo gelistirme upstream (public) repoda yapilir
- Bu repo `git rebase upstream/main` ile sync edilir
- Akis her zaman tek yonlu: upstream -> cloud

### Solo sync workflow:
```bash
git fetch upstream
git rebase upstream/main
# conflict varsa coz, test et
git push --force-with-lease origin main
```

### Cloud-only kodlar:
- lib/team/, app/api/team/ (team/pool/auth altyapisi)
- components/board/pool-view.tsx, my-queue.tsx, notification-bell.tsx
- lib/kanban-store/slices/team.ts
- MCP pool tools (pool_list, pool_push, pool_pull, pool_claim)
- middleware.ts, app/(marketing)/, components/landing/
- @supabase/supabase-js, resend, framer-motion bagimliliklari

### Karar tablosu:
| Ozellik | Repo | Ornekler |
|---|---|---|
| Lokal kanban, UI, MCP local tools | ideafy (public) | Yeni card field, dark mode, drag-drop |
| Team, pool, auth, Supabase | ideafy-cloud (private) | Pool filter, team invite, notification |
| Ikisini de etkileyen | Once public, sonra cloud sync | Yeni card status, store refactor |

## Kanban Sutunlari

Ideation -> Backlog -> Bugs -> In Progress -> Test -> Completed

## MCP Tool'lari

| Tool | Aciklama |
|------|----------|
| `mcp__kanban__list_cards` | Kartlari listele |
| `mcp__kanban__get_card` | Kart getir |
| `mcp__kanban__save_plan` | Plan kaydet -> In Progress |
| `mcp__kanban__save_tests` | Test kaydet -> Human Test |
| `mcp__kanban__move_card` | Kart tasi |
| `mcp__kanban__update_card` | Kart guncelle |
| `mcp__kanban__pool_list` | Pool kartlarini listele |
| `mcp__kanban__pool_push` | Karti pool'a gonder |
| `mcp__kanban__pool_pull` | Pool'dan kart cek |
| `mcp__kanban__pool_claim` | Pool kartini sahiplen |

## Komutlar

```bash
npm run dev          # Development server
npm run db:push      # Schema uygula
npm run db:studio    # DB GUI
```

## Kritik Notlar

- API-first: Tum CRUD `/api/cards` uzerinden
- Schema degisikligi: `lib/db/schema.ts` -> `npm run db:push`
- Types: `lib/types.ts`
- UI tema: Linear-inspired, emoji yok, minimal
- Supabase env vars olmadan calistirildiginda solo mode'da calisir
