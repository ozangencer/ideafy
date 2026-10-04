import test from "node:test";
import assert from "node:assert/strict";
import { marked } from "marked";

import * as verifyFixNs from "../../lib/autonomous-run/verify-fix";
import * as markdownNs from "../../lib/markdown";
import * as utilsNs from "../../lib/prompts/utils";
import * as verifyFixPromptsNs from "../../lib/prompts/verify-fix";
import { readFileSync } from "node:fs";

// See run-output.test.ts: lib/ modules come back through the CJS interop.
function interop<T extends object>(ns: T): T {
  return (ns as { default?: T }).default ?? ns;
}

const {
  splitVerifyMarkers,
  matchFixTargets,
  locationFile,
  screenFixTargets,
  parsePorcelainPaths,
  parseCommitLog,
  checkFixCommits,
  parseFixSummary,
  resolveFixOutcomes,
  buildFixNoteHtml,
  REASON_STOPPED,
} = interop(verifyFixNs);
const { untickTaskItems, extractTaskItems } = interop(markdownNs);
const { convertToTipTapTaskList } = interop(utilsNs);
const {
  VERIFY_MARKERS_RULE,
  VERIFY_NO_CODE_CHANGES_RULE,
  REVERIFY_MARKERS_RULE,
  buildReverifyWhatToRun,
  buildVerifyFixPrompt,
} = interop(verifyFixPromptsNs);

const CHECKLIST_MD = `## Temel akış
- [x] Projeyi aç ve board'u yükle
- [ ] Kartı sürükleyince kuyruk sırası güncellenir
- [ ] Kuyruk chip'i Human Test kolonunda görünür

## Kenar durumlar
- [ ] Boş kuyrukta chip görünmez`;

async function html(md: string): Promise<string> {
  return convertToTipTapTaskList(await marked(md));
}

// ---------------------------------------------------------------------------
// Markers
// ---------------------------------------------------------------------------

test("markers: FIX, BLOCKED and REGRESSION lines come out, the checklist stays word for word", () => {
  const response = `${CHECKLIST_MD}

[FIX] Kartı sürükleyince kuyruk sırası güncellenir :: lib/kanban-store/slices/queue.ts:142 — reorder listesi undefined geliyor
- [BLOCKED] Kuyruk chip'i Human Test kolonunda görünür — dev server açılmadı
[REGRESSION] Projeyi aç ve board'u yükle — board boş açıldı`;

  const markers = splitVerifyMarkers(response);
  assert.equal(markers.checklist, CHECKLIST_MD);
  assert.deepEqual(markers.fixes, [
    {
      item: "Kartı sürükleyince kuyruk sırası güncellenir",
      location: "lib/kanban-store/slices/queue.ts:142",
      cause: "reorder listesi undefined geliyor",
    },
  ]);
  assert.deepEqual(markers.blocked, [
    { item: "Kuyruk chip'i Human Test kolonunda görünür", reason: "dev server açılmadı" },
  ]);
  assert.deepEqual(markers.regressions, [{ item: "Projeyi aç ve board'u yükle", reason: "board boş açıldı" }]);
});

test("markers: a sentence before the checklist does not reach the card", () => {
  const markers = splitVerifyMarkers(`Hedef maddeyi yeniden çalıştırdım, artık 10 yazdırıyor.\n\n${CHECKLIST_MD}`);
  assert.equal(markers.checklist, CHECKLIST_MD);
});

test("markers: a response without markers is the checklist itself", () => {
  const markers = splitVerifyMarkers(`${CHECKLIST_MD}\n`);
  assert.equal(markers.checklist, CHECKLIST_MD);
  assert.equal(markers.fixes.length + markers.blocked.length + markers.regressions.length, 0);
});

test("fix targets: a reworded item matches, an invented or ticked one is dropped, duplicates collapse", async () => {
  const checklist = await html(CHECKLIST_MD);
  const targets = matchFixTargets(
    [
      { item: "kartı sürükleyince kuyruk sırası güncellenir.", location: "a.ts:1", cause: "x" },
      { item: "Kartı sürükleyince kuyruk sırası güncellenir", location: "a.ts:2", cause: "again" },
      { item: "Ayarlar sayfası açılır", location: "b.ts:1", cause: "invented" },
      { item: "Projeyi aç ve board'u yükle", location: "c.ts:1", cause: "already ticked" },
    ],
    checklist
  );
  assert.deepEqual(
    targets.map((t) => [t.itemText, t.location]),
    [["Kartı sürükleyince kuyruk sırası güncellenir", "a.ts:1"]]
  );
});

// ---------------------------------------------------------------------------
// Git guards
// ---------------------------------------------------------------------------

test("location file: line suffixes, backticks, ./ and the repo root come off; outside paths do not count", () => {
  assert.equal(locationFile("lib/a.ts:42", "/repo"), "lib/a.ts");
  assert.equal(locationFile("`lib/a.ts:42-50`", "/repo"), "lib/a.ts");
  assert.equal(locationFile("./lib/a.ts#L7", "/repo"), "lib/a.ts");
  assert.equal(locationFile("/repo/lib/a.ts:3", "/repo/"), "lib/a.ts");
  assert.equal(locationFile("/elsewhere/a.ts", "/repo"), null);
  assert.equal(locationFile("", "/repo"), null);
});

