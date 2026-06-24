import { describe, it, before, after } from "node:test";
import assert from "node:assert";
import { createServer, type Server } from "node:http";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
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
const ORIGINAL_CACHE_URL = process.env.MULTI_REVIEW_CONTEXT_CACHE_URL;
const ORIGINAL_CACHE_TOKEN = process.env.MULTI_REVIEW_CONTEXT_CACHE_TOKEN;

describe("context-cache filesystem backend", { concurrency: false }, () => {
  let tempDir: string;

  before(() => {
    tempDir = mkdtempSync(join(tmpdir(), "context-cache-test-"));
    process.env.XDG_CACHE_HOME = tempDir;
    process.env.GITHUB_REPOSITORY = "owner/repo";
    delete process.env.MULTI_REVIEW_CONTEXT_CACHE_URL;
    delete process.env.MULTI_REVIEW_CONTEXT_CACHE_TOKEN;
  });

  after(() => {
    rmSync(tempDir, { recursive: true, force: true });
    process.env.XDG_CACHE_HOME = ORIGINAL_XDG;
    process.env.GITHUB_REPOSITORY = ORIGINAL_REPO;
    process.env.MULTI_REVIEW_CONTEXT_CACHE_URL = ORIGINAL_CACHE_URL;
    process.env.MULTI_REVIEW_CONTEXT_CACHE_TOKEN = ORIGINAL_CACHE_TOKEN;
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

describe("context-cache HTTP backend", { concurrency: false }, () => {
  let server: Server;
  let baseUrl: string;
  let dataDir: string;
  const authToken = "test-token";

  before(async () => {
    dataDir = mkdtempSync(join(tmpdir(), "context-cache-http-test-"));
    process.env.GITHUB_REPOSITORY = "owner/repo";
    delete process.env.XDG_CACHE_HOME;

    server = createServer((req, res) => {
      const auth = req.headers.authorization || "";
      if (auth !== `Bearer ${authToken}`) {
        res.writeHead(401, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Unauthorized" }));
        return;
      }

      const match = (req.url || "").match(/^\/context\/([^/]+)\/([^/]+)\/([^/]+)$/);
      if (!match) {
        res.writeHead(404, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Not found" }));
        return;
      }

      const [, owner, repo, pr] = match;
      const filePath = join(dataDir, owner, repo, `${pr}.json`);

      if (req.method === "GET") {
        try {
          const data = readFileSync(filePath, "utf-8");
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(data);
        } catch {
          res.writeHead(404, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: "Not found" }));
        }
      } else if (req.method === "PUT") {
        let body = "";
        req.setEncoding("utf-8");
        req.on("data", (chunk: string) => { body += chunk; });
        req.on("end", () => {
          try {
            JSON.parse(body);
            mkdirSync(dirname(filePath), { recursive: true });
            writeFileSync(filePath, body);
            res.writeHead(200, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ saved: true }));
          } catch {
            res.writeHead(400, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ error: "Bad request" }));
          }
        });
      } else {
        res.writeHead(405);
        res.end();
      }
    });

    await new Promise<void>((resolve) => {
      server.listen(0, "127.0.0.1", () => {
        const addr = server.address();
        if (addr && typeof addr === "object") {
          baseUrl = `http://127.0.0.1:${addr.port}`;
        }
        resolve();
      });
    });

    process.env.MULTI_REVIEW_CONTEXT_CACHE_URL = baseUrl;
    process.env.MULTI_REVIEW_CONTEXT_CACHE_TOKEN = authToken;
  });

  after(async () => {
    delete process.env.MULTI_REVIEW_CONTEXT_CACHE_URL;
    delete process.env.MULTI_REVIEW_CONTEXT_CACHE_TOKEN;
    await new Promise<void>((resolve) => server.close(() => resolve()));
    rmSync(dataDir, { recursive: true, force: true });
    process.env.GITHUB_REPOSITORY = ORIGINAL_REPO;
    process.env.XDG_CACHE_HOME = ORIGINAL_XDG;
  });

  it("loadReviewContext returns null when server has no context", async () => {
    const ctx = await loadReviewContext("123");
    assert.strictEqual(ctx, null);
  });

  it("saveReviewContext and loadReviewContext roundtrip via HTTP", async () => {
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
    assert.strictEqual(loaded!.repo, "owner/repo");
    assert.strictEqual(loaded!.prNumber, "42");
    assert.strictEqual(loaded!.sessions.length, 1);
  });

  it("saveReviewContext appends via HTTP", async () => {
    await saveReviewContext("7", [{ name: "security", messages: [{ info: { role: "assistant" }, parts: [{ type: "text", text: "ok" }] }] }]);
    await saveReviewContext("7", [{ name: "coordinator", messages: [{ info: { role: "assistant" }, parts: [{ type: "text", text: "merged" }] }] }]);

    const loaded = await loadReviewContext("7");
    assert.ok(loaded);
    assert.strictEqual(loaded!.sessions.length, 2);
  });

  it("falls back to filesystem when HTTP URL is not set", async () => {
    const fsDir = mkdtempSync(join(tmpdir(), "context-cache-fs-fallback-"));
    process.env.XDG_CACHE_HOME = fsDir;
    delete process.env.MULTI_REVIEW_CONTEXT_CACHE_URL;

    try {
      await saveReviewContext("100", [{ name: "quality", messages: [{ info: { role: "assistant" }, parts: [{ type: "text", text: "ok" }] }] }]);
      const loaded = await loadReviewContext("100");
      assert.ok(loaded);
      assert.strictEqual(loaded!.sessions.length, 1);
    } finally {
      rmSync(fsDir, { recursive: true, force: true });
      process.env.MULTI_REVIEW_CONTEXT_CACHE_URL = baseUrl;
    }
  });
});
