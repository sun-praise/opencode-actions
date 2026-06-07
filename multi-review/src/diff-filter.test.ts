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
    assert.deepEqual(removedFiles, ["subdir/pnpm-lock.yaml", "deep/nested/yarn.lock"]);
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

  // --- Configurable exclusion patterns ---

  it("excludes files matching custom glob patterns", () => {
    const diff =
      diffSection("src/api.generated.ts", "@@ -1,1 +1,1 @@\n...\n") +
      diffSection("src/main.ts", "@@ -1,1 +1,2 @@\n+fix\n");
    const { filtered, removedFiles } = filterDiff(diff, {
      excludePatterns: ["*.generated.ts"],
    });
    assert.deepEqual(removedFiles, ["src/api.generated.ts"]);
    assert.ok(filtered.includes("src/main.ts"));
    assert.ok(!filtered.includes("generated"));
  });

  it("excludes files in vendor directory with ** globstar", () => {
    const diff =
      diffSection("vendor/pkg/a.go", "@@ -1,1 +1,1 @@\n...\n") +
      diffSection("src/app.go", "@@ -1,1 +1,2 @@\n+fix\n");
    const { filtered, removedFiles } = filterDiff(diff, {
      excludePatterns: ["vendor/**"],
    });
    assert.deepEqual(removedFiles, ["vendor/pkg/a.go"]);
    assert.ok(filtered.includes("src/app.go"));
  });

  it("excludes files matching exact path", () => {
    const diff =
      diffSection("src/skip-me.ts", "@@ -1,1 +1,1 @@\n...\n") +
      diffSection("src/keep-me.ts", "@@ -1,1 +1,2 @@\n+fix\n");
    const { filtered, removedFiles } = filterDiff(diff, {
      excludePatterns: ["src/skip-me.ts"],
    });
    assert.deepEqual(removedFiles, ["src/skip-me.ts"]);
    assert.ok(filtered.includes("src/keep-me.ts"));
  });

  it("applies both lock patterns and custom exclude patterns", () => {
    const diff =
      diffSection("pnpm-lock.yaml", "@@ -1,1000 +1,1000 @@\n...\n") +
      diffSection("src/generated/api.pb.go", "@@ -1,1 +1,1 @@\n...\n") +
      diffSection("src/main.ts", "@@ -1,1 +1,2 @@\n+fix\n");
    const { filtered, removedFiles } = filterDiff(diff, {
      excludePatterns: ["src/generated/**"],
    });
    assert.equal(removedFiles.length, 2);
    assert.ok(removedFiles.includes("pnpm-lock.yaml"));
    assert.ok(removedFiles.includes("src/generated/api.pb.go"));
    assert.ok(filtered.includes("src/main.ts"));
  });

  // --- Size-based truncation ---

  it("truncates diff when maxSizeBytes is exceeded", () => {
    // Build a diff where each section is ~50 bytes
    const section1 = diffSection("src/a.ts", "@@ -1,1 +1,2 @@\n+" + "x".repeat(40) + "\n");
    const section2 = diffSection("src/b.ts", "@@ -1,1 +1,2 @@\n+" + "y".repeat(40) + "\n");
    const section3 = diffSection("src/c.ts", "@@ -1,1 +1,2 @@\n+" + "z".repeat(40) + "\n");
    const diff = section1 + section2 + section3;

    // Set max to fit only section1
    const section1Bytes = Buffer.byteLength(section1, "utf-8");
    const { filtered, truncated, filteredBytes } = filterDiff(diff, {
      maxSizeBytes: section1Bytes + 10, // a bit more than section1
    });

    assert.equal(truncated, true);
    assert.ok(filteredBytes! > 0);
    assert.ok(filtered.includes("src/a.ts"));
    assert.ok(!filtered.includes("src/c.ts"));
    assert.ok(filtered.includes("Diff truncated"));
  });

  it("does not truncate when diff fits within maxSizeBytes", () => {
    const diff = diffSection("src/main.ts", "@@ -1,1 +1,2 @@\n+fix\n");
    const { filtered, truncated } = filterDiff(diff, {
      maxSizeBytes: 1024 * 1024, // 1MB — way more than enough
    });
    assert.equal(truncated, undefined);
    assert.ok(filtered.includes("src/main.ts"));
  });

  it("truncation notice includes file count", () => {
    const section1 = diffSection("src/a.ts", "@@ -1,1 +1,2 @@\n+fix\n");
    const section2 = diffSection("src/b.ts", "@@ -1,1 +1,2 @@\n+fix\n");
    const diff = section1 + section2;

    const { filtered } = filterDiff(diff, {
      maxSizeBytes: Buffer.byteLength(section1, "utf-8") + 10,
    });
    assert.ok(filtered.includes("1 of 2 file sections"));
  });

  it("combines lock filtering, custom exclusion, and truncation", () => {
    const lockSection = diffSection("pnpm-lock.yaml", "@@ -1,1000 +1,1000 @@\n" + "x".repeat(500) + "\n");
    const genSection = diffSection("src/api.generated.ts", "@@ -1,1 +1,1 @@\n" + "y".repeat(500) + "\n");
    const realSection = diffSection("src/main.ts", "@@ -1,1 +1,2 @@\n+fix\n");
    const diff = lockSection + genSection + realSection;

    const { filtered, removedFiles, truncated } = filterDiff(diff, {
      excludePatterns: ["*.generated.ts"],
      maxSizeBytes: 500, // small — forces truncation after filtering
    });

    assert.ok(removedFiles.includes("pnpm-lock.yaml"));
    assert.ok(removedFiles.includes("src/api.generated.ts"));
    // realSection is small enough to fit
    assert.ok(filtered.includes("src/main.ts"));
  });

  it("**/pattern matches top-level file (gitignore semantics)", () => {
    const diff =
      diffSection("vendor", "@@ -1,1 +1,1 @@\n...\n") +
      diffSection("subdir/vendor", "@@ -1,1 +1,1 @@\n...\n") +
      diffSection("src/app.go", "@@ -1,1 +1,2 @@\n+fix\n");
    const { filtered, removedFiles } = filterDiff(diff, {
      excludePatterns: ["**/vendor"],
    });
    // **/vendor should match both top-level "vendor" and "subdir/vendor"
    assert.deepEqual(removedFiles.sort(), ["subdir/vendor", "vendor"]);
    assert.ok(filtered.includes("src/app.go"));
  });

  it("keeps at least the first section when it exceeds maxSizeBytes", () => {
    // One very large section that exceeds the budget
    const bigSection = diffSection("src/huge.ts", "@@ -1,1 +1,2 @@\n+" + "x".repeat(5000) + "\n");
    const { filtered, truncated } = filterDiff(bigSection, {
      maxSizeBytes: 100, // way smaller than the section
    });
    assert.equal(truncated, true);
    // Must still contain the first section — never send empty diff
    assert.ok(filtered.includes("src/huge.ts"));
    assert.ok(filtered.includes("Diff truncated"));
  });
});
