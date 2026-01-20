# ideafy Button & System Prompt Documentation

Bu doküman, ideafy uygulamasındaki tüm butonları, kullandıkları API endpoint'leri, çalışma modlarını ve Claude'a gönderilen prompt'ları detaylı olarak açıklar.

---

## Buton Özet Tablosu

| Buton | Konum | Koşul | API Endpoint | Mod | Prompt Fonksiyonu |
|-------|-------|-------|--------------|-----|-------------------|
| **Discuss Idea** | Ideation sütunu kartları | `canEvaluate` | `/api/cards/[id]/ideate` | Interactive (Terminal) | `buildIdeationPrompt()` |
| **Evaluate Idea** | Ideation sütunu kartları | `canEvaluate` | `/api/cards/[id]/evaluate` | Autonomous | `buildEvaluatePrompt()` |
| **Quick Fix** | Bugs sütunu kartları | `canQuickFix` | `/api/cards/[id]/quick-fix` | Autonomous | `buildQuickFixPrompt()` |
| **Plan Task (Interactive)** | Backlog kartları | `canStart && phase=planning` | `/api/cards/[id]/open-terminal` | Interactive (Terminal) | `buildPrompt(planning)` |
| **Plan Task (Autonomous)** | Backlog kartları | `canStart && phase=planning` | `/api/cards/[id]/start` | Autonomous | `buildPhasePrompt(planning)` |
| **Implement (Interactive)** | Plan onaylanmış kartlar | `canStart && phase=implementation` | `/api/cards/[id]/open-terminal` | Interactive (Terminal) | `buildPrompt(implementation)` |
| **Implement (Autonomous)** | Plan onaylanmış kartlar | `canStart && phase=implementation` | `/api/cards/[id]/start` | Autonomous | `buildPhasePrompt(implementation)` |
| **Fix Issues (Interactive)** | Test başarısız kartlar | `canStart && phase=retest` | `/api/cards/[id]/open-terminal` | Interactive (Terminal) | `buildPrompt(retest)` |
| **Re-test (Autonomous)** | Test başarısız kartlar | `canStart && phase=retest` | `/api/cards/[id]/start` | Autonomous | `buildPhasePrompt(retest)` |
| **Merge & Complete** | Human Test sütunu (worktree aktif) | `status=test && gitBranch` | `/api/cards/[id]/git/merge` | - | - |
| **Rollback** | Human Test sütunu (worktree aktif) | `status=test && gitBranch` | `/api/cards/[id]/git/rollback` | - | - |
| **Solve with AI** | Rebase conflict dialog | `rebaseConflict=true` | `/api/cards/[id]/resolve-conflict` | Interactive (Terminal) | `buildConflictPrompt()` |
| **Start/Stop Dev Server** | Human Test sütunu (worktree aktif) | `gitWorktreeStatus=active` | `/api/cards/[id]/dev-server` | - | - |

---

## Detaylı Buton Açıklamaları

### 1. Discuss Idea (Interactive Ideation)

**Buton:** `<MessagesSquare>` ikonu
**Renk:** Cyan
**Konum:** Ideation sütunundaki kartlarda
**API:** `POST /api/cards/[id]/ideate`
**Mod:** Interactive - Terminalde açılır
**Permission:** `--permission-mode plan`

**Prompt Builder:** `buildIdeationPrompt(card)`

```
You are a Product Strategist. Let's brainstorm and refine this idea together.

## Idea to Discuss
**Title:** {card.title}

**Description:**
{card.description}

## Your Role
1. Ask clarifying questions to understand the idea better
2. Challenge assumptions - consider YAGNI, scope creep risks
3. Explore alternatives and improvements
4. Help refine the concept into something actionable
5. Consider technical feasibility and implementation complexity

## Discussion Guidelines
- Be curious and ask probing questions
- Point out potential issues constructively
- Suggest improvements or alternatives
- Help prioritize if the idea is too broad
- Be honest but collaborative

## Kanban MCP Tools Available
- mcp__kanban__save_opinion - Save your final thoughts to the card
- mcp__kanban__update_card - Update card fields (including priority)
- mcp__kanban__get_card - Get card details

Card ID: {card.id}

## CRITICAL: When Discussion Ends
Before finishing, you MUST do THREE things:

### 1. Update Priority
Based on our discussion, update the card priority:
mcp__kanban__update_card({ id: "{card.id}", priority: "low" | "medium" | "high" })
Be BRUTALLY HONEST - not everything is high priority!

### 2. Update Complexity
Based on the scope of the idea, update the card complexity:
mcp__kanban__update_card({ id: "{card.id}", complexity: "trivial" | "low" | "medium" | "high" | "very_high" })

### 3. Save Your Opinion
Your opinion MUST include EXACTLY these sections:
mcp__kanban__save_opinion({ id: "{card.id}", aiOpinion: "..." })

Let's start! What would you like to explore about this idea?
```

