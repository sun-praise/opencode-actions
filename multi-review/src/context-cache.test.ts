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
  trimSessions,
} from "./context-cache.js";
import type { ReviewContext, ReviewSession } from "./types.js";

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

  it("loadReviewContext returns null when no context exists", async () => {
    const ctx = await loadReviewContext("123");
    assert.strictEqual(ctx, null);
  });

  it("saveReviewContext and loadReviewContext roundtrip", async () => {
    const sessions: ReviewSession[] = [
      {
        name: "quality",
        messages: [
          { info: { role: "user" }, parts: [{ type: "text", text: "review this" }] },
          { info: { role: "assistant" }, parts: [{ type: "text", text: "looks good" }] },
        ],
      },
    ];
    await saveReviewContext("42", sessions);

    const loaded = await loadReviewContext("42");
    assert.ok(loaded);
    assert.strictEqual(loaded!.version, 1);
    assert.strictEqual(loaded!.repo, "owner/repo");
    assert.strictEqual(loaded!.prNumber, "42");
    assert.strictEqual(loaded!.sessions.length, 1);
    assert.strictEqual(loaded!.sessions[0].name, "quality");
    assert.strictEqual(loaded!.sessions[0].messages.length, 2);
  });

  it("saveReviewContext appends to existing context", async () => {
    const first: ReviewSession[] = [
      { name: "security", messages: [{ info: { role: "assistant" }, parts: [{ type: "text", text: "ok" }] }] },
    ];
    const second: ReviewSession[] = [
      { name: "coordinator", messages: [{ info: { role: "assistant" }, parts: [{ type: "text", text: "merged" }] }] },
    ];
    await saveReviewContext("7", first);
    await saveReviewContext("7", second);

    const loaded = await loadReviewContext("7");
    assert.ok(loaded);
    assert.strictEqual(loaded!.sessions.length, 2);
    assert.strictEqual(loaded!.sessions[0].name, "security");
    assert.strictEqual(loaded!.sessions[1].name, "coordinator");
  });

  it("trimSessions keeps the most recent sessions per name", () => {
    const sessions: ReviewSession[] = [
      { name: "quality", messages: [{ info: { role: "assistant" }, parts: [{ type: "text", text: "1" }] }] },
      { name: "security", messages: [{ info: { role: "assistant" }, parts: [{ type: "text", text: "1" }] }] },
      { name: "quality", messages: [{ info: { role: "assistant" }, parts: [{ type: "text", text: "2" }] }] },
      { name: "quality", messages: [{ info: { role: "assistant" }, parts: [{ type: "text", text: "3" }] }] },
      { name: "quality", messages: [{ info: { role: "assistant" }, parts: [{ type: "text", text: "4" }] }] },
    ];
    const trimmed = trimSessions(sessions, 2);
    const quality = trimmed.filter((s) => s.name === "quality");
    assert.strictEqual(quality.length, 2);
    assert.strictEqual(quality[0].messages[0].parts[0].text, "3");
    assert.strictEqual(quality[1].messages[0].parts[0].text, "4");
    assert.strictEqual(trimmed.filter((s) => s.name === "security").length, 1);
  });

  it("saveReviewContext trims old sessions per name", async () => {
    const sessions: ReviewSession[] = [];
    for (let i = 1; i <= 5; i++) {
      sessions.push({
        name: "quality",
        messages: [{ info: { role: "assistant" }, parts: [{ type: "text", text: String(i) }] }],
      });
    }
    await saveReviewContext("999", sessions);

    const loaded = await loadReviewContext("999");
    assert.ok(loaded);
    assert.strictEqual(loaded!.sessions.length, 3);
    assert.strictEqual(loaded!.sessions[0].messages[0].parts[0].text, "3");
    assert.strictEqual(loaded!.sessions[2].messages[0].parts[0].text, "5");
  });

  it("loadReviewContext returns null and warns for malformed file", async () => {
    const dir = getContextCacheDir();
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "owner-repo-pr-99.json"), "not json");

    const loaded = await loadReviewContext("99");
    assert.strictEqual(loaded, null);
  });

  it("loadReviewContext returns null when version/repo/prNumber mismatch", async () => {
    const dir = getContextCacheDir();
    mkdirSync(dir, { recursive: true });
    const context = {
      version: 999,
      repo: "owner/repo",
      prNumber: "88",
      savedAt: "2026-01-01T00:00:00.000Z",
      sessions: [],
    } as unknown as ReviewContext;
    writeFileSync(join(dir, "owner-repo-pr-88.json"), JSON.stringify(context));

    const loaded = await loadReviewContext("88");
    assert.strictEqual(loaded, null);
  });

  it("loadReviewContext returns null when GITHUB_REPOSITORY is invalid", async () => {
    process.env.GITHUB_REPOSITORY = "invalid";
    try {
      const ctx = await loadReviewContext("1");
      assert.strictEqual(ctx, null);
    } finally {
      process.env.GITHUB_REPOSITORY = "owner/repo";
    }
  });

  it("saveReviewContext skips when GITHUB_REPOSITORY is invalid", async () => {
    process.env.GITHUB_REPOSITORY = "invalid";
    try {
      await saveReviewContext("1", [{ name: "x", messages: [] }]);
      const ctx = await loadReviewContext("1");
      assert.strictEqual(ctx, null);
    } finally {
      process.env.GITHUB_REPOSITORY = "owner/repo";
    }
  });

  it("saveReviewContext skips empty sessions", async () => {
    await saveReviewContext("empty", []);
    const ctx = await loadReviewContext("empty");
    assert.strictEqual(ctx, null);
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
            { info: { role: "tool" }, parts: [{ type: "image" }] },
          ],
        },
      ],
    };
    const formatted = formatPreviousContext(context);
    assert.ok(formatted.includes("Previous review context for PR #5"));
    assert.ok(formatted.includes("Session: quality"));
    assert.ok(formatted.includes("[user] prompt"));
    assert.ok(formatted.includes("[assistant] review"));
    assert.ok(!formatted.includes("[tool]"));
  });

  it("formatPreviousContext handles empty sessions", () => {
    const context: ReviewContext = {
      version: 1,
      repo: "owner/repo",
      prNumber: "6",
      savedAt: "2026-01-01T00:00:00.000Z",
      sessions: [],
    };
    const formatted = formatPreviousContext(context);
    assert.ok(formatted.includes("PR #6"));
  });
});
