import { describe, it, before, after } from "node:test";
import assert from "node:assert";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { start, __test } from "./server.js";
import type { Server } from "node:http";

/**
 * Tests for review-context-server/src/server.ts.
 *
 * The server is exercised over real HTTP (in-process binding to 127.0.0.1:0
 * so we don't have to guess ports). Each test creates its own DATA_DIR
 * temp directory so the tests don't interfere with each other or with
 * production data.
 */

interface RunningServer {
  server: Server;
  baseUrl: string;
  dataDir: string;
  restoreEnv: () => void;
}

function startServerWithEnv(env: Record<string, string>): Promise<RunningServer> {
  return new Promise((resolve, reject) => {
    const dataDir = mkdtempSync(join(tmpdir(), "ctx-server-test-"));
    const saved: Record<string, string | undefined> = {};
    for (const k of ["PORT", "DATA_DIR", "AUTH_TOKEN"]) {
      saved[k] = process.env[k];
    }
    // Always bind to an ephemeral port — never honor PORT from the
    // surrounding shell or earlier tests.
    process.env.PORT = "0";
    process.env.DATA_DIR = dataDir;
    if (env.AUTH_TOKEN === "" || env.AUTH_TOKEN === undefined) {
      delete process.env.AUTH_TOKEN;
    } else {
      process.env.AUTH_TOKEN = env.AUTH_TOKEN;
    }

    const server = start();
    server.once("error", reject);
    // Server is bound — fetch the port.
    setImmediate(() => {
      const addr = server.address();
      if (!addr || typeof addr !== "object") {
        reject(new Error("server failed to bind"));
        return;
      }
      const baseUrl = `http://127.0.0.1:${addr.port}`;
      resolve({
        server,
        baseUrl,
        dataDir,
        restoreEnv: () => {
          for (const k of ["PORT", "DATA_DIR", "AUTH_TOKEN"]) {
            if (saved[k] === undefined) delete process.env[k];
            else process.env[k] = saved[k];
          }
        },
      });
    });
  });
}

function stopServer(s: RunningServer): Promise<void> {
  return new Promise((resolve) => {
    s.server.close(() => {
      s.restoreEnv();
      rmSync(s.dataDir, { recursive: true, force: true });
      resolve();
    });
  });
}

async function http(
  baseUrl: string,
  path: string,
  init: { method?: string; body?: string; token?: string } = {},
): Promise<{ status: number; body: string }> {
  const headers: Record<string, string> = {};
  if (init.body !== undefined) headers["Content-Type"] = "application/json";
  if (init.token !== undefined) headers["Authorization"] = `Bearer ${init.token}`;
  const res = await fetch(`${baseUrl}${path}`, {
    method: init.method ?? "GET",
    headers,
    body: init.body,
  });
  return { status: res.status, body: await res.text() };
}

