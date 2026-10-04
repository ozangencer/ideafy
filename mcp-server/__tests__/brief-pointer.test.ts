import test from "node:test";
import assert from "node:assert/strict";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";

import * as pointerNs from "../../lib/brief-pointer";

// See run-output.test.ts: lib/ modules come back through the CJS interop.
function interop<T extends object>(ns: T): T {
  return (ns as { default?: T }).default ?? ns;
}

const { addBriefPointer, retargetBriefPointer, briefPointerLine, BRIEF_POINTER_MARKER } =
  interop(pointerNs);

const BRIEF = "docs/project-brief.md";

function tempFolder(files: Record<string, string> = {}): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "brief-pointer-"));
  for (const [name, content] of Object.entries(files)) {
    fs.writeFileSync(path.join(dir, name), content, "utf-8");
  }
  return dir;
}

const read = (dir: string, name: string) => fs.readFileSync(path.join(dir, name), "utf-8");

test("an empty folder gets a CLAUDE.md holding only the pointer", () => {
  const dir = tempFolder();
  assert.deepEqual(addBriefPointer(dir, BRIEF), { result: "added", file: "CLAUDE.md" });
  assert.equal(read(dir, "CLAUDE.md"), `${briefPointerLine(BRIEF)}\n`);
  assert.equal(fs.existsSync(path.join(dir, "AGENTS.md")), false);
});

test("the pointer is appended after a blank line and earlier content is kept byte for byte", () => {
  const before = "# Rules\n\nWrite in Turkish.";
  const dir = tempFolder({ "CLAUDE.md": before });
  addBriefPointer(dir, BRIEF);
  assert.equal(read(dir, "CLAUDE.md"), `${before}\n\n${briefPointerLine(BRIEF)}\n`);
});

test("a second call does not add the line again", () => {
  const dir = tempFolder({ "CLAUDE.md": "# Rules\n" });
  addBriefPointer(dir, BRIEF);
  const once = read(dir, "CLAUDE.md");
  assert.equal(addBriefPointer(dir, BRIEF).result, "exists");
  assert.equal(read(dir, "CLAUDE.md"), once);
});

test("a hand-written line naming the brief counts as the pointer", () => {
  const before = `Read ${BRIEF} first.\n`;
  const dir = tempFolder({ "CLAUDE.md": before });
  assert.equal(addBriefPointer(dir, BRIEF).result, "exists");
  assert.equal(read(dir, "CLAUDE.md"), before);
});

test("a folder with only AGENTS.md gets the pointer there", () => {
  const dir = tempFolder({ "AGENTS.md": "# Codex rules\n" });
  assert.deepEqual(addBriefPointer(dir, BRIEF), { result: "added", file: "AGENTS.md" });
  assert.ok(read(dir, "AGENTS.md").includes(BRIEF_POINTER_MARKER));
  assert.equal(fs.existsSync(path.join(dir, "CLAUDE.md")), false);
});

test("with both files present the pointer goes to CLAUDE.md only", () => {
  const dir = tempFolder({ "AGENTS.md": "# Codex\n", "CLAUDE.md": "# Claude\n" });
  assert.equal(addBriefPointer(dir, BRIEF).file, "CLAUDE.md");
  assert.equal(read(dir, "AGENTS.md"), "# Codex\n");
});

test("retarget rewrites only the marked line and leaves unmarked files alone", () => {
  const dir = tempFolder({
    "CLAUDE.md": `# Rules\n\n${briefPointerLine(BRIEF)}\n\nMore rules.\n`,
    "AGENTS.md": `Read ${BRIEF} first.\n`,
  });
  assert.deepEqual(retargetBriefPointer(dir, "notes/brief.md"), ["CLAUDE.md"]);
  assert.equal(read(dir, "CLAUDE.md"), `# Rules\n\n${briefPointerLine("notes/brief.md")}\n\nMore rules.\n`);
  assert.equal(read(dir, "AGENTS.md"), `Read ${BRIEF} first.\n`);
});

test("retarget does nothing when no file carries the marker", () => {
  const dir = tempFolder({ "CLAUDE.md": "# Rules\n" });
  assert.deepEqual(retargetBriefPointer(dir, "notes/brief.md"), []);
  assert.equal(read(dir, "CLAUDE.md"), "# Rules\n");
});
