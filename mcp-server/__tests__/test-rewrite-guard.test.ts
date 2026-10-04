import test from "node:test";
import assert from "node:assert/strict";
import { marked } from "marked";

import * as markdownNs from "../../lib/markdown";
import * as utilsNs from "../../lib/prompts/utils";

// See run-output.test.ts: lib/ modules come back through the CJS interop.
function interop<T extends object>(ns: T): T {
  return (ns as { default?: T }).default ?? ns;
}

const { assessTestRewrite, extractTaskItems, mergeTestCheckState } = interop(markdownNs);
const { convertToTipTapTaskList } = interop(utilsNs);

// What the editor stores after a human edits the Tests tab.
const EDITOR_HTML =
  '<h2>Temel akış</h2><ul data-type="taskList">' +
  '<li data-type="taskItem" data-checked="true"><label><input type="checkbox" checked="checked"><span></span></label><div><p>IDE-319\'u aç ve autonomous test\'i başlat</p></div></li>' +
  '<li data-type="taskItem" data-checked="false"><label><input type="checkbox"><span></span></label><div><p>Run\'ın bitmesini bekle</p></div></li>' +
  "</ul>";

// What a verify run's markdown becomes on the autonomous-run path.
async function runOutputHtml(md: string): Promise<string> {
  return convertToTipTapTaskList(await marked(md));
}

test("IDE-324: a verify run's checklist is read, not taken as empty", async () => {
  const html = await runOutputHtml(
    "## Temel akış\n- [x] IDE-319'u aç ve autonomous test'i başlat\n- [x] Run'ın bitmesini bekle\n",
  );
  const items = extractTaskItems(html);
  assert.equal(items.length, 2);
  assert.deepEqual(items.map((i) => i.checked), [true, true]);

  const assessment = assessTestRewrite(EDITOR_HTML, html);
  assert.equal(assessment.safe, true, assessment.reason);
  assert.equal(assessment.retained, 2);
});

test("IDE-324: a verify run that returns nothing checklist-shaped is still refused", async () => {
  const html = await runOutputHtml("Arka plan betiği tamamlandığında bildirim gelecek.");
  const assessment = assessTestRewrite(EDITOR_HTML, html);
  assert.equal(assessment.safe, false);
});

test("IDE-324: ticks already on the card survive a merge with run output", async () => {
  const html = await runOutputHtml(
    "## Temel akış\n- [ ] IDE-319'u aç ve autonomous test'i başlat\n- [ ] Run'ın bitmesini bekle\n",
  );
  const merged = mergeTestCheckState(EDITOR_HTML, html);
  assert.deepEqual(extractTaskItems(merged).map((i) => i.checked), [true, false]);
});

// The editor's real attribute order: data-checked before data-type (IDE-449).
const editorItem = (checked: boolean, text: string) =>
  `<li data-checked="${checked}" data-type="taskItem"><label><input type="checkbox"${checked ? ' checked="checked"' : ""}><span></span></label><div><p>${text}</p></div></li>`;

test("IDE-449: a checklist saved with data-checked first is still read", () => {
  const html = `<h2>Regresyon</h2><ul data-type="taskList">${editorItem(true, "Bir")}${editorItem(false, "İki")}</ul>`;
  assert.deepEqual(
    extractTaskItems(html).map((i) => i.checked),
    [true, false]
  );
});

test("IDE-449: a tick made during a run survives the run's write-back", async () => {
  // While the run worked, the person ticked the Regresyon item in the editor.
  const current =
    `<h2>Temel akış</h2><ul data-type="taskList">${editorItem(true, "Kartı aç")}</ul>` +
    `<h2>Kenar durumlar</h2><ul data-type="taskList">${editorItem(false, "Boş çeklist")}</ul>` +
    `<h2>Regresyon</h2><ul data-type="taskList">${editorItem(true, "Eski akış bozulmamalı")}</ul>`;
  // The agent passed the edge case but left the regression item unticked.
  const runOutput = await runOutputHtml(
    "## Temel akış\n- [x] Kartı aç\n## Kenar durumlar\n- [x] Boş çeklist\n## Regresyon\n- [ ] Eski akış bozulmamalı\n"
  );
  assert.equal(assessTestRewrite(current, runOutput).safe, true);
  assert.deepEqual(
    extractTaskItems(mergeTestCheckState(current, runOutput)).map((i) => [i.rawText, i.checked]),
    [
      ["Kartı aç", true],
      ["Boş çeklist", true],
      ["Eski akış bozulmamalı", true],
    ]
  );
});