---

### 2. Evaluate Idea (Autonomous)

**Buton:** `<Brain>` ikonu
**Renk:** Purple
**Konum:** Ideation sütunundaki kartlarda
**API:** `POST /api/cards/[id]/evaluate`
**Mod:** Autonomous - Arka planda çalışır
**Permission:** `--permission-mode dontAsk`

**Prompt Builder:** `buildEvaluatePrompt(card, narrativePath)`

```
You are a Product Architect evaluating this idea. Be BRUTALLY HONEST.

## Context Files
Read these files for context:
- @{narrativePath || docs/product-narrative.md} (project vision & scope) - if it exists
- @CLAUDE.md (technical guidelines) - if it exists

## Idea to Evaluate
**Title:** {card.title}

**Description:**
{card.description}

## Your Evaluation Task
Evaluate this idea from these perspectives:

1. **YAGNI (You Ain't Gonna Need It)**: Is this feature truly needed? Will it provide value?
2. **Scope Creep Risk**: Does this expand the project scope unnecessarily?
3. **Scalability**: Will this scale with the product growth?
4. **Technical Feasibility**: Is this technically achievable with reasonable effort?
5. **Alignment with Vision**: Does this fit the product's core mission?
6. **Implementation Complexity**: How hard is this to build?

## Output Format
You MUST provide your evaluation as markdown with EXACTLY these sections:

## Summary Verdict
[One sentence: Strong Yes / Yes / Maybe / No / Strong No]

## Strengths
- Point 1
- Point 2

## Concerns
- Point 1
- Point 2

## Recommendations
- What should be considered before implementing
- Any suggested modifications to the idea

## Priority
[PRIORITY: low/medium/high] - Your reasoning for this priority level

## Complexity
[COMPLEXITY: trivial/low/medium/high/very_high] - Your assessment

## Final Score
[X/10] - Brief justification for the score

---
Be direct. Don't sugarcoat. Point out both good and bad aspects.
```

---

### 3. Quick Fix (Autonomous)

**Buton:** `<Zap>` ikonu
**Renk:** Yellow
**Konum:** Bugs sütunundaki kartlarda
**API:** `POST /api/cards/[id]/quick-fix`
**Mod:** Autonomous - Arka planda çalışır
**Permission:** `--dangerously-skip-permissions`

**Prompt Builder:** `buildQuickFixPrompt(card)`

```
You are a senior developer. Fix this bug quickly and efficiently.

## Bug Report
{card.title}

## Description
{card.description}

## Instructions
1. Analyze the bug description
2. Find the root cause in the codebase
3. Implement the fix
4. Verify the fix works

## Output Requirements
After fixing the bug, provide a brief summary in this format:

## Quick Fix Summary
- **Root Cause:** Brief description of what caused the bug
- **Fix Applied:** What was changed to fix it
- **Files Modified:** List of files that were changed

## Test Scenarios
- [ ] Bug no longer reproduces
- [ ] Related functionality still works
- [ ] No regression in existing tests

Focus on fixing the bug efficiently. Do NOT write extensive documentation or plans.
```

**Not:** Quick Fix tamamlandıktan sonra otomatik olarak git commit yapılır ve kart Human Test'e taşınır.

---

### 4. Plan Task (Interactive) - Terminal Button

**Buton:** `<Terminal>` ikonu
**Renk:** Orange
**Konum:** Backlog veya Progress sütunundaki kartlarda (phase=planning)
**API:** `POST /api/cards/[id]/open-terminal`
**Mod:** Interactive - Terminalde açılır
**Permission:** `--permission-mode plan`

**Prompt Builder:** `buildPrompt(planning, ctx)` (open-terminal/route.ts içinde)

```
# [{displayId}] {title}

## Instructions
1. First, read the card details using: mcp__kanban__get_card with id: "{card.id}"
2. Review the description field for task requirements
3. Analyze this task and create a detailed implementation plan
4. Do NOT implement yet - only plan
```

---

### 5. Plan Task (Autonomous) - Play Button

**Buton:** `<Play>` ikonu
**Renk:** Primary (Blue)
**Konum:** Backlog sütunundaki kartlarda (phase=planning)
**API:** `POST /api/cards/[id]/start`
**Mod:** Autonomous - Arka planda çalışır
**Permission:** `--permission-mode dontAsk` (planning) / `--dangerously-skip-permissions` (implementation)

