/**
 * The pure half of a pre-verify's automatic fix (IDE-459): reading the
 * markers a verify run leaves under its checklist, deciding which fixes may
 * run, checking what the fix committed, and the note the card gets.
 *
 * The chain itself (runs, git, the DB) is verify-fix-chain.ts. Nothing here
 * touches the db, so the tests import it directly.
 *
 * The roles stay apart on purpose: verify only diagnoses, a separate run
 * fixes, and a third run — one that did not write the fix — ticks the box.
 */

import { closestTaskText, matchTaskItem } from "../markdown";

/** `[FIX] <item> :: <file:line> — <cause>`: a plain code bug, fixable in place. */
export interface VerifyFix {
  item: string;
  location: string;
  cause: string;
}

/** `[BLOCKED]` / `[REGRESSION] <item> — <reason>`. */
export interface VerifyNote {
  item: string;
  reason: string;
}

export interface VerifyMarkers {
  /** The response with every marker line taken out. */
  checklist: string;
  fixes: VerifyFix[];
  blocked: VerifyNote[];
  regressions: VerifyNote[];
}

const MARKER_LINE = /^\s*(?:[-*+]\s+)?\[(FIX|BLOCKED|REGRESSION)\]\s*(.*?)\s*$/i;

/** Split "item — reason" at the first dash that stands between words. */
function splitAtDash(text: string): [string, string] {
  const match = /\s+(?:—|–|--|-)\s+/.exec(text);
  if (!match) return [text.trim(), ""];
  return [text.slice(0, match.index).trim(), text.slice(match.index + match[0].length).trim()];
}

