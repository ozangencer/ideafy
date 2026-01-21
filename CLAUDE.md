# ideafy - Development Workflow Management

## Proje Özeti

Solo founder'lar için Claude Code development workflow'unu yönetecek Linear-inspired kanban uygulaması.

**Amaç:** Claude Code ile çalışırken task takibi, çözüm dokümantasyonu ve test senaryolarını tek bir yerde yönetmek.

**Production URL:** http://localhost:3000 (local)
**Proje Yolu:** `/Users/ozangencer/vibecode/claude-kanban`

---

## Teknoloji Stack

| Katman        | Teknoloji    | Versiyon       |
| ------------- | ------------ | -------------- |
| Framework     | Next.js      | 14.2.21        |
| UI            | React        | 18.3.1         |
| Language      | TypeScript   | 5.7.3          |
| Styling       | Tailwind CSS | 3.4.17         |
| State         | Zustand      | 5.0.3          |
| Database      | SQLite       | better-sqlite3 |
| ORM           | Drizzle      | 0.45.1         |
| ID Generation | uuid         | 11.0.5         |

**Gelecek Entegrasyonlar:**

- MCP Server (Claude Code entegrasyonu)
- shadcn/ui components (isteğe bağlı)

---

## Kanban Yapısı

### Sütunlar (Sabit Sıra)

1. **Ideation** - Fikirler, araştırma gerektiren tasklar
2. **Backlog** - Planlanmış ama başlanmamış tasklar
3. **Bugs** - Hata düzeltmeleri
4. **In Progress** - Aktif çalışılan tasklar
5. **Test** - Test aşamasındaki tasklar
6. **Completed** - Tamamlanan tasklar

### Card Yapısı

```typescript
interface Card {
  id: string;              // UUID
  title: string;           // Task başlığı
  description: string;     // Detaylı açıklama
  solutionSummary: string; // Claude ile mutabık kalınan çözüm
  testScenarios: string;   // Test senaryoları (markdown)
  status: Status;          // Sütun durumu
  projectFolder: string;   // İlişkili proje klasörü
  createdAt: string;       // ISO date
  updatedAt: string;       // ISO date
}
```

---

## Dosya Yapısı

```
/Users/ozangencer/vibecode/claude-kanban/
│
├── app/                          # Next.js App Router
│   ├── layout.tsx                # Root layout (html, body, metadata)
│   ├── page.tsx                  # Ana sayfa - KanbanBoard render
│   ├── globals.css               # Global styles, Tailwind imports
│   └── api/
│       └── cards/
│           ├── route.ts          # GET (list) & POST (create)
│           └── [id]/
│               └── route.ts      # PUT (update) & DELETE
│
├── components/
│   ├── board/                    # Kanban board componentleri
│   │   ├── kanban-board.tsx      # Ana board container
│   │   ├── column.tsx            # Tek sütun (header + cards)
│   │   ├── card.tsx              # Task card (compact view)
│   │   └── card-modal.tsx        # Card detay/edit modal
│   │
│   └── ui/                       # [RESERVED] shadcn/ui components
│
├── lib/                          # Utilities ve business logic
│   ├── types.ts                  # TypeScript interfaces, constants
│   ├── store.ts                  # Zustand store (state management)
│   └── db/
│       ├── index.ts              # Database connection (Drizzle + SQLite)
│       └── schema.ts             # Drizzle schema definitions
│
├── data/                         # Local storage
│   └── kanban.db                 # SQLite database file
│
├── drizzle.config.ts             # Drizzle Kit configuration
│
├── package.json                  # Dependencies
├── tailwind.config.ts            # Linear-inspired tema
├── tsconfig.json                 # TypeScript config
├── next.config.mjs               # Next.js config
├── postcss.config.mjs            # PostCSS config
└── CLAUDE.md                     # Bu dosya
```

### Dosya Sorumlulukları

| Dosya                               | Sorumluluk                                  |
| ----------------------------------- | ------------------------------------------- |
| `app/page.tsx`                      | API'den data yükleme, modal render kontrolü |
| `app/api/cards/route.ts`            | GET (list all) & POST (create) endpoints    |
| `app/api/cards/[id]/route.ts`       | PUT (update) & DELETE endpoints             |
| `lib/store.ts`                      | Zustand state, async API CRUD actions       |
| `lib/types.ts`                      | Card, Status, Column types, COLUMNS array   |
| `lib/db/index.ts`                   | Drizzle + better-sqlite3 connection         |
| `lib/db/schema.ts`                  | Database schema (cards table)               |
| `components/board/kanban-board.tsx` | Sütunları render, filtreleme                |
| `components/board/column.tsx`       | Tek sütun, card listesi, + butonu           |
| `components/board/card.tsx`         | Card compact view, click handler            |
| `components/board/card-modal.tsx`   | Full edit form, save/delete                 |
| `data/kanban.db`                    | SQLite database file                        |

---

## UI Tasarım Prensipleri

