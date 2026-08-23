/**
 * Shared style contract for test-scenario generation. Every prompt that asks
 * the AI to write `- [ ] …` scenarios (Chat UI Tests tab, terminal
 * test-together / generate-tests flows, autonomous start / quick-fix, and the
 * MCP save_tests tool description) MUST inject this contract so the output
 * voice stays consistent across entry points.
 *
 * mcp-server is a separate package and cannot import across the repo root
 * (its tsconfig pins `rootDir: "."`), so scripts/sync-mcp-shared.mjs copies
 * this file verbatim to mcp-server/test-style.generated.ts on every mcp-server
 * build. Keep this module import-free — the copy has to compile standalone.
 *
 * Default voice: a manual tester / BA walking a solo founder through each
 * step — second-person imperative, setup → action → expected. Spec-style
 * assertion bullets are explicitly called out as the anti-pattern.
 *
 * Structure: the checklist leads with a capped `Core flow` group written from
 * the card's real data; later groups are optional and exist only to catch what
 * the core flow cannot. Volume is the failure mode these rules target — a long
 * checklist reads as work to postpone, so it never gets run.
 */

export interface TestStyleOptions {
  /** ISO language code to force. If omitted, the AI must mirror the card's language. */
  language?: "tr" | "en";
}

const STYLE_CONTRACT_EN = `## Test scenario style (mandatory)

Write scenarios as a manual tester walking the user through the feature, not as
a spec of assertions. Each scenario must read like an instruction, not a fact.

### Structure — lead with the core flow

The checklist opens with a \`## Core flow\` group. That group is the deliverable;
everything after it is optional.

- \`## Core flow\` — **at most 5 items.** If these pass, the feature
  fundamentally works. Write these first and write them well.
- Later groups (\`## Edge cases\`, \`## Regression\`) are OPTIONAL. Add one only
  when it catches something the core flow cannot. A group that re-tests the
  core flow in other words is noise, and noise is why checklists go untouched.
- A checklist past ~12 items is a signal that the card is too big — not that
  you were thorough.

### Use the card's real data, not placeholders

Every step should be runnable without the reader going to look something up.
Pull concrete values from the card and the conversation: real card IDs, file
paths, session IDs, URLs, column names.

- "Open card IDE-282" beats "open a card".
- "Its session is \`83e1174a…\`, idle since yesterday" beats "pick a session".
- When the order of steps matters, say why on the same line ("not IDE-283 — that
  session is live right now and would conflict").
- A group may close with one \`If it breaks:\` line naming the first place to
  look. Keep it to a sentence.

### Format

- Group scenarios by feature area with \`## Heading\` per group.
- Each checkbox item = one observable step. Use second-person imperative.
- Prefer: setup → action → expected outcome, in that order.
- Keep each item short enough to fit on one line when possible, but never at
  the cost of ambiguity. If the expected result isn't obvious, spell it out.
- Mention UI elements by their visible labels, not CSS selectors.
- Avoid implementation jargon (DB column names, internal function names) unless
  the test genuinely requires them.

### Good examples (follow this style)

\`\`\`
## Core flow
- [ ] Open card IDE-282 and click the terminal icon in the header. One row
  should appear: \`83e1174a…\`, labelled \`terminal\`.
- [ ] Hit copy, then paste into a fresh terminal in ~/vibecode/ideafy.
  Yesterday's conversation should resume.
- [ ] Back in the popover, hit the terminal button instead. Your terminal app
  opens on the same conversation and Ideafy shows "Resumed in CLI".

If it breaks: a blank session almost always means cwd — check the session's
stored \`cwd\` against where the terminal actually opened.
\`\`\`

### Bad examples (do not produce these)

- [ ] mergeTestCheckState preserves checked state on rewording.   // too abstract, no action
- [ ] Dropdown shows None + all teams.                             // spec, not a test step
- [ ] value === 'none' when card has no team                        // implementation assertion
- [ ] Works correctly.                                              // unobservable
- [ ] Open a card that has a session.                               // placeholder — name the card`;