describe("parseContextPath (URL → params)", () => {
  const { parseContextPath } = __test;

  it("matches /context/o/r/p as v1", () => {
    assert.deepStrictEqual(parseContextPath("/context/owner/repo/123"), {
      owner: "owner",
      repo: "repo",
      pr: "123",
      variant: "v1",
    });
  });

  it("matches /context/o/r/p/v2 as v2", () => {
    assert.deepStrictEqual(parseContextPath("/context/owner/repo/123/v2"), {
      owner: "owner",
      repo: "repo",
      pr: "123",
      variant: "v2",
    });
  });

  it("returns null for unrelated paths", () => {
    assert.strictEqual(parseContextPath("/health"), null);
    assert.strictEqual(parseContextPath("/context/owner/repo"), null);
    assert.strictEqual(parseContextPath("/context/owner/repo/123/v3"), null);
    assert.strictEqual(parseContextPath(""), null);
    assert.strictEqual(parseContextPath("/"), null);
  });

  it("does not match /context/o/r/p/v2/extra", () => {
    assert.strictEqual(parseContextPath("/context/owner/repo/123/v2/extra"), null);
  });

  it("rejects .. components (path-traversal defense)", () => {
    // Note: Node already URL-decodes req.url before our regex sees it,
    // so %2e%2e would arrive as `..`. The regex itself only forbids `/`,
    // so `..` slips past `[^/]+`. The explicit isSafePathComponent
    // check catches it.
    assert.strictEqual(parseContextPath("/context/.."), null);
    assert.strictEqual(parseContextPath("/context/../etc/passwd"), null);
    assert.strictEqual(parseContextPath("/context/owner/../../etc"), null);
    assert.strictEqual(parseContextPath("/context/owner/.."), null);
  });

  it("rejects empty components", () => {
    assert.strictEqual(parseContextPath("/context//repo/1"), null);
    // The regex `[^/]+` already requires at least one non-slash char,
    // so empty segments don't match in the first place — but assert it.
  });

  it("rejects components with backslash (Windows-style traversal)", () => {
    // `\` is not `/` so the regex matches; the explicit component check
    // rejects it.
    assert.strictEqual(parseContextPath("/context/..\\etc\\owner/repo/1"), null);
  });

  it("rejects components with NUL byte", () => {
    assert.strictEqual(parseContextPath("/context/owner\0/repo/1"), null);
  });

  it("rejects components with shell metacharacters", () => {
    assert.strictEqual(parseContextPath("/context/$IFS/repo/1"), null);
    assert.strictEqual(parseContextPath("/context/owner;/repo/1"), null);
  });
});

describe("isSafePathComponent", () => {
  const { isSafePathComponent } = __test;

  it("accepts ordinary owner/repo names", () => {
    assert.strictEqual(isSafePathComponent("owner"), true);
    assert.strictEqual(isSafePathComponent("my-org"), true);
    assert.strictEqual(isSafePathComponent("some_repo"), true);
    assert.strictEqual(isSafePathComponent("org.with.dots"), true);
  });

  it("rejects empty / dot / dotdot", () => {
    assert.strictEqual(isSafePathComponent(""), false);
    assert.strictEqual(isSafePathComponent("."), false);
    assert.strictEqual(isSafePathComponent(".."), false);
  });

  it("rejects path separators and NUL", () => {
    assert.strictEqual(isSafePathComponent("a/b"), false);
    assert.strictEqual(isSafePathComponent("a\\b"), false);
    assert.strictEqual(isSafePathComponent("a\0b"), false);
  });
});

describe("getContextPath refuses to escape DATA_DIR", () => {
  const { getContextPath } = __test;
  let savedDataDir: string | undefined;

  before(() => {
    // Pin DATA_DIR to an absolute path so the defence-in-depth check's
    // `resolve(full).startsWith(normalizedData)` comparison is
    // deterministic regardless of cwd / module load order.
    savedDataDir = process.env.DATA_DIR;
    process.env.DATA_DIR = mkdtempSync(join(tmpdir(), "ctx-dit-"));
  });

  after(() => {
    if (savedDataDir === undefined) delete process.env.DATA_DIR;
    else process.env.DATA_DIR = savedDataDir;
  });

  it("getContextPath still throws when fed already-bad input (defence in depth)", () => {
    // parseContextPath now catches these, but if someone calls
    // getContextPath directly (or via future code paths), it must
    // still refuse to resolve outside DATA_DIR.
    assert.throws(
      () => getContextPath("..", "repo", "1", "v1"),
      /Refusing/,
    );
    assert.throws(
      () => getContextPath("owner", "..", "1", "v1"),
      /Refusing/,
    );
    // `pr=".."` gets collapsed by `join`, so the path stays inside
    // DATA_DIR but maps to the wrong file. Component check catches it.
    assert.throws(
      () => getContextPath("owner", "repo", "..", "v1"),
      /Refusing/,
    );
  });
});

