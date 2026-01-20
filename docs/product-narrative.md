# ideafy - Product Narrative

## Vision Statement

**ideafy, solo founder'ların AI-assisted development workflow'unu end-to-end yönetmelerini sağlayan bir task orchestration sistemidir.**

Bu uygulama, Linear'ın minimal ve profesyonel tasarım dilini Claude Code'un agentic yetenekleriyle birleştirerek, tek kişilik ekiplerin "fikirden production'a" sürecini otomatize etmeyi hedefler.

---

## Problem Definition

### Solo Founder Gerçekliği

Solo founder olarak çalışırken:

1. **Bağlam kaybı** - Birden fazla proje ve task arasında geçiş yaparken context kaybolur
2. **Manuel orchestration** - Her task için Claude Code'u manuel başlatmak, doğru klasöre gitmek, prompt'u yazmak zaman alır
3. **Dokümantasyon açığı** - Çözüm kararları ve test senaryoları kaybolur, aynı problemler tekrar tekrar çözülür
4. **Progress tracking** - Hangi task'ta nerede kaldığını hatırlamak zorlaşır

### Mevcut Araçların Eksikleri

- **Linear/Jira**: Sadece tracking, execution yok
- **Claude Code CLI**: Güçlü ama her seferinde manuel setup gerektirir
- **Obsidian Kanban**: Denendi, MCP entegrasyonu güvenilir değil

---

## Solution Architecture

### Core Concept: Task as Execution Unit

Her kanban card'ı sadece bir "task kaydı" değil, **çalıştırılabilir bir birimdir**:

```
┌─────────────────────────────────────────────────────────────────┐
│  CARD                                                           │
│  ├── title: "Add user authentication"                          │
│  ├── description: Prompt olarak kullanılır                      │
│  ├── projectFolder: Working directory belirlenir                │
│  ├── solutionSummary: Claude'un çözüm planı (auto-populated)    │
│  ├── testScenarios: Tamamlama kriterleri (auto-populated)       │
│  ├── priority: Execution sıralaması                             │
│  └── complexity: Effort estimation                              │
└─────────────────────────────────────────────────────────────────┘
```

### Dual Execution Modes

#### 1. Interactive Mode (Terminal Button - Turuncu)

```
[Terminal Icon] → iTerm2/Ghostty/Terminal açılır → Claude plan modda çalışır
```

**Permission Mode:** `plan`

- Claude sadece analiz edebilir
- Dosya değiştiremez, komut çalıştıramaz
- Kullanıcı planı görür, onaylar, sonra gerekirse manuel ilerler

**Ne zaman kullanılır:**

