import test from "node:test";
import assert from "node:assert/strict";

import * as applyNs from "../../lib/apply-content";

// See run-output.test.ts: lib/ modules come back through the CJS interop.
function interop<T extends object>(ns: T): T {
  return (ns as { default?: T }).default ?? ns;
}

const { extractApplicableContent, hasApplyBlock } = interop(applyNs);

// IDE-319: an unmarked reply shaped like the IDE-316 one that started the card —
// narration, a divider, the plan, then a divider and a closing offer.
const UNMARKED_REPLY = `AI Opinion alanını okumaya çalışıyorum… Şimdi local API'yi deniyorum.

Opinion'ı buldum. İki noktada ayrılıyorum:

1. Hatalı biten işler için ayrı bir tür yok.

Aşağıdaki revize planı **Replace** ile uygulayabilirsin:

---

# Uygulama Notificationları: Uygulama Planı

Bu kart OS seviyesinde bildirim ekliyor.

## Adımlar

- background-processes.tsx'e tetikleyici ekle.

[COMPLEXITY: low]
[PRIORITY: medium]

---

İstersen Faz 2 kartını şimdi Backlog'a açabilirim.`;

test("unmarked reply: intro and the closing offer both stay in the chat", () => {
  const r = extractApplicableContent(UNMARKED_REPLY, "solution");
  assert.ok(r.content.startsWith("# Uygulama Notificationları: Uygulama Planı"));
  assert.ok(r.content.endsWith("[PRIORITY: medium]"));
  assert.ok(!r.content.includes("Faz 2 kartını"));
  assert.ok(!r.content.includes("okumaya çalışıyorum"));
  assert.equal(r.trimmedIntro, true);
  assert.equal(r.trimmedOutro, true);
});

test("a reply that opens with its heading still loses the closing remark", () => {
  const r = extractApplicableContent("# Plan\n\nAdım bir.\n\n---\n\nBaşka bir şey ister misin?", "solution");
  assert.equal(r.content, "# Plan\n\nAdım bir.");
  assert.equal(r.trimmedIntro, false);
  assert.equal(r.trimmedOutro, true);
});

test("a dangling divider at the end is dropped", () => {
  const r = extractApplicableContent("# Plan\n\nAdım bir.\n\n---\n", "solution");
  assert.equal(r.content, "# Plan\n\nAdım bir.");
});

test("structured content after the last divider is kept", () => {
  const cases = [
    "# Plan\n\nAdım bir.\n\n---\n\n## Edge Cases\n\nBoş alan.",
    "# Plan\n\nAdım bir.\n\n---\n\n- madde bir\n- madde iki",
    "# Plan\n\nAdım bir.\n\n---\n\n[COMPLEXITY: low]\n[PRIORITY: medium]",
    "# Plan\n\nAdım bir.\n\n---\n\n| a | b |\n|---|---|",
  ];
  for (const input of cases) {
    const r = extractApplicableContent(input, "solution");
    assert.equal(r.content, input, input);
    assert.equal(r.trimmedOutro, false);
  }
});

test("a long paragraph after the divider is content, not a remark", () => {
  const input = `# Plan\n\nAdım bir.\n\n---\n\n${"Uzun bir kapanış bölümü. ".repeat(30)}`.trim();
  assert.equal(extractApplicableContent(input, "solution").content, input);
});

test("a setext underline and a divider inside a code fence are not dividers", () => {
  const setext = "# Plan\n\nAlt başlık\n---\n\nKısa not.";
  assert.equal(extractApplicableContent(setext, "solution").content, setext);

  const fenced = "# Plan\n\n```yaml\n---\nkey: value\n```";
  assert.equal(extractApplicableContent(fenced, "solution").content, fenced);
});

test("a marked block is taken as-is, with the remark outside it", () => {
  const r = extractApplicableContent(
    "Planı revize ettim.\n\n<!-- ideafy:apply -->\n# Plan\n\nAdım bir.\n<!-- /ideafy:apply -->\n\nİstersen Faz 2 kartını açabilirim.",
    "solution",
  );
  assert.equal(r.content, "# Plan\n\nAdım bir.");
  assert.equal(r.trimmedIntro, true);
});

test("a short answer without a heading is applied whole", () => {
  const input = "Açıklamanın ilk cümlesi: Replace artık yalnızca planı uygular.\n\n---\n\nBaşka bir şey?";
  const r = extractApplicableContent(input, "detail");
  assert.equal(r.content, input);
  assert.equal(r.trimmedOutro, false);
});

test("tests section: checkbox lines after a divider are kept", () => {
  const input = "Şu senaryoları öneriyorum:\n\n- [ ] Birinci adım\n\n---\n\n- [ ] İkinci adım";
  const r = extractApplicableContent(input, "tests");
  assert.equal(r.content, "- [ ] Birinci adım\n\n---\n\n- [ ] İkinci adım");
});

// IDE-343: a Tests reply that recorded a result with save_tests can still
// offer a new scenario — the explicit block is what keeps Apply visible.
test("hasApplyBlock sees an explicit apply block and nothing else", () => {
  assert.equal(
    hasApplyBlock("İkinci maddeyi işaretledim.\n\n<!-- ideafy:apply -->\n- [ ] Yeni adım\n<!-- /ideafy:apply -->"),
    true
  );
  assert.equal(hasApplyBlock("İkinci maddeyi işaretledim.\n\n- [ ] Yeni adım"), false);
});