### Linear-Inspired Tema

- **Arka plan:** `#0d0d0d` (koyu siyah)
- **Surface:** `#1a1a1a` (card/column arka planı)
- **Border:** `#2a2a2a` (subtle borders)
- **Text:** `#ffffff` primary, `#a0a0a0` secondary, `#666666` muted
- **Accent:** `#5e6ad2` (Linear blue)

### Status Renkleri

```
ideation:  #8b5cf6 (purple)
backlog:   #6b7280 (gray)
bugs:      #ef4444 (red)
progress:  #facc15 (yellow)
test:      #3b82f6 (blue)
completed: #22c55e (green)
```

### Kurallar

- Emoji YOK
- Mor-pembe gradient YOK
- Parlak renkler YOK
- Minimal, clean, professional

---

## Mevcut Özellikler (v0.3.0)

- [x] 6 sütunlu kanban board
- [x] Card oluşturma (+ butonu)
- [x] Card düzenleme (click to open modal)
- [x] Status değiştirme (shadcn Select)
- [x] Title, Description, Solution, Tests alanları
- [x] Proje klasörü bağlama
- [x] ESC ile modal kapatma
- [x] Linear-inspired koyu tema
- [x] Zustand state management
- [x] SQLite database (Drizzle ORM + better-sqlite3)
- [x] REST API (GET, POST, PUT, DELETE)
- [x] Auto-load from API on page load
- [x] Drag & drop (dnd-kit)
- [x] Keyboard shortcuts (N: new task)
- [x] Search/filter
- [x] Project dropdown filter
- [x] Day-night mode toggle (next-themes)
- [x] shadcn/ui components (Select, Button, Input)

---

## Roadmap

### v0.2 - Persistence (Completed)

- [x] API route: GET /api/cards
- [x] API route: POST /api/cards
- [x] API route: PUT /api/cards/[id]
- [x] API route: DELETE /api/cards/[id]
- [x] SQLite database (Drizzle ORM + better-sqlite3)
- [x] Page load'da DB'den yükle

### v0.3 - UX İyileştirmeleri (Completed)

- [x] Drag & drop (dnd-kit)
- [x] Keyboard shortcuts (N: new task)
- [x] Proje dropdown (mevcut projelerden seç)
- [x] Search/filter
- [x] shadcn/ui components (Select, Button, Input)
- [x] Day-night mode (next-themes)

### v0.4 - Claude Code Entegrasyonu