test("screening: someone else's dirty file and files outside the card are skipped", () => {
  const target = (location: string) => ({ item: "x", itemText: location, location, cause: "" });
  const screened = screenFixTargets({
    targets: [target("lib/mine.ts:1"), target("lib/dirty.ts:1"), target("lib/other.ts:1"), target("")],
    repoRoot: "/repo",
    dirtyFiles: ["lib/dirty.ts"],
    cardFiles: ["lib/mine.ts", "lib/dirty.ts"],
  });
  assert.deepEqual(screened.eligible.map((t) => t.location), ["lib/mine.ts:1"]);
  assert.deepEqual(
    screened.skipped.map((s) => [s.reason, s.file]),
    [
      ["dirty", "lib/dirty.ts"],
      ["outside-card", "lib/other.ts"],
      ["no-location", null],
    ]
  );
});

test("porcelain: modified, untracked and both ends of a rename", () => {
  assert.deepEqual(parsePorcelainPaths(" M lib/a.ts\n?? notes.md\nR  old.ts -> new.ts\n"), [
    "lib/a.ts",
    "notes.md",
    "old.ts",
    "new.ts",
  ]);
});

test("commit check: a commit into a dirty file or outside the card is a violation; nothing else is", () => {
  const commits = parseCommitLog("\0abc1234\nlib/mine.ts\n\0def5678\nlib/mine.ts\nlib/dirty.ts\nlib/other.ts\n");
  assert.deepEqual(commits, [
    { sha: "abc1234", files: ["lib/mine.ts"] },
    { sha: "def5678", files: ["lib/mine.ts", "lib/dirty.ts", "lib/other.ts"] },
  ]);
  assert.deepEqual(
    checkFixCommits({ commits, dirtyBefore: ["lib/dirty.ts"], cardFiles: ["lib/mine.ts", "lib/dirty.ts"] }),
    [{ sha: "def5678", files: ["lib/dirty.ts", "lib/other.ts"] }]
  );
});

// ---------------------------------------------------------------------------
// The fix run's summary
// ---------------------------------------------------------------------------

test("fix summary: FIXED with its sha, NOT FIXED with its reason", () => {
  assert.deepEqual(
    parseFixSummary(`## Verify Fix Summary
FIXED Kartı sürükleyince kuyruk sırası güncellenir :: \`abc1234\`
- NOT FIXED Kuyruk chip'i görünür — neden kartın dosyaları dışında`),
    [
      { item: "Kartı sürükleyince kuyruk sırası güncellenir", fixed: true, sha: "abc1234", reason: "" },
      { item: "Kuyruk chip'i görünür", fixed: false, sha: null, reason: "neden kartın dosyaları dışında" },
    ]
  );
});

test("resolution: only a FIXED line with a real, clean commit goes to the re-verify", () => {
  const t = (itemText: string) => ({ item: itemText, itemText, location: "lib/a.ts:1", cause: "" });
  const targets = [t("Birinci madde çalışır"), t("İkinci madde çalışır"), t("Üçüncü madde çalışır"), t("Dördüncü madde çalışır"), t("Beşinci madde çalışır")];
  const resolution = resolveFixOutcomes({
    targets,
    outcomes: [
      { item: "Birinci madde çalışır", fixed: true, sha: "abc1234", reason: "" },
      { item: "İkinci madde çalışır", fixed: true, sha: "fff0000", reason: "" },
      { item: "Üçüncü madde çalışır", fixed: false, sha: null, reason: "büyük değişiklik" },
      { item: "Beşinci madde çalışır", fixed: true, sha: "def5678", reason: "" },
    ],
    commits: [
      { sha: "abc1234", files: ["lib/a.ts"] },
      { sha: "def5678", files: ["lib/other.ts"] },
    ],
    violations: [{ sha: "def5678", files: ["lib/other.ts"] }],
  });
  assert.deepEqual(
    resolution.committed.map((c) => [c.target.itemText, c.sha]),
    [["Birinci madde çalışır", "abc1234"]]
  );
  assert.deepEqual(
    resolution.notes.map((n) => n.kind),
    ["not-committed", "not-fixed", "not-fixed", "unverified", "violation"]
  );
});

test("resolution: with exactly one new commit, a FIXED line without a sha still counts", () => {
  const target = { item: "Madde çalışır", itemText: "Madde çalışır", location: "lib/a.ts:1", cause: "" };
  const resolution = resolveFixOutcomes({
    targets: [target],
    outcomes: [{ item: "Madde çalışır", fixed: true, sha: null, reason: "" }],
    commits: [{ sha: "abc1234", files: ["lib/a.ts"] }],
    violations: [],
  });
  assert.deepEqual(resolution.committed.map((c) => c.sha), ["abc1234"]);
});

