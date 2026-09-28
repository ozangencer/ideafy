import test from "node:test";
import assert from "node:assert/strict";

import * as runErrorNs from "../../lib/run-error";

// See run-output.test.ts: lib/ modules may come back through the CJS interop.
function interop<T extends object>(ns: T): T {
  return (ns as { default?: T }).default ?? ns;
}

const { describeRunError, firstLine } = interop(runErrorNs);

test("run error: strips ANSI codes and keeps the message", () => {
  const error = new Error("Claude Code exited with code 1: \x1b[31mError: ENOENT\x1b[0m\n");
  assert.equal(describeRunError(error), "Claude Code exited with code 1: Error: ENOENT");
});

test("run error: an empty stderr reads as such, not as a dangling colon", () => {
  assert.equal(
    describeRunError(new Error("Claude Code exited with code 1: ")),
    "Claude Code exited with code 1 (no stderr output)",
  );
});

test("run error: timeouts and non-Error throws pass through", () => {
  assert.equal(describeRunError(new Error("Claude Code timed out after 20 minutes")), "Claude Code timed out after 20 minutes");
  assert.equal(describeRunError("spawn claude ENOENT"), "spawn claude ENOENT");
  assert.equal(describeRunError(undefined), "The run failed without an error message.");
});

test("run error: long output keeps the first line and the tail", () => {
  const body = Array.from({ length: 2000 }, (_, i) => `line ${i}`).join("\n");
  const out = describeRunError(new Error(`Claude Code exited with code 1: head\n${body}\nREAL CAUSE`));
  assert.ok(out.length <= 4096, `length ${out.length}`);
  assert.ok(out.startsWith("Claude Code exited with code 1: head"));
  assert.ok(out.includes("(truncated)"));
  assert.ok(out.endsWith("REAL CAUSE"));
});

test("run error: firstLine skips blank lines and caps the length", () => {
  assert.equal(firstLine("\n\n  first  \nsecond"), "first");
  assert.equal(firstLine(null), "");
  assert.equal(firstLine("x".repeat(200), 10), `${"x".repeat(9)}…`);
});