const STYLE_CONTRACT_TR = `## Test senaryosu stil kuralları (zorunlu)

Senaryoları, kullanıcıyı feature'ı adım adım gezdiren bir manuel testçi gibi
yaz — assertion listesi gibi değil. Her madde bir gözlemlenebilir adım olmalı,
bir iddia değil.

### Yapı — önce temel akış

Çeklist \`## Temel akış\` grubuyla başlar. Asıl teslim edilen şey o grup;
sonrasındaki her şey opsiyoneldir.

- \`## Temel akış\` — **en fazla 5 madde.** Bunlar geçiyorsa feature temelde
  çalışıyordur. Önce bunları yaz, ve iyi yaz.
- Sonraki gruplar (\`## Kenar durumlar\`, \`## Regresyon\`) OPSİYONELDİR. Sadece
  temel akışın yakalayamayacağı bir şeyi yakalıyorsa ekle. Temel akışı başka
  kelimelerle tekrar eden grup gürültüdür — çeklistlerin hiç ellenmeme sebebi de
  o gürültü.
- ~12 maddeyi aşan bir çeklist, kapsamlı davrandığının değil, kartın fazla büyük
  olduğunun işaretidir.

### Placeholder değil, kartın gerçek verisi

Her adım, okuyanın gidip bir şey araması gerekmeden çalıştırılabilir olmalı.
Somut değerleri karttan ve konuşmadan çek: gerçek kart ID'si, dosya yolu,
session ID, URL, kolon adı.

- "IDE-282'yi aç" > "bir kart aç".
- "Session'ı \`83e1174a…\`, dünden beri boşta" > "bir session seç".
- Adımların sırası önemliyse gerekçesini aynı satırda yaz ("IDE-283'ü kullanma —
  o session şu an canlı, çakışır").
- Bir grup, tek satırlık \`Patlarsa:\` notuyla kapanabilir — ilk bakılacak yer.
  Bir cümleyi geçmesin.

### Format

- Senaryoları feature alanına göre \`## Başlık\` ile grupla.
- Her checkbox maddesi = bir gözlemlenebilir adım. İkinci şahıs emir kipi kullan.
- Sıra: setup → aksiyon → beklenen sonuç.
- Her madde mümkünse tek satıra sığsın, ama belirsizlik pahasına kısaltma. Beklenen
  sonuç açık değilse açıkça yaz.
- UI elementlerini görünen label'larıyla belirt, CSS selector değil.
- İç implementasyon jargonu (DB kolon adı, internal fonksiyon adı) gerekmedikçe girme.

### İyi örnek (bu stile uy)

\`\`\`
## Temel akış
- [ ] IDE-282'yi aç, header'daki terminal ikonuna tıkla. Tek satır çıkmalı:
  \`83e1174a…\`, \`terminal\` etiketiyle.
- [ ] Kopyala'ya bas, ~/vibecode/ideafy içinde yeni bir terminale yapıştır.
  Dünkü konuşma açılmalı.
- [ ] Popover'da bu kez terminal butonuna bas. Terminal uygulaman aynı
  konuşmayla açılmalı, Ideafy'da "Resumed in CLI" bildirimi çıkmalı.

Patlarsa: boş oturum geliyorsa sebep neredeyse kesin cwd — session'ın kayıtlı
\`cwd\`'siyle terminalin gerçekte açıldığı dizini karşılaştır.
\`\`\`

### Kötü örnek (bu stilde yazma)

- [ ] mergeTestCheckState işaretli state'i koruyor.   // soyut, aksiyon yok
- [ ] Dropdown'da None + tüm team'ler listeleniyor.   // spec, test adımı değil
- [ ] Kartın teamId'si yoksa value === 'none'          // implementation iddiası
- [ ] Doğru çalışıyor.                                  // gözlemlenebilir değil
- [ ] Session'ı olan bir kart aç.                       // placeholder — kartın adını yaz`;

export function buildTestStyleContract(opts: TestStyleOptions = {}): string {
  const lang = opts.language;
  const body = lang === "tr" ? STYLE_CONTRACT_TR : STYLE_CONTRACT_EN;

  const languageRule = lang
    ? `\n\n**Language:** Write every scenario in ${lang === "tr" ? "Turkish" : "English"}. Do not mix languages.`
    : `\n\n**Language:** Mirror the card's language — if the title/description is Turkish, write scenarios in Turkish; otherwise English. Do not mix languages.`;

  return body + languageRule;
}

/**
 * Very lightweight heuristic: Turkish-specific characters or common stopwords
 * in the first ~300 chars of card title+description flip the language to `tr`.
 * Defaults to `en`. Not a real language detector — just enough to pick the
 * right side of the style contract.
 */
export function detectCardLanguage(card: {
  title?: string | null;
  description?: string | null;
}): "tr" | "en" {
  const text = `${card.title ?? ""} ${card.description ?? ""}`.slice(0, 300);
  if (!text.trim()) return "en";

  if (/[çğıöşü]/i.test(text)) return "tr";

  const stopwordCount = (
    text.toLowerCase().match(/\b(ve|bu|bir|için|ile|daha|ama|veya|ancak|nasıl|neden|olmalı|gerekir|göre)\b/g) || []
  ).length;
  if (stopwordCount >= 2) return "tr";

  return "en";
}

/**
 * Convenience: detect language from card and return the contract string in
 * one call. Use this from prompt builders that receive a full card object.
 */
export function buildTestStyleContractForCard(card: {
  title?: string | null;
  description?: string | null;
}): string {
  return buildTestStyleContract({ language: detectCardLanguage(card) });
}
