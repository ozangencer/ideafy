/**
 * Shared style contract for test-scenario generation. Every prompt that asks
 * the AI to write `- [ ] …` scenarios (Chat UI Tests tab, terminal
 * test-together / generate-tests flows, autonomous start / quick-fix, and the
 * MCP save_tests tool description) MUST inject this contract so the output
 * voice stays consistent across entry points.
 *
 * Default voice: a manual tester / BA walking a solo founder through each
 * step — second-person imperative, setup → action → expected. Spec-style
 * assertion bullets are explicitly called out as the anti-pattern.
 */

export interface TestStyleOptions {
  /** ISO language code to force. If omitted, the AI must mirror the card's language. */
  language?: "tr" | "en";
}

const STYLE_CONTRACT_EN = `## Test scenario style (mandatory)

Write scenarios as a manual tester walking the user through the feature, not as
a spec of assertions. Each scenario must read like an instruction, not a fact.

Format:
- Group scenarios by feature area with \`## Heading\` per group.
- Each checkbox item = one observable step. Use second-person imperative.
- Prefer: setup → action → expected outcome, in that order.
- Keep each item short enough to fit on one line when possible, but never at
  the cost of ambiguity. If the expected result isn't obvious, spell it out.
- Mention UI elements by their visible labels, not CSS selectors.
- Avoid implementation jargon (DB column names, internal function names) unless
  the test genuinely requires them.

### Good examples (follow this style)

- [ ] Open a card that already has 2-3 checked scenarios. Go to the Tests tab.
- [ ] In chat, ask the assistant to reword one of the checked items. After the
  reply lands, reload the modal — the reworded item must still be \`[x]\`.
- [ ] Ask the assistant to wipe the list ("delete everything, keep one"). The
  save should fail with \`save_tests refused…\` and the list must stay intact.

### Bad examples (do not produce these)

- [ ] mergeTestCheckState preserves checked state on rewording.   // too abstract, no action
- [ ] Dropdown shows None + all teams.                             // spec, not a test step
- [ ] value === 'none' when card has no team                        // implementation assertion
- [ ] Works correctly.                                              // unobservable`;

const STYLE_CONTRACT_TR = `## Test senaryosu stil kuralları (zorunlu)

Senaryoları, kullanıcıyı feature'ı adım adım gezdiren bir manuel testçi gibi
yaz — assertion listesi gibi değil. Her madde bir gözlemlenebilir adım olmalı,
bir iddia değil.

Format:
- Senaryoları feature alanına göre \`## Başlık\` ile grupla.
- Her checkbox maddesi = bir gözlemlenebilir adım. İkinci şahıs emir kipi kullan.
- Sıra: setup → aksiyon → beklenen sonuç.
- Her madde mümkünse tek satıra sığsın, ama belirsizlik pahasına kısaltma. Beklenen
  sonuç açık değilse açıkça yaz.
- UI elementlerini görünen label'larıyla belirt, CSS selector değil.
- İç implementasyon jargonu (DB kolon adı, internal fonksiyon adı) gerekmedikçe girme.

### İyi örnek (bu stile uy)

- [ ] 2-3 maddesi işaretli bir kart aç. Tests sekmesine geç.
- [ ] Chat'te asistana "işaretli maddelerden birini farklı kelimelerle yaz" de.
  Cevap geldikten sonra modali tazele — yeniden yazılan madde hâlâ \`[x]\` olmalı.
- [ ] Asistana "tüm listeyi sil, yerine 1 satır koy" de. Kayıt \`save_tests refused…\`
  hatasıyla başarısız olmalı; liste olduğu gibi kalmalı.

### Kötü örnek (bu stilde yazma)

- [ ] mergeTestCheckState işaretli state'i koruyor.   // soyut, aksiyon yok
- [ ] Dropdown'da None + tüm team'ler listeleniyor.   // spec, test adımı değil
- [ ] Kartın teamId'si yoksa value === 'none'          // implementation iddiası
- [ ] Doğru çalışıyor.                                  // gözlemlenebilir değil`;

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