- Karmaşık kararlar gerektiren task'lar
- Önce plan görmek, sonra execution'a karar vermek
- Debugging ve exploration
- Öğrenme amaçlı (Claude'un düşünce sürecini izlemek)

**Teknik akış:**

1. Card'ın `description`'ı prompt olarak alınır
2. `projectFolder` veya `project.folderPath` working directory olur
3. Seçili terminal uygulamasında yeni pencere açılır
4. `claude "{prompt}" --permission-mode plan` komutu çalıştırılır
5. Claude planını sunar, kullanıcı değerlendirir

#### 2. Autonomous Mode (Play Button - Mavi)

```
[Play Icon] → Background execution → solutionSummary güncellenir
```

**Permission Mode:** `dontAsk`

- Önceden izin verilen tool'ları otomatik kullanır
- İzinsiz tool'ları otomatik reddeder
- Kontrollü otonom execution

**Ne zaman kullanılır:**

- Well-defined, rutin task'lar
- Batch processing (birden fazla low-priority task)
- Gece/ara vermeden çalışması istenen işler
- Güvenli ortamda tam otomasyon

**Teknik akış:**

1. API call: `POST /api/cards/{id}/start`
2. `claude -p "{prompt}" --permission-mode dontAsk --output-format json` çalışır
3. Claude önceden izin verilen tool'larla çalışır
4. Response `solutionSummary` alanına yazılır
5. UI loading state ile geri bildirim verir

**Permission Yapılandırması:**
Autonomous mode'un etkili çalışması için `~/.claude/settings.json` veya proje `.claude/settings.json`'da izin kuralları tanımlanmalı:

```json
{
  "permissions": {
    "allow": [
      "Read",
      "Glob",
      "Grep",
      "Bash(npm run build:*)",
      "Bash(npm test:*)",
      "Edit"
    ]
  }
}
```

---

## Automated Workflow (v0.4)

### User Decisions (Confirmed)

- Terminal ve Play ikisi de otomatik status geçişi yapacak
- Her Play'de solutionSummary üzerine yazılacak (fresh plan)
- Bugs sütunu aynı akışı kullanacak

### State Machine

```
┌─────────────┐     ┌─────────────┐     ┌─────────────┐
│  Ideation   │     │   Backlog   │     │    Bugs     │
│             │     │             │     │             │
└──────┬──────┘     └──────┬──────┘     └──────┬──────┘
       │                   │                   │
       └─────────┬─────────┴─────────┬─────────┘
                 │                   │
                 ▼                   ▼
         ┌──────────────────────────────────┐
         │  [Terminal] veya [Play] basıldı  │
         │  → Otomatik IN PROGRESS'e geç    │
         │  → Phase 1: Planning başlar      │
         └───────────────┬──────────────────┘
                         │
                         ▼
              ┌──────────────────┐
              │   In Progress    │
              │ (Claude planlar) │
              │                  │
              │ solutionSummary  │
              │     dolar ✓      │
              └────────┬─────────┘
                       │
                       ▼
         ┌─────────────────────────────────┐
         │ Solution var, tekrar [Play] →   │
         │ Phase 2: Implementation         │
         │ Claude kodu yazar               │
         │ testScenarios dolar ✓           │
         └───────────────┬─────────────────┘
                         │
                         ▼
              ┌──────────────────┐
              │   Human Test     │
              │                  │
              │ Kullanıcı manuel │
              │ test yapar       │
              └────────┬─────────┘
                       │
                       ▼ (manuel drag)
              ┌──────────────────┐
              │    Completed     │
              └──────────────────┘
```

### Phase Definitions

| Phase              | Trigger       | Precondition                            | Action                     | Result                                   |
| ------------------ | ------------- | --------------------------------------- | -------------------------- | ---------------------------------------- |
| **Ideation**       | Brain/Chat    | Card in Ideation column                 | Claude fikri değerlendirir | aiOpinion, priority, complexity dolar    |
| **Planning**       | Play/Terminal | solutionSummary boş                     | Claude plan üretir         | status → progress, solutionSummary dolar, priority/complexity güncellenir |
| **Implementation** | Play/Terminal | solutionSummary dolu, testScenarios boş | Claude kodu yazar          | status → test, testScenarios dolar       |
| **Re-test**        | Play/Terminal | testScenarios dolu                      | Claude testleri çalıştırır | status değişmez                          |

### Dynamic Button Tooltips

| Phase          | Background Button         | Interactive Button         |
| -------------- | ------------------------- | -------------------------- |
| Ideation       | "Evaluate Idea" (Brain)   | "Discuss Idea" (Chat)      |
| Planning       | "Plan Task (Autonomous)"  | "Plan Task (Interactive)"  |
| Implementation | "Implement (Autonomous)"  | "Implement (Interactive)"  |
| Re-test        | "Re-test (Autonomous)"    | "Re-test (Interactive)"    |

---

## Ideation Workflow

Ideation sütunundaki fikirler için iki farklı değerlendirme modu:

### 1. Evaluate Idea (Brain Button - Background)

```
[Brain Icon] → Background execution → aiOpinion, priority, complexity güncellenir
```

**Ne yapar:**
- Fikri YAGNI, scope creep, teknik fizibilite açısından değerlendirir
- Güçlü/zayıf yönleri listeler
- Priority ve complexity'yi otomatik belirler
- Sonuç `aiOpinion` alanına yazılır

**Ne zaman kullanılır:**
- Hızlı değerlendirme gerektiğinde
- Batch ideation (birden fazla fikri sırayla değerlendirme)
- İlk filtre olarak

### 2. Discuss Idea (Chat Button - Interactive)

```
[Chat Icon] → Terminal açılır → Claude ile interaktif beyin fırtınası
```

**Ne yapar:**
- Fikir hakkında sorular sorar
- Alternatifleri tartışır
- Scope'u daraltır veya genişletir
- Session sonunda MCP ile priority, complexity ve opinion kaydeder

**Ne zaman kullanılır:**
- Karmaşık, çok boyutlu fikirler
- Scope belirsiz olduğunda
- Brainstorming ve refinement gerektiğinde

### AI-Driven Assessment Tags

Claude'un değerlendirmelerinde kullandığı standart formatlar:

**Priority:**
```
[PRIORITY: low/medium/high]
```
- **low**: Nice-to-have, acil değil
- **medium**: Önemli ama kritik değil
- **high**: Acil veya blocker

**Complexity:**
```
[COMPLEXITY: trivial/low/medium/high/very_high]
```
- **trivial**: Birkaç satır değişiklik
- **low**: Basit, tek dosya değişikliği
- **medium**: Orta zorluk, birden fazla dosya
- **high**: Ciddi effort, mimari kararlar
- **very_high**: Major undertaking, sprint-level iş

Bu değerler Claude tarafından otomatik parse edilir ve card'a kaydedilir.

---

## Prompt Templates

### Phase 0: Ideation

**Evaluate Idea (Background):**

```
You are a Product Architect evaluating this idea. Be BRUTALLY HONEST.

## Context Files
Read these files for context:
- @{narrativePath} (project vision & scope) - if it exists
- @CLAUDE.md (technical guidelines) - if it exists

## Idea to Evaluate
**Title:** {card.title}
**Description:** {card.description}

## Your Evaluation Task
Evaluate this idea from these perspectives:
1. YAGNI (You Ain't Gonna Need It)
2. Scope Creep Risk
3. Scalability
4. Technical Feasibility
5. Alignment with Vision
6. Implementation Complexity

## Output Format (REQUIRED)
## Summary Verdict
[Strong Yes / Yes / Maybe / No / Strong No]

## Strengths
- Point 1
- Point 2

## Concerns
- Point 1
- Point 2

## Recommendations
- What should be considered

## Priority
[PRIORITY: low/medium/high] - Your reasoning

## Complexity
[COMPLEXITY: trivial/low/medium/high/very_high] - Your assessment

## Final Score
[X/10] - Brief justification
```

**Discuss Idea (Interactive):**

```
You are a Product Strategist. Let's brainstorm and refine this idea together.

## Idea to Discuss
**Title:** {card.title}
**Description:** {card.description}

## Your Role
1. Ask clarifying questions
2. Challenge assumptions - consider YAGNI, scope creep risks
3. Explore alternatives and improvements
4. Help refine the concept

## CRITICAL: When Discussion Ends
Before finishing, you MUST:
1. Update priority: mcp__kanban__update_card({ id: "{card.id}", priority: "low/medium/high" })
2. Update complexity: mcp__kanban__update_card({ id: "{card.id}", complexity: "trivial/low/medium/high/very_high" })
3. Save opinion: mcp__kanban__save_opinion({ id: "{card.id}", aiOpinion: "..." })

Do NOT end without updating priority, complexity, and saving your opinion.
```

### Phase 1: Planning

**Play Button (Autonomous - dontAsk mode):**

```
You are a senior software architect. Analyze this task and create a detailed implementation plan.

## Task
{card.title}

## Description
{card.description}

## Requirements
1. Identify all files that need to be modified
2. List implementation steps in order
3. Consider edge cases and error handling
4. Note any dependencies or prerequisites

## Output Format
Provide a structured plan in markdown:
- **Files to Modify**: List with brief description
- **Implementation Steps**: Numbered, actionable steps
- **Edge Cases**: Potential issues to handle
- **Dependencies**: Required packages or services
- **Notes**: Any important considerations

## REQUIRED: Assessment Tags
You MUST include these assessment tags at the END of your response:

[COMPLEXITY: trivial/low/medium/high/very_high]
(trivial = few lines, low = simple change, medium = moderate effort, high = significant work, very_high = major undertaking)

[PRIORITY: low/medium/high]
(Based on urgency, impact, and dependencies. Be honest - not everything is high priority!)

Do NOT implement yet - only plan.
```

**Terminal Button (Interactive - plan mode):**

```
You are a senior software architect helping me plan this task.

## Task
{card.title}

## Description
{card.description}

## Kanban MCP Tools Available
- mcp__kanban__save_plan - Save solution plan and move card to In Progress
- mcp__kanban__update_card - Update any card field (including priority, complexity)
- mcp__kanban__get_card - Get card details

Card ID: {card.id}

## CRITICAL: When Plan is Finalized
Before finishing, you MUST:
1. Update complexity: mcp__kanban__update_card({ id: "{card.id}", complexity: "..." })
2. Update priority: mcp__kanban__update_card({ id: "{card.id}", priority: "..." })
3. Save plan: mcp__kanban__save_plan({ id: "{card.id}", solutionSummary: "..." })

Analyze this task and help me create an implementation plan. Ask me questions if anything is unclear.
```

### Phase 2: Implementation

**Play Button (Autonomous - dontAsk mode):**

```
You are a senior developer. Implement the following plan and write test scenarios.

## Task
{card.title}

## Description
{card.description}

## Approved Solution Plan
{card.solutionSummary}

## Instructions
1. Implement the solution according to the plan above
2. Follow existing code patterns in the project
3. After implementation, write test scenarios in markdown

## Test Scenarios Output Format
## Test Scenarios for {card.title}

### Happy Path
- [ ] Test case 1: Description
- [ ] Test case 2: Description

### Edge Cases
- [ ] Test case 3: Description

### Regression Checks
- [ ] Existing functionality X still works

Implement the code, then output ONLY the test scenarios markdown.
```

**Terminal Button (Interactive - plan mode):**

```
You are a senior developer. I need help implementing this plan.

## Task
{card.title}

## Approved Solution Plan
{card.solutionSummary}

Let's implement this together. Start with the first step and guide me through.
```

### Phase 3: Re-test

**Play Button:**

```
Re-run and verify these test scenarios:

## Task
{card.title}

## Test Scenarios
{card.testScenarios}

Run each test and report results. Mark passing tests with ✅ and failing with ❌.
```

**Terminal Button:**

```
Let's verify these test scenarios together:

{card.testScenarios}

Start with the first test case.
```

---

## Legacy Workflow (Manual)

### Stage 1: Ideation → Backlog

```
Fikirler girilir → Olgunlaşınca Backlog'a taşınır
```

Bu aşamada card minimum bilgi içerir:

- Title (kısa, açıklayıcı)
- Rough description
- Henüz proje bağlantısı olmayabilir

### Stage 2-4: Manual Transitions

Kullanıcı isterse card'ları manuel drag & drop ile taşıyabilir.
Otomatik akış tercih edilmese de sistem çalışır.

---

## Future Vision: MCP-Driven Automation

### v0.4 Roadmap - MCP Server

```typescript
// Hedeflenen MCP Tools
mcp.tool("create_card", { title, description, project })
mcp.tool("update_card", { id, updates })
mcp.tool("move_card", { id, newStatus })
mcp.tool("add_solution_summary", { id, summary })
mcp.tool("add_test_scenarios", { id, scenarios })
mcp.tool("start_low_priority_tasks", {})
mcp.tool("get_next_task", { project })
```

### Batch Execution Scenario

```
Kullanıcı: "Low priority backlog task'larını başlat"

MCP Server:
1. Backlog'daki priority=low task'ları filtreler
2. Her biri için subagent spawn eder
3. Paralel execution başlar
4. Sonuçlar solutionSummary'lere yazılır
5. Kullanıcı notification alır
```

### Autonomous Development Loop (Vision)

```
┌────────────────────────────────────────────────────────────────────┐
│                                                                    │
│   [Ideation] ──→ [Backlog] ──→ [In Progress] ──→ [Test] ──→ [Done]│
│        │              │              │              │              │
│        │              │              │              │              │
│        └──────────────┴──────────────┴──────────────┘              │
│                       │                                            │
│                       ▼                                            │
│              ┌────────────────┐                                    │
│              │  Claude Agent  │                                    │
│              │   Subagents    │                                    │
│              └────────────────┘                                    │
│                                                                    │
└────────────────────────────────────────────────────────────────────┘
```

---

## Product-Architect Commentary

### Design Decisions & Rationale

#### 1. Permission Mode Strategy

**İki farklı mod, iki farklı amaç:**

| Buton              | Mode      | CLI Flag                    | Davranış                        |
| ------------------ | --------- | --------------------------- | ------------------------------- |
| Terminal (Turuncu) | `plan`    | `--permission-mode plan`    | Sadece analiz, execution yok    |
| Play (Mavi)        | `dontAsk` | `--permission-mode dontAsk` | Otonom, önceden izinli tool'lar |

**Neden `dontAsk` (Play için)?**

- `plan` mode sadece analiz yapar, hiçbir şey çalıştırmaz - otonom execution için uygun değil
- `dontAsk` mode önceden tanımlanmış `permissions.allow` kurallarına göre çalışır
- İzinsiz tool'lar otomatik reddedilir - kontrollü güvenlik
- `--dangerously-skip-permissions` tam otonom ama riskli - şimdilik tercih etmedik

**Neden `plan` (Terminal için)?**

- Kullanıcı önce planı görmek istiyor
- Kararları kullanıcı veriyor
- Öğrenme ve debugging için ideal

#### 2. Why SQLite + Drizzle?

**Karar:** Solo founder için:

- External DB dependency yok
- Backup = tek dosya kopyala
- Local-first, offline çalışır
- Performans yeterli (binlerce card'a kadar)

#### 3. Why Not Full Agentic Loop Yet?

**Risk analizi:**

- Unsupervised code changes tehlikeli
- Token cost kontrolsüz artabilir
- Rollback mekanizması yok

**Roadmap:**

1. Plan mode (v0.3 - şu an) ✓
2. Approved plan execution (v0.5)
3. Auto-rollback with git (v0.6)
4. Full autonomous (v1.0)

### Technical Debt Awareness

| Alan           | Durum              | Öneri                            |
| -------------- | ------------------ | -------------------------------- |
| Error handling | Basit try/catch    | Retry logic, exponential backoff |
| State sync     | Optimistic updates | WebSocket/SSE for real-time      |
| Test coverage  | Yok                | E2E with Playwright              |
| Authentication | Yok                | Single-user, gerekli değil       |

### Scalability Considerations

**Bu uygulama single-user için tasarlandı.** Multi-user gerekirse:

- SQLite → PostgreSQL
- Local API → Edge deployment
- Card-level → Project-level permissions
- Zustand → Server state (React Query)

Ancak solo founder use case'i için over-engineering'den kaçınılmalı.

---

## Competitive Positioning

| Feature            | Linear | Notion    | ideafy |
| ------------------ | ------ | --------- | ------------- |
| Task tracking      | ✓      | ✓         | ✓             |
| AI assistance      | ×      | ✓ (basic) | ✓ (deep)      |
| Code execution     | ×      | ×         | ✓             |
| Local-first        | ×      | ×         | ✓             |
| Claude native      | ×      | ×         | ✓             |
| Solo founder focus | ×      | ×         | ✓             |

**Unique Value Proposition:**

> "Click a button, Claude writes the code."

Linear görevleri takip eder. ideafy görevleri **çalıştırır**.

---

## Success Metrics (Solo Founder)

- **Task completion rate**: Backlog'dan Completed'a geçen task oranı
- **Time to solution**: Card oluşturma → solutionSummary dolma süresi
- **Autonomous execution rate**: Play butonuyla başarıyla tamamlanan task oranı
- **Context preservation**: Aynı problem için tekrar prompt yazma sıklığı (düşük = iyi)

---

## Appendix: Current State (v0.3)

### Implemented Features

- 6 sütunlu kanban board
- Card CRUD (title, description, solution, tests)
- Dual execution (Terminal + Play)
- Project management
- Document editor (CLAUDE.md)
- Drag & drop
- Search/filter
- Day/night theme
- Priority & complexity badges
- Linear-inspired UI

### Technical Stack

```
Next.js 14 + React 18 + TypeScript
Zustand (state) + Drizzle (ORM) + SQLite (DB)
Tailwind CSS + shadcn/ui components
dnd-kit (drag & drop)
```

### API Surface

```
GET/POST     /api/cards
GET/PUT/DEL  /api/cards/{id}
POST         /api/cards/{id}/start         # Play button
POST         /api/cards/{id}/open-terminal # Terminal button
GET/POST     /api/projects
GET/PUT/DEL  /api/projects/{id}
GET/PUT      /api/settings
```

---

*Document Version: 2.1*
*Last Updated: 2026-01-16*
*Author: Product-Architect Agent*
*Changes: Added Ideation Workflow, AI-Driven Assessment Tags (priority/complexity extraction), updated prompt templates*
