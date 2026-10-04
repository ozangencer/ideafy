import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { marked } from "marked";

import * as linksNs from "../../lib/artifact-links";
import * as urlNs from "../../lib/artifact-url";

// See run-output.test.ts: lib/ modules come back through the CJS interop.
function interop<T extends object>(ns: T): T {
  return (ns as { default?: T }).default ?? ns;
}

const { persistArtifactLinks, persistArtifacts, destinationFor, cardArtifactDir, persistCardArtifacts, materializeArtifactFences } =
  interop(linksNs);
const { fileUrlToPath, pathToFileUrl, artifactHtmlToMarkdownLinks, codePathsToFileLinks, codePathsToArtifactChips } =
  interop(urlNs);

// IDE-369: an artifact approved in a tab chat is linked as file://… in the
// applied content. Apply copies it out of the temp folder into the card's own
// folder and rewrites the link, so the chip keeps opening after macOS cleans
// /var/folders.

function makeTree() {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "ideafy-artifacts-")));
  const scratch = join(root, "scratch");
  const cardDir = join(root, "card");
  mkdirSync(scratch);
  mkdirSync(cardDir);
  return { root, scratch, cardDir, cleanup: () => rmSync(root, { recursive: true, force: true }) };
}

const link = (p: string, text = "mockup") => `<p><a href="${pathToFileUrl(p)}">${text}</a></p>`;

test("a temp-folder artifact is copied into the card folder and the link follows it", () => {
  const t = makeTree();
  try {
    const source = join(t.scratch, "bugün mockup.html");
    writeFileSync(source, "<h1>mockup</h1>");

    const out = persistArtifactLinks(link(source), t.cardDir);

    const copy = join(t.cardDir, "bugün mockup.html");
    assert.equal(readFileSync(copy, "utf8"), "<h1>mockup</h1>");
    assert.equal(out, link(copy));
    assert.equal(fileUrlToPath(pathToFileUrl(copy)), copy);
  } finally {
    t.cleanup();
  }
});

test("a file already inside the card folder is left alone", () => {
  const t = makeTree();
  try {
    const inside = join(t.cardDir, "mock.html");
    writeFileSync(inside, "x");
    const html = link(inside);

    assert.equal(persistArtifactLinks(html, t.cardDir), html);
    assert.deepEqual(readdirSync(t.cardDir), ["mock.html"]);
  } finally {
    t.cleanup();
  }
});

test("a link to a missing file stays as written and copies nothing", () => {
  const t = makeTree();
  try {
    const html = link(join(t.scratch, "gone.html"));

    assert.equal(persistArtifactLinks(html, t.cardDir), html);
    assert.deepEqual(readdirSync(t.cardDir), []);
  } finally {
    t.cleanup();
  }
});

test("two different files with one name get -2; the same file applied twice is reused", () => {
  const t = makeTree();
  try {
    mkdirSync(join(t.scratch, "a"));
    mkdirSync(join(t.scratch, "b"));
    const first = join(t.scratch, "a", "mock.html");
    const second = join(t.scratch, "b", "mock.html");
    writeFileSync(first, "first");
    writeFileSync(second, "second");

    persistArtifactLinks(link(first), t.cardDir);
    const out = persistArtifactLinks(link(second), t.cardDir);
    const again = persistArtifactLinks(link(first), t.cardDir);

    assert.equal(out, link(join(t.cardDir, "mock-2.html")));
    assert.equal(readFileSync(join(t.cardDir, "mock-2.html"), "utf8"), "second");
    assert.equal(again, link(join(t.cardDir, "mock.html")));
    assert.deepEqual(readdirSync(t.cardDir).sort(), ["mock-2.html", "mock.html"]);
  } finally {
    t.cleanup();
  }
});

test("apply stores the link as a chip, and prompt text turns the chip back into a file link", () => {
  const t = makeTree();
  try {
    const source = join(t.scratch, "mock.html");
    writeFileSync(source, "x");

    const stored = persistArtifacts(link(source, "Bugün sütunu"), t.cardDir);
    const copy = join(t.cardDir, "mock.html");

    assert.match(stored, /data-type="artifactMention"/);
    assert.match(stored, new RegExp(`data-path="${copy}"`));
    assert.match(stored, />Bugün sütunu<\/span>/);
    assert.equal(
      artifactHtmlToMarkdownLinks(stored),
      `<p>[Bugün sütunu](${pathToFileUrl(copy)})</p>`,
    );
  } finally {
    t.cleanup();
  }
});