// ---------------------------------------------------------------------------
// Writing back
// ---------------------------------------------------------------------------

test("untick: only the named item loses its tick, not every item containing the name", async () => {
  const checklist = await html(`## Temel akış
- [x] Kartı aç
- [x] Kartı aç ve başlığını değiştir
- [x] Kuyruğu başlat`);
  const after = extractTaskItems(untickTaskItems(checklist, ["Kartı aç"]));
  assert.deepEqual(
    after.map((i) => [i.rawText, i.checked]),
    [
      ["Kartı aç", false],
      ["Kartı aç ve başlığını değiştir", true],
      ["Kuyruğu başlat", true],
    ]
  );
});

test("note: Turkish and English wording, escaped, server reasons translated", () => {
  const notes = [
    { kind: "verified" as const, item: "Kart <b>açılır</b>", sha: "abc1234" },
    { kind: "skipped" as const, item: "Chip görünür", reason: "dirty" as const, file: "lib/a.ts" },
    { kind: "not-fixed" as const, item: "Sıra güncellenir", reason: REASON_STOPPED },
  ];
  const tr = buildFixNoteHtml(notes, "tr");
  assert.match(tr, /Otomatik düzeltme: «Kart &lt;b&gt;açılır&lt;\/b&gt;» — <code>abc1234<\/code>, yeniden doğrulandı\./);
  assert.match(tr, /<code>lib\/a\.ts<\/code> dosyasında commit'lenmemiş başka değişiklik var/);
  assert.match(tr, /«Sıra güncellenir» — koşu durduruldu/);
  const en = buildFixNoteHtml(notes, "en");
  assert.match(en, /Automatic fix: .*verified again\./);
  assert.match(en, /the run was stopped/);
  assert.equal(buildFixNoteHtml([], "tr"), "");
});

// ---------------------------------------------------------------------------
// Prompts
// ---------------------------------------------------------------------------

test("prompt: the verify phase splices in the markers, the re-verify and the no-code rule", () => {
  // lib/prompts.ts pulls in @/ aliases the test runner cannot resolve, so it
  // is read as text, the way run-output.test.ts guards its contracts.
  const source = readFileSync(new URL("../../lib/prompts.ts", import.meta.url), "utf8");
  const verifyBlock = source.slice(source.indexOf('case "verify"'));
  assert.match(verifyBlock, /buildReverifyWhatToRun\(reverifyItems\)/);
  assert.match(verifyBlock, /VERIFY_NO_CODE_CHANGES_RULE/);
  assert.match(verifyBlock, /REVERIFY_MARKERS_RULE/);
  assert.match(verifyBlock, /VERIFY_MARKERS_RULE/);
  // Work keeps its one free line: it has no code to fix.
  assert.match(verifyBlock, /isWork\s*\?\s*"- After the checklist, add one short line naming what blocked/);
});

test("prompt: the markers rule defines [FIX] narrowly and defaults to [BLOCKED]", () => {
  assert.match(VERIFY_MARKERS_RULE, /\[FIX\] <item, word for word> :: <file:line> — <cause/);
  assert.match(VERIFY_MARKERS_RULE, /When in doubt, it is `\[BLOCKED\]`/);
  assert.match(VERIFY_NO_CODE_CHANGES_RULE, /Do NOT change any code/);
  assert.match(REVERIFY_MARKERS_RULE, /\[REGRESSION\]/);
  assert.match(REVERIFY_MARKERS_RULE, /Do not write `\[FIX\]` lines/);
});

test("prompt: the re-verify names the fixed items and skips steps that must not run twice", () => {
  const text = buildReverifyWhatToRun(["Kartı sürükleyince kuyruk sırası güncellenir"]);
  assert.match(text, /- Kartı sürükleyince kuyruk sırası güncellenir/);
  assert.match(text, /skip any step that should not run twice/);
  assert.match(text, /Never untick a box yourself/);
});

test("prompt: the fix run is fenced to the card's files, stages by name, and lists the dirty files", () => {
  const prompt = buildVerifyFixPrompt({
    cardId: "card-1",
    title: "Kuyruk sırası",
    displayId: "IDE-1",
    inWorktree: false,
    targets: [{ item: "x", itemText: "Sıra güncellenir", location: "lib/a.ts:3", cause: "liste boş" }],
    allowedFiles: ["lib/a.ts"],
    dirtyFiles: ["lib/b.ts"],
  });
  assert.match(prompt, /«Sıra güncellenir» — lib\/a\.ts:3: liste boş/);
  assert.match(prompt, /NEVER `git add -u` or `git add -A`/);
  assert.match(prompt, /Card: IDE-1/);
  assert.match(prompt, /Do NOT create, switch, or check out a branch/);
  assert.match(prompt, /## Never touch these files\n.*\n- lib\/b\.ts/);
  assert.match(prompt, /## Verify Fix Summary/);
  assert.match(prompt, /never the expectation/);
});