- [x] MCP Server oluştur
- [x] Tool: create_card
- [ ] Tool: update_card
- [ ] Tool: move_card
- [ ] Tool: add_solution_summary
- [ ] Tool: add_test_scenarios
- [ ] `/kanban` skill güncelle (MCP'ye bağla)

### v0.5 - Gelişmiş Özellikler

- [ ] Card history/changelog
- [x] Markdown preview (solution, tests)
- [ ] Export (JSON, Markdown)
- [ ] Multi-board support

---

## Geliştirme Komutları

```bash
# Projeye git
cd /Users/ozangencer/vibecode/claude-kanban

# Bağımlılıkları yükle
npm install

# Development server
npm run dev

# Build
npm run build

# Production start
npm start

# Database komutları
npm run db:push      # Schema'yı DB'ye uygula
npm run db:generate  # Migration dosyaları oluştur
npm run db:migrate   # Migration'ları çalıştır
npm run db:studio    # Drizzle Studio (DB GUI)
```

---

## Context - Önceki Çalışmalar

Bu projeden önce Obsidian Kanban tabanlı bir skill denendi:

- Konum: `~/.claude/skills/kanban/`
- Sorun: Obsidian MCP patch_content aracı güvenilir değildi
- Karar: Native web app daha iyi bir çözüm

Obsidian skill hala mevcut ama bu proje tercih edilmeli.

---

## MCP Kanban Workflow (Claude Code için)

ideafy projesi üzerinde çalışırken aşağıdaki workflow'u takip et:

### Kullanılabilir MCP Tool'ları

| Tool                       | Açıklama                                             |
| -------------------------- | ---------------------------------------------------- |
| `mcp__kanban__list_cards`  | Tüm kartları listele (status/projectId ile filtrele) |
| `mcp__kanban__get_card`    | Belirli bir kartı getir                              |
| `mcp__kanban__save_plan`   | Plan kaydet ve kartı "In Progress"e taşı             |
| `mcp__kanban__save_tests`  | Test senaryoları kaydet ve kartı "Human Test"e taşı  |
| `mcp__kanban__move_card`   | Kartı farklı bir sütuna taşı                         |
| `mcp__kanban__update_card` | Kart bilgilerini güncelle                            |

### Workflow Kuralları

1. **Plan Onaylandığında:**
   
   - Kullanıcı planı onayladıktan sonra (ExitPlanMode sonrası), kullanıcıya sor: "Planı kanban kartına kaydetmemi ister misin?"
   - Onay alırsan `mcp__kanban__save_plan` tool'unu çağır
   - Bu otomatik olarak kartı "In Progress" sütununa taşır

2. **İmplementasyon Tamamlandığında:**
   
   - Kod yazımı ve testler başarıyla tamamlandığında, kullanıcıya sor: "Test senaryolarını kanban kartına kaydetmemi ister misin?"
   - Onay alırsan `mcp__kanban__save_tests` tool'unu çağır
   - Bu otomatik olarak kartı "Human Test" sütununa taşır

3. **Markdown Formatı:**

   - `save_plan` ve `save_tests` markdown formatında içerik bekler
   - Checkbox'lar için `- [ ]` veya `- [x]` formatını kullan
   - MCP server otomatik olarak Tiptap-uyumlu HTML'e çevirir

### Örnek Kullanım

```
# Plan kaydetme
mcp__kanban__save_plan({
  id: "card-uuid",
  solutionSummary: "# Plan Başlığı\n\n## Adımlar\n1. İlk adım\n2. İkinci adım"
})

# Test senaryoları kaydetme
mcp__kanban__save_tests({
  id: "card-uuid",
  testScenarios: "# Test Senaryoları\n\n- [ ] İlk test\n- [ ] İkinci test"
})
```

---

## Yeni Session İçin Checklist

1. Bu dosyayı oku: `/Users/ozangencer/vibecode/claude-kanban/CLAUDE.md`
2. Mevcut kodu incele: `lib/types.ts`, `lib/store.ts`, `app/api/cards/`
3. Dev server başlat: `npm run dev`
4. http://localhost:3000 adresinde test et
5. Roadmap'e göre devam et

---

## Önemli Notlar

- **API-first:** Tüm CRUD işlemleri `/api/cards` endpoint'leri üzerinden
- **Database:** SQLite (`data/kanban.db`) + Drizzle ORM
- **Schema değişikliği:** `lib/db/schema.ts` güncelle, sonra `npm run db:push`
- **State:** Zustand store API ile senkronize çalışır (`lib/store.ts`)
- **Types merkezi:** Yeni field eklerken `lib/types.ts`'i de güncelle
- **Tailwind tema:** Renk değişiklikleri `tailwind.config.ts`'de
- **Component yapısı:** `components/board/` altında, atomic design
- **shadcn hazır:** `components/ui/` reserved, gerektiğinde ekle

---

## Section-Based AI Chat Stream

Her card section'ının (Detail, AI's Opinion, Solution Summary, Test Scenarios) altında inline AI chat input var. Kullanıcı o section'a özel soru sorar, Claude cevap verir ve section otomatik güncellenir.

### Mimari

```
┌─────────────────────────────────────────────────────┐
│  Card Modal                                         │
│  ┌───────────────────────────────────────────────┐  │
│  │ Detail Section                                │  │
│  │ [TipTap Editor]                               │  │
│  │ [💬 Ask AI...                        ] [Send] │  │
│  │ [Activity Log - thinking/tools]               │  │
│  │ [AI Response - streaming markdown]            │  │
│  └───────────────────────────────────────────────┘  │
│  (Same for Opinion, Solution, Tests sections)       │
└─────────────────────────────────────────────────────┘
```

### Dosyalar

| Dosya | Açıklama |
|-------|----------|
| `components/claude/SectionChatInput.tsx` | Section-based chat component |
| `app/api/cards/[id]/section-stream/route.ts` | SSE streaming endpoint |

### API Endpoint

**POST** `/api/cards/[id]/section-stream`

```typescript
// Request body
{
  prompt: string;       // Full prompt with system + user message
  projectPath: string;  // Project folder for Claude context
  sectionType: string;  // "detail" | "opinion" | "solution" | "tests"
}

// SSE Response events
{ type: "start", data: { pid } }
{ type: "text", data: "response text" }
{ type: "thinking", data: "thinking content" }
{ type: "tool_use", data: { name, input } }
{ type: "tool_result", data: { name, output } }
{ type: "close", data: { code } }
{ type: "error", data: "error message" }
```

### Claude CLI Spawn Config

```typescript
spawn("/Users/ozangencer/.local/bin/claude", [
  "-p", prompt,
  "--print",
  "--output-format", "stream-json",
  "--verbose"
], {
  cwd: projectPath,
  stdio: ["ignore", "pipe", "pipe"],  // stdin ignored, stdout/stderr piped
  env: { HOME, USER, PATH }
});
```

### Önemli Notlar

- `--input-format stream-json` ve `--include-partial-messages` KULLANMA - stdin beklemesine neden olur
- `stdio[0]` mutlaka `"ignore"` olmalı - `"pipe"` olursa stdout üretmez
- Markdown → HTML çevrimi `marked` ile yapılıyor (GFM + breaks enabled)
- Activity log sadece loading sırasında görünür
- Toggle loading sırasında disabled

---

**Son Güncelleme:** 2026-01-21
**Versiyon:** 0.4.0