describe("getContextPath (params → fs path)", () => {
  const { getContextPath } = __test;

  it("v1 → {dataDir}/owner/repo/123.json", () => {
    // The server reads DATA_DIR lazily from process.env; the test
    // harness sets it to a per-suite temp dir, so we just assert the
    // shape and suffix — not the exact path.
    const p = getContextPath("owner", "repo", "123", "v1");
    assert.ok(p.endsWith("/owner/repo/123.json"), `got ${p}`);
  });

  it("v2 → {dataDir}/owner/repo/123.v2.json (different file than v1)", () => {
    const v1 = getContextPath("owner", "repo", "123", "v1");
    const v2 = getContextPath("owner", "repo", "123", "v2");
    assert.notStrictEqual(v1, v2);
    assert.ok(v2.endsWith("123.v2.json"));
  });
});

describe("HTTP routing (v1 + v2 coexist on the same PR)", { concurrency: false }, () => {
  let s: RunningServer;

  before(async () => {
    s = await startServerWithEnv({ AUTH_TOKEN: "secret-token" });
  });

  after(async () => {
    await stopServer(s);
  });

  it("/health is public and reports the data dir", async () => {
    const r = await http(s.baseUrl, "/health");
    assert.strictEqual(r.status, 200);
    const parsed = JSON.parse(r.body);
    assert.strictEqual(parsed.status, "ok");
    assert.strictEqual(parsed.dataDir, s.dataDir);
  });

  it("rejects requests without the bearer token", async () => {
    const r = await http(s.baseUrl, "/context/owner/repo/1");
    assert.strictEqual(r.status, 401);
  });

  it("rejects GET with path-traversal components", async () => {
    // Node URL parser will normalise `..` segments in `req.url`, so the
    // exact URL that lands at our handler is `req.url` post-normalisation.
    // We just check that 404 is returned (treated as "not found" — not
    // a 200 with secret data).
    for (const evilPath of [
      "/context/../etc/passwd",
      "/context/owner/../../../etc/passwd",
      "/context/foo/../../bar/1",
    ]) {
      const r = await http(s.baseUrl, evilPath, { token: "secret-token" });
      assert.strictEqual(r.status, 404, `expected 404 for ${evilPath}, got ${r.status}`);
    }
  });

  it("GET v1 returns 404 when nothing stored", async () => {
    const r = await http(s.baseUrl, "/context/owner/repo/1", { token: "secret-token" });
    assert.strictEqual(r.status, 404);
  });

  it("PUT then GET v1 roundtrip on pr.json", async () => {
    const payload = JSON.stringify({ version: 1, repo: "o/r", prNumber: "1", savedAt: "x", sessions: [] });
    const put = await http(s.baseUrl, "/context/owner/repo/1", {
      method: "PUT",
      body: payload,
      token: "secret-token",
    });
    assert.strictEqual(put.status, 200);

    const get = await http(s.baseUrl, "/context/owner/repo/1", { token: "secret-token" });
    assert.strictEqual(get.status, 200);
    assert.strictEqual(get.body, payload);

    // On-disk file is pr.json
    const onDisk = readFileSync(join(s.dataDir, "owner", "repo", "1.json"), "utf-8");
    assert.strictEqual(onDisk, payload);
  });

  it("PUT then GET v2 roundtrip on pr.v2.json", async () => {
    const payload = JSON.stringify({
      version: 2,
      repo: "o/r",
      prNumber: "2",
      savedAt: "x",
      bundles: [{ name: "quality", sessionID: "ses_abc", bundle: { info: { id: "ses_abc" } }, savedAt: "x" }],
    });
    const put = await http(s.baseUrl, "/context/owner/repo/2/v2", {
      method: "PUT",
      body: payload,
      token: "secret-token",
    });
    assert.strictEqual(put.status, 200);

    const get = await http(s.baseUrl, "/context/owner/repo/2/v2", { token: "secret-token" });
    assert.strictEqual(get.status, 200);
    assert.strictEqual(get.body, payload);

    // On-disk file is pr.v2.json, not pr.json — v1/v2 can coexist.
    const onDisk = readFileSync(join(s.dataDir, "owner", "repo", "2.v2.json"), "utf-8");
    assert.strictEqual(onDisk, payload);
    assert.strictEqual(existsSync(join(s.dataDir, "owner", "repo", "2.json")), false);
  });

  it("v1 and v2 for the same PR are stored in separate files", async () => {
    const v1Body = JSON.stringify({ version: 1, repo: "o/r", prNumber: "3", savedAt: "x", sessions: [] });
    const v2Body = JSON.stringify({ version: 2, repo: "o/r", prNumber: "3", savedAt: "y", bundles: [] });

    await http(s.baseUrl, "/context/owner/repo/3", { method: "PUT", body: v1Body, token: "secret-token" });
    await http(s.baseUrl, "/context/owner/repo/3/v2", { method: "PUT", body: v2Body, token: "secret-token" });

    const v1 = await http(s.baseUrl, "/context/owner/repo/3", { token: "secret-token" });
    const v2 = await http(s.baseUrl, "/context/owner/repo/3/v2", { token: "secret-token" });
    assert.strictEqual(v1.body, v1Body);
    assert.strictEqual(v2.body, v2Body);

    // Both files exist on disk.
    assert.ok(existsSync(join(s.dataDir, "owner", "repo", "3.json")));
    assert.ok(existsSync(join(s.dataDir, "owner", "repo", "3.v2.json")));
  });

  it("GET v2 returns 404 when only v1 was stored", async () => {
    // PR 1 only has v1 data from an earlier test.
    const r = await http(s.baseUrl, "/context/owner/repo/1/v2", { token: "secret-token" });
    assert.strictEqual(r.status, 404);
  });

  it("PUT rejects malformed JSON", async () => {
    const r = await http(s.baseUrl, "/context/owner/repo/99", {
      method: "PUT",
      body: "not json {",
      token: "secret-token",
    });
    assert.strictEqual(r.status, 500);
    // File must NOT have been written.
    assert.strictEqual(existsSync(join(s.dataDir, "owner", "repo", "99.json")), false);
  });

  it("DELETE removes only the targeted variant file", async () => {
    // PR 3 has both v1 and v2 from earlier test.
    const del = await http(s.baseUrl, "/context/owner/repo/3", {
      method: "DELETE",
      token: "secret-token",
    });
    assert.strictEqual(del.status, 204);
    assert.strictEqual(existsSync(join(s.dataDir, "owner", "repo", "3.json")), false);
    assert.ok(existsSync(join(s.dataDir, "owner", "repo", "3.v2.json")), "v2 file should remain");
  });

  it("method not allowed returns 405", async () => {
    const r = await http(s.baseUrl, "/context/owner/repo/2/v2", {
      method: "PATCH",
      token: "secret-token",
    });
    assert.strictEqual(r.status, 405);
  });

  it("rejects a PUT body larger than the limit", async () => {
    // MAX_BODY_BYTES is 16 MiB; send 17 MiB and expect 413.
    const huge = "a".repeat(17 * 1024 * 1024);
    const r = await http(s.baseUrl, "/context/owner/repo/huge/v2", {
      method: "PUT",
      body: huge,
      token: "secret-token",
    });
    assert.strictEqual(r.status, 413);
    // File must NOT have been written.
    assert.strictEqual(existsSync(join(s.dataDir, "owner", "repo", "huge.v2.json")), false);
  });
});

describe("HTTP routing (auth disabled when AUTH_TOKEN unset)", { concurrency: false }, () => {
  let s: RunningServer;

  before(async () => {
    s = await startServerWithEnv({ AUTH_TOKEN: "" });
  });

  after(async () => {
    await stopServer(s);
  });

  it("accepts requests without bearer token", async () => {
    const r = await http(s.baseUrl, "/context/owner/repo/noauth");
    assert.ok(r.status === 404 || r.status === 200);
  });
});