**Prompt Builder:** `buildPhasePrompt(planning, card)` (lib/prompts.ts içinde)

```
Kanban: {card.id}

Read card via MCP (mcp__kanban__get_card). Review title, description, and any existing notes.

Task: Create implementation plan for "{title}".

Plan format:
- Files to Modify
- Implementation Steps
- Edge Cases
- Dependencies

Must include at the end:
[COMPLEXITY: trivial/low/medium/high/very_high]
[PRIORITY: low/medium/high]

Do NOT implement yet - plan only.
```

---

### 6. Implement (Interactive) - Terminal Button

**Buton:** `<Terminal>` ikonu
**Renk:** Orange
**Konum:** Plan onaylanmış kartlarda (phase=implementation)
**API:** `POST /api/cards/[id]/open-terminal`
**Mod:** Interactive - Terminalde açılır
**Permission:** Normal mode (no --permission-mode flag)

**Prompt Builder:** `buildPrompt(implementation, ctx)` (open-terminal/route.ts içinde)

```
# [{displayId}] {title}
Git Branch: {gitBranchName}

## Instructions
1. First, read the card details using: mcp__kanban__get_card with id: "{card.id}"
2. Review the solutionSummary field for the implementation plan
3. Implement the plan
4. When done, save test scenarios using mcp__kanban__save_tests
```

---

### 7. Implement (Autonomous) - Play Button

**Buton:** `<Play>` ikonu
**Renk:** Primary (Blue)
**Konum:** Plan onaylanmış kartlarda (phase=implementation)
**API:** `POST /api/cards/[id]/start`
**Mod:** Autonomous - Arka planda çalışır
**Permission:** `--dangerously-skip-permissions`

**Prompt Builder:** `buildPhasePrompt(implementation, card)` (lib/prompts.ts içinde)

```
Kanban: {card.id}

Read card via MCP (mcp__kanban__get_card). Follow the approved plan in solutionSummary.

Task: Implement "{title}".

After coding, write test scenarios:
### Happy Path
- [ ] Test case

### Edge Cases
- [ ] Test case

### Regression
- [ ] Existing feature still works

Write code, then output only test scenarios.
```

**Not:** Implementation phase'de otomatik olarak git worktree oluşturulur (eğer proje için worktree etkinse).

---

### 8. Fix Issues (Interactive) - Terminal Button

**Buton:** `<Terminal>` ikonu
**Renk:** Orange
**Konum:** Test başarısız kartlarda (phase=retest)
**API:** `POST /api/cards/[id]/open-terminal`
**Mod:** Interactive - Terminalde açılır
**Permission:** Normal mode

**Prompt Builder:** `buildPrompt(retest, ctx)` (open-terminal/route.ts içinde)

```
# [{displayId}] {title}
Git Branch: {gitBranchName}

## Context
The user tested this implementation but encountered an error.

## Instructions
1. First, read the card details using: mcp__kanban__get_card with id: "{card.id}"
2. Review the solutionSummary and description fields
3. Wait for the user to describe the error they encountered
4. Analyze the error and identify the root cause
5. Fix the issues while preserving the original solution approach
6. When done, save updated test scenarios using mcp__kanban__save_tests
```

---

### 9. Re-test (Autonomous) - Play Button

**Buton:** `<Play>` ikonu
**Renk:** Primary (Blue)
**Konum:** Test başarısız kartlarda (phase=retest)
**API:** `POST /api/cards/[id]/start`
**Mod:** Autonomous - Arka planda çalışır
**Permission:** `--dangerously-skip-permissions`

**Prompt Builder:** `buildPhasePrompt(retest, card)` (lib/prompts.ts içinde)

```
Kanban: {card.id}

Read card via MCP (mcp__kanban__get_card). Review previous implementation and test scenarios.

Task: "{title}" failed during testing.

User will describe the error - wait and fix.
```

---

### 10. Merge & Complete

**Buton:** `<GitMerge>` ikonu + "Merge & Complete" text
**Renk:** Green
**Konum:** Human Test sütunu, worktree aktif kartlarda
**API:** `POST /api/cards/[id]/git/merge`
**Mod:** Git işlemi - Prompt yok

**İşlem Adımları:**
1. Worktree'de uncommitted changes kontrolü
2. Main repo'da uncommitted changes kontrolü
3. Branch'i main'e rebase (conflict check)
4. Squash merge
5. Worktree'yi sil
6. Branch'i sil
7. Kartı Completed'e taşı

