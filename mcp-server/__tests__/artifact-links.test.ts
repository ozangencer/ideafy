import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import * as linksNs from "../../lib/artifact-links";
import * as urlNs from "../../lib/artifact-url";

// See run-output.test.ts: lib/ modules come back through the CJS interop.
function interop<T extends object>(ns: T): T {
  return (ns as { default?: T }).default ?? ns;
}

const { persistArtifactLinks, persistArtifacts } = interop(linksNs);
const { fileUrlToPath, pathToFileUrl, artifactHtmlToMarkdownLinks } = interop(urlNs);

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
