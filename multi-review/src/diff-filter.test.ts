import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { filterDiff } from "./diff-filter.js";

/** Helper: build a minimal `diff --git` section for a given filename. */
function diffSection(name: string, body: string): string {
  return `diff --git a/${name} b/${name}\nindex 0000000..1111111 100644\n--- a/${name}\n+++ b/${name}\n${body}`;
}

describe("filterDiff", () => {
  it("returns unchanged diff when no lock files present", () => {
    const diff =
      diffSection("src/main.ts", "@@ -1,3 +1,4 @@\n+new line\n") +
      diffSection("src/utils.ts", "@@ -5,2 +5,3 @@\n+helper\n");
    const { filtered, removedFiles } = filterDiff(diff);
    assert.equal(removedFiles.length, 0);
    assert.ok(filtered.includes("src/main.ts"));
    assert.ok(filtered.includes("src/utils.ts"));
  });

  it("filters pnpm-lock.yaml", () => {
    const diff =
      diffSection("pnpm-lock.yaml", "@@ -1,1000 +1,1000 @@\n...\n") +
      diffSection("src/main.ts", "@@ -1,1 +1,2 @@\n+fix\n");
    const { filtered, removedFiles } = filterDiff(diff);
    assert.deepEqual(removedFiles, ["pnpm-lock.yaml"]);
    assert.ok(!filtered.includes("pnpm-lock.yaml"));
    assert.ok(filtered.includes("src/main.ts"));
  });

  it("filters bun.lock", () => {
    const diff =
      diffSection("bun.lock", "@@ -1,100 +1,200 @@\n...\n") +
      diffSection("src/app.ts", "@@ -1,1 +1,1 @@\n-foo\n+bar\n");
    const { filtered, removedFiles } = filterDiff(diff);
    assert.deepEqual(removedFiles, ["bun.lock"]);
    assert.ok(filtered.includes("src/app.ts"));
  });

  it("filters package-lock.json", () => {
    const diff =
      diffSection("package-lock.json", "@@ -1,500 +1,600 @@\n...\n") +
      diffSection("src/index.ts", "@@ -1,1 +1,1 @@\n-x\n+y\n");
    const { filtered, removedFiles } = filterDiff(diff);
    assert.deepEqual(removedFiles, ["package-lock.json"]);
    assert.ok(filtered.includes("src/index.ts"));
  });

  it("filters yarn.lock", () => {
    const diff =
      diffSection("yarn.lock", "@@ -1,200 +1,300 @@\n...\n") +
      diffSection("src/foo.ts", "@@ -1,1 +1,2 @@\n+a\n");
    const { filtered, removedFiles } = filterDiff(diff);
    assert.deepEqual(removedFiles, ["yarn.lock"]);
    assert.ok(filtered.includes("src/foo.ts"));
  });

  it("filters *.lock files generically", () => {
    const diff =
      diffSection("some-tool.lock", "@@ -1,1 +1,1 @@\n...\n") +
      diffSection("src/lib.ts", "@@ -1,1 +1,2 @@\n+b\n");
    const { filtered, removedFiles } = filterDiff(diff);
    assert.deepEqual(removedFiles, ["some-tool.lock"]);
    assert.ok(filtered.includes("src/lib.ts"));
  });

  it("filters ecosystem lock files (Cargo.lock, Gemfile.lock, etc.)", () => {
    const files = ["Cargo.lock", "Gemfile.lock", "uv.lock", "poetry.lock", "composer.lock", "go.sum", "flake.lock", "Pipfile.lock", "requirements.lock"];
    for (const name of files) {
      const diff =
        diffSection(name, "@@ -1,1 +1,1 @@\n...\n") +
        diffSection("src/real.ts", "@@ -1,1 +1,2 @@\n+c\n");
      const { filtered, removedFiles } = filterDiff(diff);
      assert.deepEqual(removedFiles, [name], `expected ${name} to be filtered`);
      assert.ok(filtered.includes("src/real.ts"), `real file should be kept when filtering ${name}`);
    }
  });

  it("filters *.lockb files", () => {
    const diff =
      diffSection("bun.lockb", "Binary files differ\n") +
      diffSection("src/main.ts", "@@ -1,1 +1,1 @@\n-x\n+y\n");
    const { filtered, removedFiles } = filterDiff(diff);
    assert.deepEqual(removedFiles, ["bun.lockb"]);
  });

  it("keeps files that contain 'lock' in the name but are not lock files", () => {
    const diff =
      diffSection("src/block.ts", "@@ -1,1 +1,2 @@\n+line\n") +
      diffSection("src/clock-utils.ts", "@@ -1,1 +1,1 @@\n-x\n+y\n");
    const { filtered, removedFiles } = filterDiff(diff);
    assert.equal(removedFiles.length, 0);
    assert.ok(filtered.includes("src/block.ts"));
    assert.ok(filtered.includes("src/clock-utils.ts"));
  });

  it("removes lock files from nested paths", () => {
    const diff =
      diffSection("subdir/pnpm-lock.yaml", "@@ -1,1 +1,1 @@\n...\n") +
      diffSection("deep/nested/yarn.lock", "@@ -1,1 +1,1 @@\n...\n") +
      diffSection("src/main.ts", "@@ -1,1 +1,2 @@\n+fix\n");
    const { filtered, removedFiles } = filterDiff(diff);
    assert.deepEqual(removedFiles, ["pnpm-lock.yaml", "yarn.lock"]);
    assert.ok(filtered.includes("src/main.ts"));
  });

  it("returns empty filtered when diff contains only lock files", () => {
    const diff =
      diffSection("pnpm-lock.yaml", "@@ -1,1000 +1,1000 @@\n...\n") +
      diffSection("bun.lock", "@@ -1,500 +1,500 @@\n...\n");
    const { filtered, removedFiles } = filterDiff(diff);
    assert.deepEqual(removedFiles, ["pnpm-lock.yaml", "bun.lock"]);
    assert.equal(filtered, "");
  });

  it("handles empty diff string", () => {
    const { filtered, removedFiles } = filterDiff("");
    assert.equal(filtered, "");
    assert.deepEqual(removedFiles, []);
  });

  it("preserves valid non-lock files when lock files are filtered", () => {
    // The diff section boundaries should still be correct after filtering
    const mainBody = "@@ -1,3 +1,4 @@\n const x = 1;\n+const y = 2;\n const z = 3;";
    const diff =
      diffSection("yarn.lock", "@@ -1,1000 +1,1000 @@\n...\n") +
      diffSection("src/main.ts", mainBody);
    const { filtered } = filterDiff(diff);

    // Should contain exactly one diff section, no leading newline artifacts
    assert.ok(filtered.startsWith("diff --git "));
    assert.ok(filtered.includes("src/main.ts"));
    assert.ok(!filtered.includes("yarn.lock"));
  });

  it("handles diffs with no newline at end", () => {
    const diff = diffSection("pnpm-lock.yaml", "@@ -1,1 +1,1 @@\n...");
    const { filtered, removedFiles } = filterDiff(diff);
    assert.deepEqual(removedFiles, ["pnpm-lock.yaml"]);
    assert.equal(filtered, "");
  });
});