function unquote(text: string): string {
  return text.replace(/^[«"“'`]+|[»"”'`]+$/g, "").trim();
}

export function splitVerifyMarkers(markdown: string): VerifyMarkers {
  const fixes: VerifyFix[] = [];
  const blocked: VerifyNote[] = [];
  const regressions: VerifyNote[] = [];
  const kept: string[] = [];

  for (const line of markdown.split("\n")) {
    const match = MARKER_LINE.exec(line);
    if (!match) {
      kept.push(line);
      continue;
    }
    const kind = match[1].toUpperCase();
    const body = match[2];
    if (kind === "FIX") {
      const sep = body.indexOf("::");
      const item = unquote(sep === -1 ? splitAtDash(body)[0] : body.slice(0, sep));
      const [location, cause] = sep === -1 ? ["", splitAtDash(body)[1]] : splitAtDash(body.slice(sep + 2));
      if (item) fixes.push({ item, location: location.replace(/`/g, "").trim(), cause });
    } else {
      const [item, reason] = splitAtDash(body);
      const note = { item: unquote(item), reason };
      if (!note.item) continue;
      (kind === "BLOCKED" ? blocked : regressions).push(note);
    }
  }

  // A run sometimes opens with a sentence about what it did before the
  // checklist it was told to return alone; it is not part of the checklist.
  const firstHeading = kept.findIndex((line) => /^#{1,6}\s/.test(line));
  const checklist = (firstHeading > 0 ? kept.slice(firstHeading) : kept).join("\n").trimEnd();
  return { checklist, fixes, blocked, regressions };
}

/** A fix tied to the checklist item it names, in the checklist's own words. */
export interface FixTarget extends VerifyFix {
  itemText: string;
}

/**
 * Tie each `[FIX]` to a real, still unticked checklist item. One that names
 * nothing on the list, or an item already ticked, is dropped: a verify run
 * must not be able to start a fix by inventing a step.
 */
export function matchFixTargets(fixes: VerifyFix[], checklistHtml: string): FixTarget[] {
  const seen = new Set<string>();
  const targets: FixTarget[] = [];
  for (const fix of fixes) {
    const item = matchTaskItem(fix.item, checklistHtml);
    if (!item || item.checked || seen.has(item.normalized)) continue;
    seen.add(item.normalized);
    targets.push({ ...fix, itemText: item.rawText });
  }
  return targets;
}

/** The file a `[FIX]` location names, relative to the repo root. */
export function locationFile(location: string, repoRoot: string): string | null {
  let file = location.replace(/`/g, "").trim().split(/\s+/)[0] ?? "";
  // "lib/a.ts:42", "lib/a.ts:42-50", "lib/a.ts#L42"
  file = file.replace(/(?::\d+(?:[-:]\d+)*|#L\d+(?:-L?\d+)?)$/, "").replace(/^\.\//, "");
  if (!file) return null;
  const root = repoRoot.replace(/\/+$/, "");
  if (file.startsWith(`${root}/`)) file = file.slice(root.length + 1);
  return file.startsWith("/") ? null : file;
}

export type SkipReason = "dirty" | "outside-card" | "no-location";

export interface ScreenedFixes {
  eligible: FixTarget[];
  skipped: { target: FixTarget; reason: SkipReason; file: string | null }[];
}

/**
 * Which fixes may run. Not one whose file holds someone else's uncommitted
 * changes — that is another session's half-done work, and on main it shares
 * the folder — and not one outside the files this card's own work touched.
 */
export function screenFixTargets(args: {
  targets: FixTarget[];
  repoRoot: string;
  dirtyFiles: string[];
  cardFiles: string[];
}): ScreenedFixes {
  const dirty = new Set(args.dirtyFiles);
  const mine = new Set(args.cardFiles);
  const screened: ScreenedFixes = { eligible: [], skipped: [] };
  for (const target of args.targets) {
    const file = locationFile(target.location, args.repoRoot);
    if (!file) screened.skipped.push({ target, reason: "no-location", file });
    else if (dirty.has(file)) screened.skipped.push({ target, reason: "dirty", file });
    else if (!mine.has(file)) screened.skipped.push({ target, reason: "outside-card", file });
    else screened.eligible.push(target);
  }
  return screened;
}

/** Paths in `git status --porcelain` output; a rename counts as both ends. */
export function parsePorcelainPaths(porcelain: string): string[] {
  const paths: string[] = [];
  for (const line of porcelain.split("\n")) {
    if (line.length < 4) continue;
    const rest = line.slice(3);
    for (const part of rest.split(" -> ")) {
      const path = part.trim().replace(/^"|"$/g, "");
      if (path) paths.push(path);
    }
  }
  return paths;
}

export interface FixCommit {
  sha: string;
  files: string[];
}

/**
 * Commits from `git log --name-only --format=%x00%h`: each record starts with
 * a NUL and the short sha, then the files it changed.
 */
export function parseCommitLog(log: string): FixCommit[] {
  return log
    .split("\0")
    .map((record) => record.trim())
    .filter(Boolean)
    .map((record) => {
      const [sha, ...files] = record.split("\n").map((l) => l.trim()).filter(Boolean);
      return { sha, files };
    });
}

export interface CommitViolation {
  sha: string;
  files: string[];
}

/**
 * Commits the fix should not have made: into a file that held someone else's
 * uncommitted work, or outside this card's files. Nothing is reverted —
 * on main the commit may sit among other work — the person decides.
 */
export function checkFixCommits(args: {
  commits: FixCommit[];
  dirtyBefore: string[];
  cardFiles: string[];
}): CommitViolation[] {
  const dirty = new Set(args.dirtyBefore);
  const mine = new Set(args.cardFiles);
  return args.commits
    .map((commit) => ({
      sha: commit.sha,
      files: commit.files.filter((file) => dirty.has(file) || !mine.has(file)),
    }))
    .filter((violation) => violation.files.length > 0);
}

/** One line of the fix run's `## Verify Fix Summary`. */
export interface FixOutcome {
  item: string;
  fixed: boolean;
  sha: string | null;
  reason: string;
}

const SUMMARY_LINE = /^\s*(?:[-*+]\s+)?(NOT\s+FIXED|FIXED)\s+(.*?)\s*$/i;

export function parseFixSummary(markdown: string): FixOutcome[] {
  const outcomes: FixOutcome[] = [];
  for (const line of markdown.split("\n")) {
    const match = SUMMARY_LINE.exec(line);
    if (!match) continue;
    const fixed = !/^not/i.test(match[1]);
    const body = match[2];
    if (fixed) {
      const sep = body.lastIndexOf("::");
      const item = unquote(sep === -1 ? body : body.slice(0, sep));
      const sha = sep === -1 ? null : body.slice(sep + 2).replace(/`/g, "").trim().split(/\s+/)[0] || null;
      if (item) outcomes.push({ item, fixed, sha, reason: "" });
    } else {
      const [item, reason] = splitAtDash(body);
      if (item) outcomes.push({ item: unquote(item), fixed, sha: null, reason });
    }
  }
  return outcomes;
}

/** A fix the fix run reported as committed, with the commit it named. */
export interface CommittedFix {
  target: FixTarget;
  sha: string | null;
}

export interface FixResolution {
  /** Committed and clean: these go to the re-verify. */
  committed: CommittedFix[];
  notes: FixNote[];
}

/**
 * Read the fix run's summary against what git actually holds. A FIXED line
 * counts only with a commit behind it; an item the summary leaves out was not
 * fixed; a commit that broke the file rules keeps its item from the re-verify.
 */
export function resolveFixOutcomes(args: {
  targets: FixTarget[];
  outcomes: FixOutcome[];
  commits: FixCommit[];
  violations: CommitViolation[];
}): FixResolution {
  const resolution: FixResolution = { committed: [], notes: [] };
  const outcomeItems = args.outcomes.map((o) => o.item);
  const commitFor = (sha: string | null) =>
    sha ? args.commits.find((c) => c.sha.startsWith(sha) || sha.startsWith(c.sha)) ?? null : null;
  const violated = new Set(args.violations.map((v) => v.sha));

  for (const target of args.targets) {
    const index = closestTaskText(target.itemText, outcomeItems);
    const outcome = index === -1 ? null : args.outcomes[index];
    if (!outcome) {
      resolution.notes.push({ kind: "not-fixed", item: target.itemText, reason: "" });
      continue;
    }
    if (!outcome.fixed) {
      resolution.notes.push({ kind: "not-fixed", item: target.itemText, reason: outcome.reason });
      continue;
    }
    // A run that fixed several items in one commit may not name it per item;
    // with exactly one new commit there is no doubt which one it is.
    const commit = commitFor(outcome.sha) ?? (args.commits.length === 1 ? args.commits[0] : null);
    if (!commit) {
      resolution.notes.push({ kind: "not-committed", item: target.itemText });
      continue;
    }
    if (violated.has(commit.sha)) {
      // The violation line below names the commit; the item says why it
      // was not checked again.
      resolution.notes.push({ kind: "unverified", item: target.itemText, sha: commit.sha, reason: "" });
      continue;
    }
    resolution.committed.push({ target, sha: commit.sha });
  }

  for (const violation of args.violations) {
    resolution.notes.push({ kind: "violation", sha: violation.sha, files: violation.files });
  }
  return resolution;
}

// ------------------------------------------------------------------
// The note under the checklist
// ------------------------------------------------------------------

export type FixNote =
  | { kind: "verified"; item: string; sha: string | null }
  | { kind: "still-failing"; item: string; sha: string | null }
  | { kind: "unverified"; item: string; sha: string | null; reason: string }
  | { kind: "not-fixed"; item: string; reason: string }
  | { kind: "not-committed"; item: string }
  | { kind: "skipped"; item: string; reason: SkipReason; file: string | null }
  | { kind: "regression"; item: string; reason: string }
  | { kind: "violation"; sha: string; files: string[] }
  | { kind: "leftover"; files: string[] }
  | { kind: "blocked"; item: string; reason: string };

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function code(text: string): string {
  return `<code>${escapeHtml(text)}</code>`;
}

function quote(text: string): string {
  return `«${escapeHtml(text)}»`;
}

/** Reasons the server gives itself, worded per card language when shown. */
export const REASON_STOPPED = "@stopped";
export const REASON_GIT = "@git";

const REASON_TEXT: Record<string, { tr: string; en: string }> = {
  [REASON_STOPPED]: { tr: "koşu durduruldu", en: "the run was stopped" },
  [REASON_GIT]: { tr: "git durumu okunamadı", en: "the git state could not be read" },
};

function tail(reason: string, lang: "tr" | "en"): string {
  if (!reason) return "";
  const known = REASON_TEXT[reason];
  return ` — ${known ? known[lang] : escapeHtml(reason)}`;
}

function noteLine(note: FixNote, lang: "tr" | "en"): string {
  const tr = lang === "tr";
  switch (note.kind) {
    case "verified":
      return tr
        ? `Otomatik düzeltme: ${quote(note.item)}${note.sha ? ` — ${code(note.sha)}` : ""}, yeniden doğrulandı.`
        : `Automatic fix: ${quote(note.item)}${note.sha ? ` — ${code(note.sha)}` : ""}, verified again.`;
    case "still-failing":
      return tr
        ? `Otomatik düzeltme: ${quote(note.item)}${note.sha ? ` — ${code(note.sha)}` : ""} düzeltildi ama yeniden doğrulamada geçmedi.`
        : `Automatic fix: ${quote(note.item)}${note.sha ? ` — ${code(note.sha)}` : ""} was fixed but did not pass the second check.`;
    case "unverified":
      return tr
        ? `Otomatik düzeltme: ${quote(note.item)}${note.sha ? ` — ${code(note.sha)}` : ""} düzeltildi ama yeniden doğrulanamadı${tail(note.reason, lang)}.`
        : `Automatic fix: ${quote(note.item)}${note.sha ? ` — ${code(note.sha)}` : ""} was fixed but could not be checked again${tail(note.reason, lang)}.`;
    case "not-committed":
      return tr
        ? `Otomatik düzeltme yapılmadı: ${quote(note.item)} — düzeltme koşusu bunun için bir commit bırakmadı.`
        : `No automatic fix: ${quote(note.item)} — the fix run left no commit for it.`;
    case "not-fixed":
      return tr
        ? `Otomatik düzeltme yapılmadı: ${quote(note.item)}${tail(note.reason, lang)}`
        : `No automatic fix: ${quote(note.item)}${tail(note.reason, lang)}`;
    case "skipped": {
      const file = note.file ? code(note.file) : "";
      const why =
        note.reason === "dirty"
          ? tr
            ? `${file} dosyasında commit'lenmemiş başka değişiklik var`
            : `${file} holds someone else's uncommitted changes`
          : note.reason === "outside-card"
            ? tr
              ? `neden kartın dosyaları dışında (${file})`
              : `the cause is outside this card's files (${file})`
            : tr
              ? "teşhis bir dosya göstermiyor"
              : "the diagnosis names no file";
      return tr
        ? `Otomatik düzeltme yapılmadı: ${quote(note.item)} — ${why}.`
        : `No automatic fix: ${quote(note.item)} — ${why}.`;
    }
    case "regression":
      return tr
        ? `Regresyon: ${quote(note.item)} düzeltmeden sonra geçmedi${tail(note.reason, lang)}. Tiki kaldırıldı.`
        : `Regression: ${quote(note.item)} failed after the fix${tail(note.reason, lang)}. Its tick was removed.`;
    case "violation":
      return tr
        ? `Uyarı: düzeltme commit'i ${code(note.sha)} kartın dışındaki ya da başkasının değiştirdiği dosyalara dokundu: ${note.files.map(code).join(", ")}. Gözden geçir.`
        : `Warning: fix commit ${code(note.sha)} touched files outside this card or with someone else's changes: ${note.files.map(code).join(", ")}. Review it.`;
    case "leftover":
      return tr
        ? `Uyarı: düzeltme koşusu commit'lenmemiş değişiklik bıraktı: ${note.files.map(code).join(", ")}.`
        : `Warning: the fix run left uncommitted changes: ${note.files.map(code).join(", ")}.`;
    case "blocked":
      return tr
        ? `Açık kaldı: ${quote(note.item)}${tail(note.reason, lang)}`
        : `Left open: ${quote(note.item)}${tail(note.reason, lang)}`;
  }
}

/** The paragraphs that go under the checklist; "" when there is nothing to say. */
export function buildFixNoteHtml(notes: FixNote[], lang: "tr" | "en"): string {
  return notes.map((note) => `<p>${noteLine(note, lang)}</p>`).join("");
}
