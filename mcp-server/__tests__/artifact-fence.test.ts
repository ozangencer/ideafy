import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import * as fenceNs from "../../lib/artifact-fence";
import * as linksNs from "../../lib/artifact-links";
import * as urlNs from "../../lib/artifact-url";

// See run-output.test.ts: lib/ modules come back through the CJS interop.
function interop<T extends object>(ns: T): T {
  return (ns as { default?: T }).default ?? ns;
}

const { extractArtifactFences, collapseArtifactFences, sanitizeArtifactFilename, ARTIFACT_FENCE_MAX_BYTES } =
  interop(fenceNs);
const { materializeArtifactFences } = interop(linksNs);
const { pathToFileUrl } = interop(urlNs);

// IDE-397: a mockup arrives as ```html artifact="name.html" in the reply.
// Chat-stream saves it under the card's scratch/ folder and puts a link in
// its place, so no provider needs write access to produce one.

const mockup = (name: string, body = "<h1>mock</h1>") => `\`\`\`html artifact="${name}"\n${body}\n\`\`\``;

function makeCardDir() {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), "ideafy-fence-")));
  return { dir, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}

test("a closed artifact block is found with its name and body", () => {
  const text = `Before\n\n${mockup("onboarding.html", "<p>a</p>\n<p>b</p>")}\n\nAfter`;
  const [fence] = extractArtifactFences(text);

  assert.equal(fence.filename, "onboarding.html");
  assert.equal(fence.body, "<p>a</p>\n<p>b</p>");
  assert.equal(fence.closed, true);
  assert.equal(text.slice(fence.start, fence.end), mockup("onboarding.html", "<p>a</p>\n<p>b</p>"));
});

test("a block still streaming is open and runs to the end", () => {
  const text = 'Intro\n```html artifact="draft.html"\n<div>half';
  const [fence] = extractArtifactFences(text);

  assert.equal(fence.closed, false);
  assert.equal(fence.end, text.length);
  assert.equal(fence.body, "<div>half");
});

test("ordinary code fences, and artifact lines quoted inside them, are left alone", () => {
  const text = [
    "```html",
    "<p>example</p>",
    "```",
    "",
    "````md",
    mockup("quoted.html"),
    "````",
  ].join("\n");

  assert.deepEqual(extractArtifactFences(text), []);
  assert.equal(collapseArtifactFences(text), text);
});

test("the requested name is cut down to a safe basename", () => {
  assert.equal(sanitizeArtifactFilename("../../etc/x.html"), "x.html");
  assert.equal(sanitizeArtifactFilename("My Mockup.HTML"), "my-mockup.html");
  assert.equal(sanitizeArtifactFilename("chart", "svg"), "chart.svg");
  assert.equal(sanitizeArtifactFilename(".hidden"), "hidden.html");
  assert.equal(sanitizeArtifactFilename("payload.sh"), null);
});

test("a saved block becomes a link into scratch/ that points at the file", () => {
  const c = makeCardDir();
  try {
    const out = materializeArtifactFences(`See below.\n${mockup("../../evil/flow.html")}\n## Mockup`, c.dir);

    const target = join(c.dir, "scratch", "flow.html");
    assert.equal(out, `See below.\n[flow.html](${pathToFileUrl(target)})\n## Mockup`);
    assert.equal(readFileSync(target, "utf8"), "<h1>mock</h1>\n");
  } finally {
    c.cleanup();
  }
});

test("a revised mockup with the same name keeps the old file; an identical one is reused", () => {
  const c = makeCardDir();
  try {
    materializeArtifactFences(mockup("m.html", "v1"), c.dir);
    const again = materializeArtifactFences(mockup("m.html", "v1"), c.dir);
    const revised = materializeArtifactFences(mockup("m.html", "v2"), c.dir);

    assert.match(again, /scratch\/m\.html\)$/);
    assert.match(revised, /scratch\/m-2\.html\)$/);
    assert.deepEqual(readdirSync(join(c.dir, "scratch")).sort(), ["m-2.html", "m.html"]);
  } finally {
    c.cleanup();
  }
});

test("open, oversized and badly named blocks stay in the text and write nothing", () => {
  const c = makeCardDir();
  try {
    const open = '```html artifact="half.html"\n<div>';
    const huge = mockup("huge.html", "x".repeat(ARTIFACT_FENCE_MAX_BYTES + 1));
    const bad = mockup("run.sh");

    for (const text of [open, huge, bad]) {
      assert.equal(materializeArtifactFences(text, c.dir), text);
    }
    assert.deepEqual(readdirSync(c.dir).flatMap((d) => readdirSync(join(c.dir, d))), []);
  } finally {
    c.cleanup();
  }
});

test("while streaming the block shows as one status line", () => {
  assert.equal(
    collapseArtifactFences('Here:\n```html artifact="a.html"\n<p>hi</p>'),
    "Here:\n*Writing mockup · a.html · 9 B*",
  );
  assert.equal(collapseArtifactFences(`Here:\n${mockup("a.html", "<p>hi</p>")}\nDone`), "Here:\n*Saving mockup · a.html · 9 B*\nDone");
});

// prompt-builder pulls in @/ aliases this runner cannot resolve, so the
// wiring is checked against the source, as work-mode-prompts.test.ts does.
test("Detail, Opinion and Solution chats carry the mockup format; Tests does not", () => {
  const source = readFileSync(new URL("../../lib/ai/prompt-builder.ts", import.meta.url), "utf8");

  assert.match(source, /function buildArtifactLinkRule[\s\S]*?\$\{buildMockupRule\(ctx, section\)\}/);
  assert.match(source, /\\`\\`\\`html artifact="short-name\.html"/);
  for (const section of ["detail", "opinion", "solution"]) {
    assert.ok(source.includes(`buildArtifactLinkRule(ctx, "${section}")`), `${section} lost the artifact rule`);
  }
  assert.match(source, /buildToolUsageContext\("tests", ctx\.mode\)\}\$\{buildFileLinkRule\(ctx\)\}`/);
});
