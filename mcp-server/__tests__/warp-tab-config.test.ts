import test from "node:test";
import assert from "node:assert/strict";

import * as warpNs from "../../lib/terminal/warp";

// See run-output.test.ts: lib/ modules may come back through the CJS interop.
function interop<T extends object>(ns: T): T {
  return (ns as { default?: T }).default ?? ns;
}

const {
  buildWarpTabConfig,
  compareVersion,
  parseBundleVersion,
  WARP_TAB_CONFIG_MIN_VERSION,
} = interop(warpNs);

test("warp tab config: single terminal pane with directory and command", () => {
  const toml = buildWarpTabConfig({
    name: "Ideafy (temp)",
    cwd: "/Users/me/vibecode/ideafy",
    command: "/bin/bash '/tmp/ideafy-1-abc.sh'",
  });
  assert.equal(
    toml,
    [
      `name = "Ideafy (temp)"`,
      "",
      "[[panes]]",
      `id = "main"`,
      `type = "terminal"`,
      `directory = "/Users/me/vibecode/ideafy"`,
      `commands = ["/bin/bash '/tmp/ideafy-1-abc.sh'"]`,
      "is_focused = true",
      "",
    ].join("\n"),
  );
  assert.doesNotMatch(toml, /\[params\./);
  assert.doesNotMatch(toml, /^title/m);
});

test("warp tab config: title labels the tab, a templated one is dropped", () => {
  const toml = buildWarpTabConfig({
    name: "Ideafy (temp)",
    cwd: "/tmp",
    command: "c",
    title: `IDE-364 · Warp "tab"`,
  });
  assert.match(toml, /^name = "Ideafy \(temp\)"\ntitle = "IDE-364 · Warp \\"tab\\""\n\n\[\[panes\]\]/);
  const templated = buildWarpTabConfig({ name: "n", cwd: "/tmp", command: "c", title: "{{x}}" });
  assert.doesNotMatch(templated, /^title/m);
});

test("warp tab config: quotes, spaces and backslashes are escaped", () => {
  const cwd = `/Users/me/it's a "dir"\\x\u007f`;
  const toml = buildWarpTabConfig({ name: "n", cwd, command: "c" });
  const line = toml.split("\n").find((l) => l.startsWith("directory = "))!;
  assert.equal(
    line,
    `directory = "/Users/me/it's a \\"dir\\"\\\\x\\u007F"`,
  );
  // TOML basic string escapes are a superset of what we emit, so JSON reads
  // the value back unchanged.
  assert.equal(JSON.parse(line.slice("directory = ".length)), cwd);
});

test("warp tab config: a templated-looking cwd is left out", () => {
  const toml = buildWarpTabConfig({ name: "n", cwd: "/tmp/{{x}}", command: "c" });
  assert.doesNotMatch(toml, /directory/);
  assert.match(toml, /commands = \["c"\]/);
});

test("warp version: date-shaped builds compare numerically", () => {
  assert.equal(compareVersion("0.2026.09.16.08.27.02", WARP_TAB_CONFIG_MIN_VERSION), 1);
  assert.equal(compareVersion("0.2026.05.13.09.15.01", WARP_TAB_CONFIG_MIN_VERSION), -1);
  assert.equal(compareVersion("0.2025.12.30.08.00.00", WARP_TAB_CONFIG_MIN_VERSION), -1);
  assert.equal(compareVersion("0.2026.05.18.05.32.00", WARP_TAB_CONFIG_MIN_VERSION), 1);
  assert.equal(compareVersion("0.2026.05.18", "0.2026.05.18.00.00"), 0);
});

test("warp version: read from an Info.plist", () => {
  const plist = `<dict>
\t<key>CFBundleName</key>
\t<string>Warp</string>
\t<key>CFBundleShortVersionString</key>
\t<string>0.2026.09.16.08.27.02</string>
</dict>`;
  assert.equal(parseBundleVersion(plist), "0.2026.09.16.08.27.02");
  assert.equal(parseBundleVersion("<dict></dict>"), null);
});
