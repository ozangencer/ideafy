import test from "node:test";
import assert from "node:assert/strict";
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  symlinkSync,
  realpathSync,
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openDatabase } from "../db.js";
import {
  OutputPathError,
  parseOutputPaths,
  recordOutputPath,
  resolveOutputPath,
} from "../output-paths.js";
import { hasColumn } from "../schema-caps.js";
import { buildPhasePolicyBody } from "../shared.js";

// save_output's contract: the file exists, it is a file, and it sits under the
// card's project folder once every symlink is resolved. Everything else is
// refused with a message that says what to do. The DB half must also cope
// with an app that has not run the output_paths migration yet — the plugin
// and the app update independently.

function makeTree() {
  const root = mkdtempSync(join(tmpdir(), "ideafy-output-paths-"));
  const project = join(root, "project");
  mkdirSync(join(project, "docs"), { recursive: true });
  writeFileSync(join(project, "docs", "tutanak.md"), "# Tutanak\n");
  writeFileSync(join(project, "notlar.md"), "notlar\n");
  writeFileSync(join(root, "outside.md"), "outside\n");
  // A link inside the project that escapes it.
  symlinkSync(join(root, "outside.md"), join(project, "link.md"));
  return { root, project };
}

test("resolveOutputPath: relative and absolute paths inside the project store the same relative path", () => {
  const { root, project } = makeTree();
  try {
    const viaRelative = resolveOutputPath(project, "docs/tutanak.md");
    const viaAbsolute = resolveOutputPath(project, join(project, "docs", "tutanak.md"));
    assert.equal(viaRelative.relativePath, "docs/tutanak.md");
    assert.equal(viaAbsolute.relativePath, "docs/tutanak.md");
    assert.equal(viaRelative.absolutePath, realpathSync(join(project, "docs", "tutanak.md")));
    assert.equal(viaAbsolute.absolutePath, viaRelative.absolutePath);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("resolveOutputPath: a file outside the project folder is refused", () => {
  const { root, project } = makeTree();
  try {
    assert.throws(
      () => resolveOutputPath(project, join(root, "outside.md")),
      (err: unknown) =>
        err instanceof OutputPathError && /Outside the project folder/.test(err.message)
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("resolveOutputPath: a symlink inside the project that points outside is refused, and says so", () => {
  const { root, project } = makeTree();
  try {
    assert.throws(
      () => resolveOutputPath(project, "link.md"),
      (err: unknown) =>
        err instanceof OutputPathError &&
        /Outside the project folder/.test(err.message) &&
        /through a symlink/.test(err.message)
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("resolveOutputPath: missing files, directories and an empty path are refused with distinct messages", () => {
  const { root, project } = makeTree();
  try {
    assert.throws(
      () => resolveOutputPath(project, "docs/yok.md"),
      (err: unknown) => err instanceof OutputPathError && /File not found/.test(err.message)
    );
    assert.throws(
      () => resolveOutputPath(project, "docs"),
      (err: unknown) => err instanceof OutputPathError && /Not a file/.test(err.message)
    );
    assert.throws(
      () => resolveOutputPath(project, "   "),
      (err: unknown) => err instanceof OutputPathError && /needs a path/.test(err.message)
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("parseOutputPaths tolerates null, garbage and mixed arrays", () => {
  assert.deepEqual(parseOutputPaths(null), []);
  assert.deepEqual(parseOutputPaths(""), []);
  assert.deepEqual(parseOutputPaths("not json"), []);
  assert.deepEqual(parseOutputPaths('{"a":1}'), []);
  assert.deepEqual(parseOutputPaths('["docs/a.md", 1, null, "b.md"]'), ["docs/a.md", "b.md"]);
});

function makeDb(opts: { withColumn: boolean }) {
  const db = openDatabase(":memory:");
  db.exec(`
    CREATE TABLE projects (id TEXT PRIMARY KEY, folder_path TEXT);
    CREATE TABLE cards (
      id TEXT PRIMARY KEY,
      project_id TEXT,
      project_folder TEXT,
      ${opts.withColumn ? "output_paths TEXT," : ""}
      updated_at TEXT NOT NULL
    );
  `);
  return db;
}

test("recordOutputPath: without the column it refuses with an 'update the app' message, and notices the column once it appears", () => {
  const { root, project } = makeTree();
  const db = makeDb({ withColumn: false });
  try {
    db.prepare(`INSERT INTO projects (id, folder_path) VALUES ('p1', ?)`).run(project);
    db.prepare(
      `INSERT INTO cards (id, project_id, project_folder, updated_at) VALUES ('c1', 'p1', ?, '2026-01-01')`
    ).run(project);

    assert.equal(hasColumn(db, "cards", "output_paths"), false);
    assert.throws(
      () => recordOutputPath(db, "c1", "docs/tutanak.md"),
      (err: unknown) =>
        err instanceof OutputPathError && /Update the Ideafy app/.test(err.message)
    );

    // The app migrates while this server is still running: a miss is
    // re-probed, so the very next call sees the column.
    db.exec(`ALTER TABLE cards ADD output_paths TEXT`);
    assert.equal(hasColumn(db, "cards", "output_paths"), true);
    const outcome = recordOutputPath(db, "c1", "docs/tutanak.md");
    assert.deepEqual(outcome.outputPaths, ["docs/tutanak.md"]);
  } finally {
    db.close();
    rmSync(root, { recursive: true, force: true });
  }
});

test("recordOutputPath: appends once per file, keeps order, and stores project-relative JSON", () => {
  const { root, project } = makeTree();
  const db = makeDb({ withColumn: true });
  try {
    db.prepare(`INSERT INTO projects (id, folder_path) VALUES ('p1', ?)`).run(project);
    db.prepare(
      `INSERT INTO cards (id, project_id, project_folder, updated_at) VALUES ('c1', 'p1', '/stale/folder', '2026-01-01')`
    ).run();

    const first = recordOutputPath(db, "c1", "docs/tutanak.md");
    assert.equal(first.alreadyRecorded, false);
    assert.deepEqual(first.outputPaths, ["docs/tutanak.md"]);

    // Same file through an absolute path: no duplicate.
    const again = recordOutputPath(db, "c1", join(project, "docs", "tutanak.md"));
    assert.equal(again.alreadyRecorded, true);
    assert.deepEqual(again.outputPaths, ["docs/tutanak.md"]);

    const second = recordOutputPath(db, "c1", "notlar.md");
    assert.deepEqual(second.outputPaths, ["docs/tutanak.md", "notlar.md"]);

    const row = db.prepare(`SELECT output_paths, updated_at FROM cards WHERE id = 'c1'`).get() as {
      output_paths: string;
      updated_at: string;
    };
    assert.deepEqual(JSON.parse(row.output_paths), ["docs/tutanak.md", "notlar.md"]);
    assert.notEqual(row.updated_at, "2026-01-01");

    // The project's folder_path is what the file is checked against — the
    // card's own project_folder above is stale on purpose.
    assert.throws(
      () => recordOutputPath(db, "c1", join(root, "outside.md")),
      (err: unknown) => err instanceof OutputPathError && /Outside the project folder/.test(err.message)
    );
    assert.throws(
      () => recordOutputPath(db, "nope", "docs/tutanak.md"),
      (err: unknown) => err instanceof OutputPathError && /Card not found/.test(err.message)
    );
  } finally {
    db.close();
    rmSync(root, { recursive: true, force: true });
  }
});

// A Work project has no repo, so the two git-only clauses — the branch clause
// and the "Card: IDE-n" commit trailer — must not be handed to its sessions.
// Development keeps both, and callers that pass no mode get development.
test("buildPhasePolicyBody: work mode drops the branch and commit-trailer clauses, development keeps them", () => {
  const card = { id: "c1", title: "Kick-off tutanağı", status: "progress", displayId: "IDE-1" };
  const branchPolicy = { enforced: true, targetBranch: "kanban/IDE-1-kick-off" };

  const development = buildPhasePolicyBody(card, branchPolicy, "development");
  const implicit = buildPhasePolicyBody(card, branchPolicy);
  const work = buildPhasePolicyBody(card, branchPolicy, "work");

  assert.ok(development && implicit && work);
  assert.equal(implicit, development);
  assert.match(development, /Card: IDE-1/);
  assert.match(development, /branch "kanban\/IDE-1-kick-off"/);
  assert.doesNotMatch(work, /Card: IDE-1/);
  assert.doesNotMatch(work, /kanban\/IDE-1-kick-off/);
  // The header and the phase instruction itself are still there in both modes.
  assert.match(work, /Ideafy card: c1/);
  assert.match(work, /propose save_tests/);
  assert.match(development, /propose save_tests/);
});
