import type { Db } from "./db.js";
import { existsSync, realpathSync, statSync } from "fs";
import { homedir } from "os";
import { isAbsolute, relative, resolve, sep } from "path";

// save_output over MCP: the file-delivery contract for a Work card. A run
// that produced a document, a draft or a note calls it with the file's path,
// and the card keeps the path — relative to the project folder — under
// `cards.output_paths` (a JSON array). The app only reads that column; this
// module is the one writer.
//
// Two things are checked before anything is written. The file must exist,
// and it must sit under the card's project folder once every symlink on the
// way is resolved: a link inside the project that points at ~/Desktop is
// still ~/Desktop. Paths are kept relative so a project folder the user
// later moves (Work projects are plain folders, and folders get reorganised)
// does not turn every recorded output into a dead pointer.

export class OutputPathError extends Error {}

const knownColumns = new WeakMap<Db, Set<string>>();

// Whether `table` has `column`, by PRAGMA. The plugin can run against a DB
// the app has not migrated yet — the two update independently, in either
// order — so a column this server needs is asked for, not assumed.
//
// A hit is cached for the life of the connection: a column does not go away
// without a destructive migration. A miss is re-probed on every call, so an
// app updated while this server was already running is noticed on the next
// attempt rather than at the next restart. table_info on one table costs
// microseconds.
export function hasColumn(db: Db, table: string, column: string): boolean {
  const key = `${table}.${column}`;
  let known = knownColumns.get(db);
  if (!known) {
    known = new Set();
    knownColumns.set(db, known);
  }
  if (known.has(key)) return true;

  const rows = db
    .prepare(`PRAGMA table_info(${JSON.stringify(table)})`)
    .all() as Array<{ name: string }>;
  const present = rows.some((row) => row.name === column);
  if (present) known.add(key);
  return present;
}

// The stored JSON, tolerating null, an empty string and anything that is not
// an array of strings — a hand-edited row or a stranger's backup must not
// take save_output down with it.
export function parseOutputPaths(value: unknown): string[] {
  if (typeof value !== "string" || !value) return [];
  try {
    const parsed = JSON.parse(value) as unknown;
    return Array.isArray(parsed)
      ? parsed.filter((entry): entry is string => typeof entry === "string")
      : [];
  } catch {
    return [];
  }
}

export interface ResolvedOutputPath {
  // As stored on the card: relative to the project folder, forward slashes.
  relativePath: string;
  // The file's real location, every symlink resolved.
  absolutePath: string;
}

// Turn whatever the caller passed — absolute, relative to the project, or
// ~-prefixed — into the path the card stores, or throw an OutputPathError
// that says which check failed and what to do about it.
export function resolveOutputPath(projectFolder: string, inputPath: string): ResolvedOutputPath {
  const trimmed = (inputPath ?? "").trim();
  if (!trimmed) {
    throw new OutputPathError("save_output needs a path to the file that was written.");
  }

  const expanded =
    trimmed === "~" || trimmed.startsWith("~/")
      ? resolve(homedir(), trimmed.slice(2))
      : trimmed;
  const absolute = isAbsolute(expanded) ? resolve(expanded) : resolve(projectFolder, expanded);

  let projectReal: string;
  try {
    projectReal = realpathSync(projectFolder);
  } catch {
    throw new OutputPathError(
      `The card's project folder does not exist on this machine: ${projectFolder}. Nothing was recorded.`
    );
  }

  if (!existsSync(absolute)) {
    throw new OutputPathError(
      `File not found: ${absolute}. save_output records a file that already exists — write it first, then call save_output again.`
    );
  }

  // realpath follows every link in the path, so a symlink inside the project
  // that points outside resolves to its outside target and fails the
  // containment check below.
  const fileReal = realpathSync(absolute);

  if (!statSync(fileReal).isFile()) {
    throw new OutputPathError(
      `Not a file: ${absolute}. save_output records one file at a time — call it once per file.`
    );
  }

  if (!fileReal.startsWith(projectReal + sep)) {
    const via = fileReal !== absolute ? ` (it resolves to ${fileReal} through a symlink)` : "";
    throw new OutputPathError(
      `Outside the project folder: ${absolute}${via}. save_output only records files under ${projectFolder} — ` +
        `write the deliverable into the project folder, then call save_output again. Nothing was recorded.`
    );
  }

  return {
    relativePath: relative(projectReal, fileReal).split(sep).join("/"),
    absolutePath: fileReal,
  };
}

export interface RecordOutputResult extends ResolvedOutputPath {
  // Every path on the card after this call, in the order they were recorded.
  outputPaths: string[];
  // True when the file was already on the list and nothing was written.
  alreadyRecorded: boolean;
}

// Validate `inputPath` against the card's project folder and append it to
// the card's list, once. `cardId` must already be a resolved UUID.
export function recordOutputPath(
  db: Db,
  cardId: string,
  inputPath: string
): RecordOutputResult {
  if (!hasColumn(db, "cards", "output_paths")) {
    throw new OutputPathError(
      "This Ideafy app does not store output paths yet (cards.output_paths is missing). " +
        "Update the Ideafy app — it adds the column on its next start — then call save_output again. Nothing was recorded."
    );
  }

  const card = db
    .prepare(
      `SELECT project_id as projectId, project_folder as projectFolder, output_paths as outputPaths
       FROM cards WHERE id = ?`
    )
    .get(cardId) as
    | { projectId: string | null; projectFolder: string | null; outputPaths: string | null }
    | undefined;
  if (!card) throw new OutputPathError(`Card not found: ${cardId}`);

  const project = card.projectId
    ? (db.prepare(`SELECT folder_path as folderPath FROM projects WHERE id = ?`).get(card.projectId) as
        | { folderPath: string | null }
        | undefined)
    : undefined;
  const projectFolder = project?.folderPath || card.projectFolder || "";
  if (!projectFolder) {
    throw new OutputPathError(
      "This card has no project folder, so there is nothing to record the file against. Attach the card to a project first."
    );
  }

  const resolved = resolveOutputPath(projectFolder, inputPath);
  const existing = parseOutputPaths(card.outputPaths);
  if (existing.includes(resolved.relativePath)) {
    return { ...resolved, outputPaths: existing, alreadyRecorded: true };
  }

  const outputPaths = [...existing, resolved.relativePath];
  db.prepare(`UPDATE cards SET output_paths = ?, updated_at = ? WHERE id = ?`).run(
    JSON.stringify(outputPaths),
    new Date().toISOString(),
    cardId
  );
  return { ...resolved, outputPaths, alreadyRecorded: false };
}