test("only absolute local file URLs resolve to a path", () => {
  assert.equal(fileUrlToPath("file:///Users/a/b%20c.html"), "/Users/a/b c.html");
  assert.equal(fileUrlToPath("file://localhost/tmp/x.png"), "/tmp/x.png");
  assert.equal(fileUrlToPath("file://server/share/x"), null);
  assert.equal(fileUrlToPath("https://claude.ai/x"), null);
  assert.equal(pathToFileUrl("/tmp/a#b.html"), "file:///tmp/a%23b.html");
});

test("a backticked file path is persisted and stored as a chip like a file:// link", () => {
  const { scratch, cardDir, cleanup } = makeTree();
  try {
    const source = join(scratch, "mini.html");
    writeFileSync(source, "<h1>mini</h1>");
    const html =
      `<p>Dosya yolu: <code>${source}</code> ve <code>app/globals.css</code> ve <code>/api/open-file</code></p>` +
      `<pre><code>${source}</code></pre>`;

    const result = persistArtifacts(codePathsToFileLinks(html, "/home/me"), cardDir);

    assert.deepEqual(readdirSync(cardDir), ["mini.html"]);
    assert.ok(result.includes(`data-path="${join(cardDir, "mini.html")}"`));
    assert.ok(result.includes("<code>app/globals.css</code>"), "relative paths stay code");
    assert.ok(result.includes("<code>/api/open-file</code>"), "route-like code stays code");
    assert.ok(result.includes(`<pre><code>${source}</code></pre>`), "code blocks stay code");
  } finally {
    cleanup();
  }
});

test("~/ paths expand to the home folder at apply, and stay as written in the read-only view", () => {
  const html = "<p><code>~/notes/a b.md</code></p>";
  assert.equal(
    codePathsToFileLinks(html, "/home/me"),
    '<p><a href="file:///home/me/notes/a%20b.md">a b.md</a></p>',
  );
  assert.ok(codePathsToArtifactChips(html).includes('data-path="~/notes/a b.md"'));
});

// IDE-394: chat writes throwaway files to <cardDir>/scratch, which the sweep
// clears a week after the card completes. Applying one approves it, so it
// moves to the card root and the link follows.

test("a scratch file is copied to the card root on apply; applying it twice keeps one copy", () => {
  const t = makeTree();
  try {
    mkdirSync(join(t.cardDir, "scratch"));
    const source = join(t.cardDir, "scratch", "voices.out");
    writeFileSync(source, "three voices");

    const out = persistArtifactLinks(link(source), t.cardDir);
    const again = persistArtifactLinks(link(source), t.cardDir);

    const copy = join(t.cardDir, "voices.out");
    assert.equal(out, link(copy));
    assert.equal(again, link(copy));
    assert.equal(readFileSync(copy, "utf8"), "three voices");
    assert.deepEqual(readdirSync(t.cardDir).sort(), ["scratch", "voices.out"]);
  } finally {
    t.cleanup();
  }
});

test("a scratch file whose name is taken at the root by a different file gets -2", () => {
  const t = makeTree();
  try {
    mkdirSync(join(t.cardDir, "scratch"));
    writeFileSync(join(t.cardDir, "mock.html"), "approved earlier");
    const source = join(t.cardDir, "scratch", "mock.html");
    writeFileSync(source, "new draft");

    const out = persistArtifactLinks(link(source), t.cardDir);

    assert.equal(out, link(join(t.cardDir, "mock-2.html")));
    assert.equal(readFileSync(join(t.cardDir, "mock.html"), "utf8"), "approved earlier");
    assert.equal(readFileSync(join(t.cardDir, "mock-2.html"), "utf8"), "new draft");
  } finally {
    t.cleanup();
  }
});

