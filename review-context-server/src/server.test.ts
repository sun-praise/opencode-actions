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