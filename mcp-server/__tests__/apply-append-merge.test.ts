import test from "node:test";
import assert from "node:assert/strict";

import * as markdownNs from "../../lib/markdown";

// See run-output.test.ts: lib/ modules come back through the CJS interop.
function interop<T extends object>(ns: T): T {
  return (ns as { default?: T }).default ?? ns;
}

const {
  ensureTestScenariosHtml,
  extractTaskItems,
  markdownToTiptapHtml,
  mergeHtmlSections,
  mergeTestCheckState,
  mergeTestMarkdownSections,
  testScenariosToMarkdown,
} = interop(markdownNs);

const item = (checked: boolean, text: string) =>
  `<li data-type="taskItem" data-checked="${checked}"><label><input type="checkbox"${checked ? ' checked="checked"' : ""}><span></span></label><div><p>${text}</p></div></li>`;

// IDE-332's Tests tab as the editor stored it, before the duplicate Regresyon.
const STORED_TESTS =
  "<h2>Temel akış</h2>" +
  `<ul data-type="taskList">${item(true, "IDE-332'yi aç, Enrich description'a bas")}${item(true, "Accept'e bas")}</ul>` +
  "<h2>Kenar durumlar</h2>" +
  `<ul data-type="taskList">${item(false, "Detail'e sadece iki harf yaz")}</ul>` +
  "<h2>Regresyon</h2>" +
  `<ul data-type="taskList">${item(false, "Başka bir kartta Start ya da Evaluate başlat")}${item(false, "IDE-332'yi aç, Detail'e bir cümle ekle")}</ul>`;

// Mirrors the append branch of app/api/cards/[id]/apply-message/route.ts.
function appendTests(storedHtml: string, content: string): { html: string; added: number } {
  const merged = mergeTestMarkdownSections(testScenariosToMarkdown(storedHtml), content);
  const html = mergeTestCheckState(storedHtml, ensureTestScenariosHtml(merged.markdown));
  return { html, added: merged.added };
}

function headings(html: string): string[] {
  return [...html.matchAll(/<h[1-6][^>]*>([\s\S]*?)<\/h[1-6]>/gi)].map((m) => m[1]);
}

function itemsUnder(html: string, heading: string): string[] {
  const start = html.indexOf(`>${heading}</h`);
  assert.ok(start >= 0, `heading ${heading} missing`);
  const rest = html.slice(start);
  const next = rest.slice(1).search(/<h[1-6]\b/i);
  const section = next >= 0 ? rest.slice(0, next + 1) : rest;
  // marked escapes apostrophes in rewritten items; compare the visible text.
  return extractTaskItems(section).map((i) => i.rawText.replace(/&#39;/g, "'"));
}

test("IDE-334: appending the same Regresyon block keeps one heading and two items", () => {
  const { html, added } = appendTests(
    STORED_TESTS,
    "## Regresyon\n\n- [ ] Başka bir kartta Start ya da Evaluate başlat\n- [ ] IDE-332'yi aç, Detail'e bir cümle ekle\n"
  );
  assert.equal(added, 0);
  assert.deepEqual(headings(html), ["Temel akış", "Kenar durumlar", "Regresyon"]);
  assert.equal(itemsUnder(html, "Regresyon").length, 2);
});

test("IDE-334: a new item lands inside the matching section, before the next one", () => {
  const stored = STORED_TESTS.replace(
    "<h2>Regresyon</h2>",
    `<h2>Regresyon</h2><ul data-type="taskList">${item(false, "A maddesi")}</ul><h2>Son</h2>`
  );
  const { html, added } = appendTests(stored, "### Regresyon:\n- [ ] C maddesi yeni\n");
  assert.equal(added, 1);
  assert.deepEqual(headings(html), ["Temel akış", "Kenar durumlar", "Regresyon", "Son"]);
  assert.deepEqual(itemsUnder(html, "Regresyon"), ["A maddesi", "C maddesi yeni"]);
});

test("IDE-334: an unknown heading goes to the end, checked items stay checked", () => {
  const { html, added } = appendTests(
    STORED_TESTS,
    "## Performans\n- [ ] 200 kartlı board'da sürükle bırak takılmamalı\n"
  );
  assert.equal(added, 2);
  assert.deepEqual(headings(html), ["Temel akış", "Kenar durumlar", "Regresyon", "Performans"]);
  const checked = extractTaskItems(html).filter((i) => i.checked).map((i) => i.rawText);
  assert.equal(checked.length, 2);
});

test("IDE-334: a duplicate item is skipped even under a different heading", () => {
  const { html, added } = appendTests(
    STORED_TESTS,
    "## Kenar durumlar\n- [ ] Accept'e bas\n- [ ] Yeni kenar durum\n"
  );
  assert.equal(added, 1);
  assert.deepEqual(itemsUnder(html, "Kenar durumlar"), ["Detail'e sadece iki harf yaz", "Yeni kenar durum"]);
  assert.equal(extractTaskItems(html).length, 6);
});

test("IDE-334: headingless items fall into the last section", () => {
  const { html } = appendTests(STORED_TESTS, "- [ ] Üçüncü regresyon maddesi\n");
  assert.equal(itemsUnder(html, "Regresyon").length, 3);
});

test("IDE-334: a paragraph appended under an existing Solution heading stays in it", () => {
  const stored =
    "<h2>Files to Modify</h2><p>lib/markdown.ts</p>" +
    "<h2>Edge Cases</h2><p>Boş içerik değişmez.</p>" +
    "<h2>Dependencies</h2><p>Yeni paket yok.</p>";
  const { html, added } = mergeHtmlSections(
    stored,
    markdownToTiptapHtml("## Edge Cases\n\nAynı başlık iki kez geçiyorsa sonuncusuna eklenir.\n\nBoş içerik değişmez.")
  );
  assert.equal(added, 1);
  assert.deepEqual(headings(html), ["Files to Modify", "Edge Cases", "Dependencies"]);
  const edge = html.slice(html.indexOf("Edge Cases"), html.indexOf("Dependencies"));
  assert.match(edge, /Aynı başlık iki kez geçiyorsa/);
  assert.equal(html.match(/Boş içerik değişmez/g)?.length, 1);
});

test("IDE-334: Solution append of an already-present block reports nothing new", () => {
  const stored = "<h2>Edge Cases</h2><p>Replace modu etkilenmez.</p>";
  const { html, added } = mergeHtmlSections(stored, markdownToTiptapHtml("## Edge Cases\n\nReplace modu etkilenmez."));
  assert.equal(added, 0);
  assert.equal(html, stored);
});