test("destinationFor reuses a matching file and numbers a different one", () => {
  const t = makeTree();
  try {
    writeFileSync(join(t.cardDir, "mock.html"), "a");

    assert.equal(destinationFor("mock.html", t.cardDir, () => true), join(t.cardDir, "mock.html"));
    assert.equal(destinationFor("mock.html", t.cardDir, () => false), join(t.cardDir, "mock-2.html"));
    assert.equal(destinationFor("new.html", t.cardDir, () => false), join(t.cardDir, "new.html"));
  } finally {
    t.cleanup();
  }
});

// IDE-404: the MCP's save_opinion and save_plan run Apply's artifact pass, so
// a mockup made in a terminal session is kept in the card folder too. The
// MCP server finds that folder from the home directory alone.

const CARD_ID = "596a657e-c279-4a19-b654-7482ed32ebc8";

function makeHome() {
  const home = realpathSync(mkdtempSync(join(tmpdir(), "ideafy-home-")));
  const tmp = join(home, "tmp");
  mkdirSync(tmp);
  return { home, tmp, cardDir: join(home, ".ideafy", "images", CARD_ID), cleanup: () => rmSync(home, { recursive: true, force: true }) };
}

/** What save_opinion / save_plan store, short of the [[ card links: markdown → HTML → artifact pass. */
function saveViaMcp(markdown: string, home: string): string {
  const withFiles = materializeArtifactFences(markdown, cardArtifactDir(CARD_ID, home));
  return persistCardArtifacts(marked.parse(withFiles) as string, CARD_ID, home);
}

test("the card folder is ~/.ideafy/images/<cardId>", () => {
  assert.equal(cardArtifactDir(CARD_ID, "/home/me"), `/home/me/.ideafy/images/${CARD_ID}`);
});

test("a /tmp mockup linked from a terminal opinion is copied into a card folder that did not exist yet", () => {
  const h = makeHome();
  try {
    const source = join(h.tmp, "kuyruk mockup.html");
    writeFileSync(source, "<h1>mockup</h1>");

    const stored = saveViaMcp(`## Summary Verdict\n[VERDICT: yes] — ok\n\n[Kuyruk mockup](${pathToFileUrl(source)})`, h.home);
    const copy = join(h.cardDir, "kuyruk mockup.html");

    assert.equal(readFileSync(copy, "utf8"), "<h1>mockup</h1>");
    assert.match(stored, /data-type="artifactMention"/);
    assert.ok(stored.includes(`data-path="${copy}"`), "the chip points at the card folder, not /tmp");
    assert.match(stored, />Kuyruk mockup<\/span>/);
  } finally {
    h.cleanup();
  }
});

test("a backticked absolute path in a terminal plan is kept the same way", () => {
  const h = makeHome();
  try {
    const source = join(h.tmp, "plan.png");
    writeFileSync(source, "png");

    const stored = saveViaMcp(`Mockup: \`${source}\` and \`lib/artifact-links.ts\``, h.home);

    assert.deepEqual(readdirSync(h.cardDir), ["plan.png"]);
    assert.ok(stored.includes(`data-path="${join(h.cardDir, "plan.png")}"`));
    assert.ok(stored.includes("<code>lib/artifact-links.ts</code>"), "a repo path stays code");
  } finally {
    h.cleanup();
  }
});

test("an artifact block lands in scratch first, then in the card root as a chip", () => {
  const h = makeHome();
  try {
    const block = "```html artifact=\"queue.html\"\n<p>queue</p>\n```";
    const stored = saveViaMcp(`## Mockup\n${block}\n\nNotes.`, h.home);

    assert.equal(readFileSync(join(h.cardDir, "scratch", "queue.html"), "utf8"), "<p>queue</p>\n");
    assert.equal(readFileSync(join(h.cardDir, "queue.html"), "utf8"), "<p>queue</p>\n");
    assert.ok(stored.includes(`data-path="${join(h.cardDir, "queue.html")}"`));
    assert.doesNotMatch(stored, /artifact=/, "the block itself is not stored on the card");
  } finally {
    h.cleanup();
  }
});

test("an opinion without file links is left alone and makes no folder", () => {
  const h = makeHome();
  try {
    const html = "<p>Plain <code>app/page.tsx</code> opinion.</p>";
    assert.equal(persistCardArtifacts(html, CARD_ID, h.home), html);
    assert.equal(readdirSync(h.home).includes(".ideafy"), false);
  } finally {
    h.cleanup();
  }
});
