import { describe, it, before, after } from "node:test";
import assert from "node:assert";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  getContextCacheDir,
  loadReviewContext,
  saveReviewContext,
  formatPreviousContext,
  type ReviewContext,
  type ReviewSession,
} from "./context-cache.js";

const ORIGINAL_XDG = process.env.XDG_CACHE_HOME;
const ORIGINAL_REPO = process.env.GITHUB_REPOSITORY;

describe("context-cache", () => {
  let tempDir: string;

  before(() => {
    tempDir = mkdtempSync(join(tmpdir(), "context-cache-test-"));
    process.env.XDG_CACHE_HOME = tempDir;
    process.env.GITHUB_REPOSITORY = "owner/repo";
  });

  after(() => {
    rmSync(tempDir, { recursive: true, force: true });
    process.env.XDG_CACHE_HOME = ORIGINAL_XDG;
    process.env.GITHUB_REPOSITORY = ORIGINAL_REPO;
  });

  it("getContextCacheDir uses XDG_CACHE_HOME", () => {
    assert.strictEqual(getContextCacheDir(), join(tempDir, "opencode-actions", "review-context"));
  });

  it("loadReviewContext returns null when no context exists", () => {
    const ctx = loadReviewContext("123");
    assert.strictEqual(ctx, null);
  });

  it("saveReviewContext and loadReviewContext roundtrip", () => {
    const sessions: ReviewSession[] = [
      {
        name: "quality",
        messages: [
          { info: { role: "user" }, parts: [{ type: "text", text: "review this" }] },
          { info: { role: "assistant" }, parts: [{ type: "text", text: "looks good" }] },
        ],
      },
    ];
    saveReviewContext("42", sessions);

    const loaded = loadReviewContext("42");
    assert.ok(loaded);
    assert.strictEqual(loaded!.version, 1);
    assert.strictEqual(loaded!.repo, "owner/repo");
    assert.strictEqual(loaded!.prNumber, "42");
    assert.strictEqual(loaded!.sessions.length, 1);
    assert.strictEqual(loaded!.sessions[0].name, "quality");
    assert.strictEqual(loaded!.sessions[0].messages.length, 2);
  });

  it("saveReviewContext appends to existing context", () => {
    const first: ReviewSession[] = [
      { name: "security", messages: [{ info: { role: "assistant" }, parts: [{ type: "text", text: "ok" }] }] },
    ];
    const second: ReviewSession[] = [
      { name: "coordinator", messages: [{ info: { role: "assistant" }, parts: [{ type: "text", text: "merged" }] }] },
    ];
    saveReviewContext("7", first);
    saveReviewContext("7", second);

    const loaded = loadReviewContext("7");
    assert.ok(loaded);
    assert.strictEqual(loaded!.sessions.length, 2);
    assert.strictEqual(loaded!.sessions[0].name, "security");
    assert.strictEqual(loaded!.sessions[1].name, "coordinator");
  });

  it("loadReviewContext returns null and warns for malformed file", () => {
    const dir = getContextCacheDir();
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "owner-repo-pr-99.json"), "not json");

    const loaded = loadReviewContext("99");
    assert.strictEqual(loaded, null);
  });

  it("loadReviewContext returns null when GITHUB_REPOSITORY is invalid", () => {
    process.env.GITHUB_REPOSITORY = "invalid";
    try {
      const ctx = loadReviewContext("1");
      assert.strictEqual(ctx, null);
    } finally {
      process.env.GITHUB_REPOSITORY = "owner/repo";
    }
  });

  it("formatPreviousContext includes session and role markers", () => {
    const context: ReviewContext = {
      version: 1,
      repo: "owner/repo",
      prNumber: "5",
      savedAt: "2026-01-01T00:00:00.000Z",
      sessions: [
        {
          name: "quality",
          messages: [
            { info: { role: "user" }, parts: [{ type: "text", text: "prompt" }] },
            { info: { role: "assistant" }, parts: [{ type: "text", text: "review" }] },
          ],
        },
      ],
    };
    const formatted = formatPreviousContext(context);
    assert.ok(formatted.includes("Previous review context for PR #5"));
    assert.ok(formatted.includes("Session: quality"));
    assert.ok(formatted.includes("[user] prompt"));
    assert.ok(formatted.includes("[assistant] review"));
  });
});