---

### 11. Rollback

**Buton:** `<Undo2>` ikonu + "Rollback" text
**Renk:** Red outline
**Konum:** Human Test sütunu, worktree aktif kartlarda
**API:** `POST /api/cards/[id]/git/rollback`
**Mod:** Git işlemi - Prompt yok

**Seçenekler:**
- **Keep branch:** Branch korunur, sadece main'e checkout yapılır
- **Delete branch:** Branch silinir, kart Bugs'a taşınır

---

### 12. Solve with AI (Conflict Resolution)

**Buton:** `<Terminal>` ikonu + "Solve with AI" text
**Renk:** Orange
**Konum:** Rebase conflict dialog içinde
**API:** `POST /api/cards/[id]/resolve-conflict`
**Mod:** Interactive - Terminalde açılır
**Permission:** Normal mode

**Prompt Builder:** `buildConflictPrompt(displayId, branchName, conflictFiles)`

```
Rebase conflict resolution for {displayId}. Branch: {branchName}. Conflicting files: {filesStr}. Help me resolve the git rebase conflict. Open the conflicting files, find the conflict markers, resolve them, then run git add and git rebase --continue.
```

---

### 13. Start/Stop Dev Server

**Buton:** `<MonitorPlay>` / `<MonitorStop>` ikonu
**Renk:** Cyan (start) / Green→Red (stop)
**Konum:** Human Test sütunu, worktree aktif kartlarda
**API:** `POST /api/cards/[id]/dev-server`
**Mod:** Shell işlemi - Prompt yok

**İşlem:** Worktree dizininde `npm run dev` komutu çalıştırır ve port bilgisini saklar.

---

## Phase Detection Logic

Phase, kartın mevcut durumuna göre otomatik olarak belirlenir:

```typescript
function detectPhase(card): Phase {
  const hasSolution = card.solutionSummary && stripHtml(card.solutionSummary) !== "";
  const hasTests = card.testScenarios && stripHtml(card.testScenarios) !== "";

  if (!hasSolution) return "planning";
  if (!hasTests) return "implementation";
  return "retest";
}
```

| Phase | Koşul | Sonuç |
|-------|-------|-------|
| **planning** | `solutionSummary` boş | Plan oluşturulur |
| **implementation** | `solutionSummary` dolu, `testScenarios` boş | Kod yazılır |
| **retest** | Her ikisi de dolu | Hatalar düzeltilir |

---

## Permission Modları

| Mod | Flag | Açıklama |
|-----|------|----------|
| **dontAsk** | `--permission-mode dontAsk` | Sadece okuma işlemleri, dosya yazmaz |
| **plan** | `--permission-mode plan` | Plan modu, kullanıcı onayı gerektirir |
| **Normal** | (flag yok) | Standart interactive mod |
| **Skip** | `--dangerously-skip-permissions` | Tüm dosya işlemlerine izin verir |

---

## MCP Tools Kullanımı

Tüm prompt'lar aşağıdaki MCP tool'larını kullanabilir:

- `mcp__kanban__get_card` - Kart detaylarını oku
- `mcp__kanban__save_plan` - Plan kaydet (solutionSummary)
- `mcp__kanban__save_tests` - Test senaryoları kaydet
- `mcp__kanban__save_opinion` - AI görüşü kaydet
- `mcp__kanban__update_card` - Kart güncelle (priority, complexity vb.)
- `mcp__kanban__move_card` - Kartı farklı sütuna taşı

---

## Dosya Referansları

| Dosya | İçerik |
|-------|--------|
| `lib/prompts.ts` | Tüm prompt builder fonksiyonları |
| `components/board/card.tsx` | Kart butonları ve handlers |
| `components/board/card-modal.tsx` | Modal içi butonlar (Merge, Rollback) |
| `app/api/cards/[id]/start/route.ts` | Autonomous execution |
| `app/api/cards/[id]/open-terminal/route.ts` | Interactive terminal |
| `app/api/cards/[id]/evaluate/route.ts` | Evaluate endpoint |
| `app/api/cards/[id]/ideate/route.ts` | Ideation terminal |
| `app/api/cards/[id]/quick-fix/route.ts` | Quick fix endpoint |
| `app/api/cards/[id]/git/merge/route.ts` | Git merge endpoint |
| `app/api/cards/[id]/git/rollback/route.ts` | Git rollback endpoint |
| `app/api/cards/[id]/resolve-conflict/route.ts` | Conflict resolution |
| `app/api/cards/[id]/dev-server/route.ts` | Dev server management |

---

**Son Güncelleme:** 2026-01-21
