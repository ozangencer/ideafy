import test from "node:test";
import assert from "node:assert/strict";

import * as referencesNs from "../../lib/work-brief-references";

// See run-output.test.ts: lib/ modules come back through the CJS interop.
function interop<T extends object>(ns: T): T {
  return (ns as { default?: T }).default ?? ns;
}

const { referenceFromPath, referenceFromLink, displayReferencePath, serializeReferences } =
  interop(referencesNs);

const FOLDER = "/Users/me/Clients/Northwind";

test("a path inside the project folder is kept relative", () => {
  const ref = referenceFromPath(`${FOLDER}/contracts/SOW.pdf`, `${FOLDER}/`, "file");
  assert.deepEqual(ref, { path: "contracts/SOW.pdf", kind: "file", outside: false, note: "" });
});

test("a path outside the folder stays absolute and is marked outside", () => {
  const ref = referenceFromPath("/Users/me/OneDrive/RACI.xlsx", FOLDER, "file");
  assert.equal(ref?.path, "/Users/me/OneDrive/RACI.xlsx");
  assert.equal(ref?.outside, true);
});

test("a sibling folder sharing the prefix is not treated as inside", () => {
  const ref = referenceFromPath(`${FOLDER}-archive/old.docx`, FOLDER, "file");
  assert.equal(ref?.outside, true);
});

test("the project folder itself is not a reference", () => {
  assert.equal(referenceFromPath(FOLDER, FOLDER, "folder"), null);
});

test("only http(s) links are accepted", () => {
  assert.equal(referenceFromLink("https://northwind.sharepoint.com/SteerCo")?.kind, "link");
  assert.equal(referenceFromLink("file:///etc/passwd"), null);
  assert.equal(referenceFromLink("not a link"), null);
});

test("outside paths under home are shown with ~", () => {
  const ref = referenceFromPath("/Users/me/OneDrive/GRC", FOLDER, "folder")!;
  assert.equal(displayReferencePath(ref, "/Users/me"), "~/OneDrive/GRC/");
});

test("the serialized list keeps paths, the outside marker and notes", () => {
  const text = serializeReferences([
    { path: "SOW_Northwind_signed.pdf", kind: "file", outside: false, note: "Signed scope" },
    { path: "proposals", kind: "folder", outside: false, note: "  " },
    { path: "/Users/me/OneDrive/RACI.xlsx", kind: "file", outside: true, note: "Client RACI" },
    { path: "https://northwind.sharepoint.com/SteerCo", kind: "link", outside: false, note: "SteerCo decks" },
  ]);
  assert.equal(
    text,
    [
      "- SOW_Northwind_signed.pdf: Signed scope",
      "- proposals/",
      "- /Users/me/OneDrive/RACI.xlsx (outside the project folder): Client RACI",
      "- https://northwind.sharepoint.com/SteerCo: SteerCo decks",
    ].join("\n")
  );
});
