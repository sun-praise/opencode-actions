import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { validateGitRef, escapeHashReferences, resolvePRNumber } from "./platform.js";

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

describe("resolvePRNumber", () => {
  const envKeys = ["GITHUB_REF", "GITHUB_EVENT_NAME", "GITHUB_EVENT_PATH"];
  const saved: Record<string, string | undefined> = {};
  let tmpDir: string;

  beforeEach(() => {
    for (const k of envKeys) saved[k] = process.env[k];
    delete process.env.GITHUB_REF;
    delete process.env.GITHUB_EVENT_NAME;
    delete process.env.GITHUB_EVENT_PATH;
    tmpDir = mkdtempSync(join(tmpdir(), "resolve-pr-"));
  });

  afterEach(() => {
    for (const k of envKeys) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("parses GitHub refs/pull/N/merge", () => {
    process.env.GITHUB_REF = "refs/pull/123/merge";
    assert.equal(resolvePRNumber(), "123");
  });

  it("parses Gitea refs/pull/N/head", () => {
    process.env.GITHUB_REF = "refs/pull/456/head";
    assert.equal(resolvePRNumber(), "456");
  });

  it("returns null for non-PR refs", () => {
    process.env.GITHUB_REF = "refs/heads/main";
    assert.equal(resolvePRNumber(), null);
    process.env.GITHUB_REF = "refs/tags/v1.0.0";
    assert.equal(resolvePRNumber(), null);
  });

  it("returns null when GITHUB_REF is unset", () => {
    assert.equal(resolvePRNumber(), null);
  });

  it("falls back to pull_request.number in the event payload", () => {
    const eventPath = join(tmpDir, "event.json");
    writeFileSync(
      eventPath,
      JSON.stringify({ action: "opened", number: 789, pull_request: { number: 789 } }),
    );
    process.env.GITHUB_EVENT_NAME = "pull_request";
    process.env.GITHUB_EVENT_PATH = eventPath;
    assert.equal(resolvePRNumber(), "789");
  });

  it("does not mistake an issue number for a PR number", () => {
    const eventPath = join(tmpDir, "event.json");
    writeFileSync(eventPath, JSON.stringify({ action: "opened", number: 42 }));
    process.env.GITHUB_EVENT_NAME = "issues";
    process.env.GITHUB_EVENT_PATH = eventPath;
    assert.equal(resolvePRNumber(), null);
  });

  it("returns null when the event payload has no PR number", () => {
    const eventPath = join(tmpDir, "event.json");
    writeFileSync(eventPath, JSON.stringify({ action: "opened" }));
    process.env.GITHUB_EVENT_NAME = "pull_request";
    process.env.GITHUB_EVENT_PATH = eventPath;
    assert.equal(resolvePRNumber(), null);
  });

  it("returns null on an unreadable event payload", () => {
    process.env.GITHUB_EVENT_NAME = "pull_request";
    process.env.GITHUB_EVENT_PATH = join(tmpDir, "does-not-exist.json");
    assert.equal(resolvePRNumber(), null);
  });
});