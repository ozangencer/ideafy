# Rebase Conflict Flow Implementation

**Tarih:** 2026-01-17
**Konu:** Merge sırasında rebase conflict detection ve AI-assisted resolution

---

## Amaç

Human Test sütunundaki kartlar için "Merge & Complete" işlemi sırasında rebase conflict oluştuğunda:

1. Kullanıcıya anlaşılır bir popup göstermek
2. Conflict'i AI yardımıyla çözme imkanı sunmak
3. Çözüm sonrası merge işlemini tamamlamak

---

## Yapılan Değişiklikler

### 1. Database Schema Güncellemesi

**Dosya:** `lib/db/schema.ts`, `lib/types.ts`

Yeni alanlar eklendi:

```typescript
rebaseConflict: boolean | null;  // Conflict var mı?
conflictFiles: string[] | null;  // Hangi dosyalarda conflict var?
```

### 2. Merge Route Güncellemesi

**Dosya:** `app/api/cards/[id]/git/merge/route.ts`

#### Step 0: Ongoing Rebase Detection

Worktree'de devam eden bir rebase olup olmadığını kontrol eder:

- Worktree'lerde `.git` bir dosyadır, klasör değil
- Gerçek git dizini `.git` dosyasından okunur
- `rebase-merge` veya `rebase-apply` klasörü varsa conflict state'i aktif

```typescript
// Worktree için git dizinini bul
const gitDirContent = await execAsync(`cat "${gitFile}"`);
const match = gitDirContent.match(/gitdir:\s*(.+)/);
gitDir = match[1].trim();

// Rebase durumunu kontrol et
const rebaseInProgress = existsSync(`${gitDir}/rebase-merge`) ||
                         existsSync(`${gitDir}/rebase-apply`);
```

#### Step 1: Uncommitted Changes Check

Worktree'de commit edilmemiş değişiklik varsa merge'i engeller.

#### Step 4: Rebase Before Merge

Merge öncesi worktree branch'ini local main üzerine rebase eder:

- `origin/main` yerine local `main` kullanır (unpushed commit'ler için)
- Conflict tespit edilirse 409 status ile detaylı bilgi döner

#### Conflict Response Format

```json
{
  "error": "Rebase conflict detected",
  "rebaseConflict": true,
  "conflictFiles": ["lib/types.ts"],
  "worktreePath": "/path/to/.worktrees/kanban/KAN-XX-...",
  "branchName": "kanban/KAN-XX-...",
  "cardId": "uuid",
  "displayId": "KAN-XX"
}
```

#### Merge Başarılı Olduğunda

`rebaseConflict` ve `conflictFiles` alanları temizlenir.

### 3. Conflict Badge (Card Component)

**Dosya:** `components/board/card.tsx`

Kart üzerinde kırmızı, animasyonlu (pulse) uyarı badge'i:

```tsx
{card.rebaseConflict && (
  <Tooltip>
    <TooltipTrigger asChild>
      <span className="p-1 rounded bg-red-500/20 text-red-500 animate-pulse">
        <AlertTriangle className="w-3 h-3" />
      </span>
    </TooltipTrigger>
    <TooltipContent>
      Merge conflict detected
      {card.conflictFiles?.length} file(s) in conflict
    </TooltipContent>
  </Tooltip>
)}
```

### 4. Conflict Popup Modal

**Dosya:** `components/board/card-modal.tsx`

Merge başarısız olduğunda gösterilen modal:

- Branch adı ve conflicting dosyaları listeler
- **Close** butonu: Modal'ı kapatır, kart Human Test'te kalır
- **Solve with AI** butonu: Claude Code terminali açar

### 5. Resolve Conflict API

**Dosya:** `app/api/cards/[id]/resolve-conflict/route.ts`

Yeni endpoint - conflict çözümü için terminal açar:

- Worktree dizininde Claude Code başlatır
- Conflict bilgilerini prompt olarak gönderir
- iTerm2, Terminal.app ve Ghostty destekler

---

## Test Senaryosu

### Conflict Oluşturma

```bash
# 1. Test kartı oluştur (Human Test sütununda)
# 2. Worktree oluştur
git worktree add -b kanban/KAN-XX .worktrees/kanban/KAN-XX HEAD

# 3. Worktree'de değişiklik yap ve commit et
echo "// WORKTREE LINE" >> .worktrees/.../lib/types.ts
cd .worktrees/... && git add -A && git commit -m "test"

# 4. Main'de aynı dosyaya farklı değişiklik yap ve commit et
echo "// MAIN LINE" >> lib/types.ts
git add && git commit -m "test"
```

### Beklenen Akış

1. Kullanıcı "Merge & Complete" tıklar
2. Rebase conflict tespit edilir
3. Conflict popup açılır (dosya listesi ile)
4. "Solve with AI" tıklanır → Terminal açılır
5. AI conflict'i çözer, `git rebase --continue` çalışır
6. Kullanıcı tekrar "Merge & Complete" tıklar
7. Merge başarılı → Kart Completed'a geçer

---

## Öğrenilen Dersler

### 1. Worktree Git Directory

Worktree'lerde `.git` bir klasör değil, dosyadır:

```
gitdir: /project/.git/worktrees/branch-name
```

Rebase state dosyaları bu dizinde bulunur.

### 2. Shell Escaping

Terminal'e gönderilen prompt'larda `&`, `<`, `>` gibi karakterler shell tarafından yorumlanır. Basit, tek satırlık prompt'lar tercih edilmeli.

### 3. Uncommitted Changes vs Conflict

`git status --porcelain` hem uncommitted changes hem de conflict markers için output verir. Önce rebase state kontrol edilmeli.

---

## Dosya Değişiklikleri Özeti

| Dosya                                          | Değişiklik                                 |
| ---------------------------------------------- | ------------------------------------------ |
| `lib/db/schema.ts`                             | `rebaseConflict`, `conflictFiles` alanları |
| `lib/types.ts`                                 | Card interface güncellendi                 |
| `app/api/cards/route.ts`                       | GET/POST'ta yeni alanlar                   |
| `app/api/cards/[id]/route.ts`                  | PUT'ta yeni alanlar                        |
| `app/api/cards/[id]/git/merge/route.ts`        | Conflict detection, flag clearing          |
| `app/api/cards/[id]/resolve-conflict/route.ts` | Yeni endpoint                              |
| `components/board/card.tsx`                    | Conflict badge                             |
| `components/board/card-modal.tsx`              | Conflict popup modal                       |
| `.gitignore`                                   | `.worktrees/` eklendi                      |

---

## İlgili Commitler

- `feat(conflict): Add conflict popup modal with Solve with AI button`
- `feat(merge): Add rebase conflict detection with blocking behavior`
- `fix(merge): Detect ongoing rebase in worktrees correctly`
- `fix(merge): Clear rebaseConflict flag after successful merge`
- `fix(resolve-conflict): Simplify prompt to avoid shell escaping issues`
