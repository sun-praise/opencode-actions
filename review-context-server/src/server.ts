import { createServer, IncomingMessage, ServerResponse } from "node:http";
import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

/**
 * Cap on PUT body size. v2 bundles can be a few MB (full opencode session
 * rows). 16 MiB gives plenty of headroom while still rejecting malicious
 * clients that try to fill the disk.
 */
const MAX_BODY_BYTES = 16 * 1024 * 1024;

// Read runtime config lazily so tests can swap env between suites without
// re-importing the module.
function getPort(): number { return parseInt(process.env.PORT || "8080", 10); }
function getDataDir(): string { return process.env.DATA_DIR || "./data"; }
function getAuthToken(): string { return process.env.AUTH_TOKEN || ""; }

interface ContextParams {
  owner: string;
  repo: string;
  pr: string;
  /** "v1" (default, ReviewContext{version:1, sessions}) or "v2" (ReviewContextV2{bundles}). */
  variant: "v1" | "v2";
}

function sendJson(res: ServerResponse, status: number, body?: unknown): void {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(body !== undefined ? JSON.stringify(body) : undefined);
}

function getContextPath(owner: string, repo: string, pr: string, variant: "v1" | "v2"): string {
  // v1 is the historical layout (pr.json). v2 uses a .v2.json suffix so
  // v1 and v2 payloads can coexist for the same PR (used during the
  // rollout window — once all clients are on v2 the suffix can go away).
  const suffix = variant === "v2" ? ".v2.json" : ".json";
  // Defence in depth: even if parseContextPath is bypassed, refuse any
  // component that isn't a safe filename. Without this check, `pr=".."`
  // would be collapsed by `join` and silently map to its parent's file,
  // turning a typo or attacker input into a request for a different PR.
  if (!isSafePathComponent(owner) || !isSafePathComponent(repo) || !isSafePathComponent(pr)) {
    throw new Error(`Refusing unsafe path component: ${owner}/${repo}/${pr}`);
  }
  const dataDir = getDataDir();
  const full = join(dataDir, owner, repo, `${pr}${suffix}`);
  // Second line of defence: refuse any *resolved* path that escapes
  // DATA_DIR. `resolve` collapses any `..` segments, so this catches
  // inputs where the unsafe traversal is not fully normalized away
  // (e.g. "../../etc/passwd" → still resolves outside dataDir).
  const normalizedData = resolve(dataDir);
  if (!resolve(full).startsWith(normalizedData + "/") && resolve(full) !== normalizedData) {
    throw new Error(`Refusing path outside DATA_DIR: ${full}`);
  }
  return full;
}

// Single regex with an optional /v2 suffix group. Matches both layouts.
// Note: m[4] is "v2" or undefined (no leading slash — the slash is
// consumed by the non-capturing group).
const CONTEXT_PATH_RE = /^\/context\/([^/]+)\/([^/]+)\/([^/]+)(?:\/(v2))?$/;

/**
 * Validate that a URL path segment is safe to join into a file path.
 * Rejects: empty strings, anything with `..`, path separators
 * (forward or backslash), NUL, and any character outside
 * [A-Za-z0-9._-].
 *
 * Node has already URL-decoded req.url by the time we see it, so `%2F`
 * becomes `/` and would fail the regex anyway. The real risk is `..`
 * sneaking through (matches `[^/]+`) — without this check, a request
 * to `/context/../../etc/passwd/123` would resolve outside DATA_DIR.
 */
function isSafePathComponent(value: string): boolean {
  if (!value) return false;
  if (value === "." || value === "..") return false;
  if (value.includes("/") || value.includes("\\")) return false;
  if (value.includes("\0")) return false;
  return /^[\w.-]+$/.test(value);
}

function parseContextPath(url: string): ContextParams | null {
  const m = url.match(CONTEXT_PATH_RE);
  if (!m) return null;
  const [, owner, repo, pr] = m;
  // Defence-in-depth: even if the regex lets something through, the
  // path-component check stops `..` traversal.
  if (!isSafePathComponent(owner) || !isSafePathComponent(repo) || !isSafePathComponent(pr)) {
    return null;
  }
  return {
    owner,
    repo,
    pr,
    variant: m[4] === "v2" ? "v2" : "v1",
  };
}

function isAuthorized(req: IncomingMessage): boolean {
  const token = getAuthToken();
  if (!token) return true;
  const auth = req.headers.authorization || "";
  return auth === `Bearer ${token}`;
}

/**
 * Read the request body up to MAX_BODY_BYTES. Rejects larger payloads
 * with a 413. We track byte length explicitly because setEncoding("utf-8")
 * gives us characters, and a 1-character multi-byte UTF-8 sequence
 * would under-count.
 */
function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let body = "";
    let bytes = 0;
    let oversize = false;
    req.on("data", (chunk: Buffer | string) => {
      const buf = typeof chunk === "string" ? Buffer.from(chunk, "utf-8") : chunk;
      bytes += buf.length;
      if (bytes > MAX_BODY_BYTES) {
        oversize = true;
        // Stop reading — drain the rest of the request without storing.
        // We intentionally do NOT call req.destroy() here: that would
        // tear down the socket and the client would see a connection
        // reset instead of a clean 413 response. Just skip storing
        // further chunks and let the request finish normally.
        return;
      }
      body += buf.toString("utf-8");
    });
    req.on("end", () => {
      if (oversize) {
        reject(Object.assign(new Error("Body too large"), { statusCode: 413 }));
      } else {
        resolve(body);
      }
    });
    req.on("error", reject);
  });
}

const server = createServer(async (req, res) => {
  const { method, url } = req;

  if (url === "/health") {
    return sendJson(res, 200, { status: "ok", dataDir: getDataDir() });
  }

  if (!isAuthorized(req)) {
    return sendJson(res, 401, { error: "Unauthorized" });
  }

  const params = parseContextPath(url || "");
  if (!params) {
    return sendJson(res, 404, { error: "Not found" });
  }

  const { owner, repo, pr, variant } = params;
  const path = getContextPath(owner, repo, pr, variant);

  try {
    if (method === "GET") {
      if (!existsSync(path)) {
        return sendJson(res, 404, { error: "Context not found" });
      }
      const data = readFileSync(path, "utf-8");
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(data);
      return;
    }

    if (method === "PUT") {
      const body = await readBody(req);
      // Validate JSON before persisting.
      JSON.parse(body);
      mkdirSync(dirname(path), { recursive: true });
      writeFileSync(path, body, { mode: 0o600 });
      return sendJson(res, 200, { saved: true });
    }

    if (method === "DELETE") {
      if (existsSync(path)) {
        unlinkSync(path);
      }
      return sendJson(res, 204);
    }

    return sendJson(res, 405, { error: "Method not allowed" });
  } catch (err: any) {
    if (err && typeof err.statusCode === "number") {
      return sendJson(res, err.statusCode, { error: err.message });
    }
    console.error(`[${new Date().toISOString()}] Request failed: ${method} ${url}`, err);
    sendJson(res, 500, { error: "Internal server error" });
  }
});

export function start(): typeof server {
  const port = getPort();
  server.listen(port, () => {
    console.log(`Review context server listening on port ${port}`);
    console.log(`Data directory: ${getDataDir()}`);
    console.log(`Authentication: ${getAuthToken() ? "enabled" : "disabled"}`);
  });
  return server;
}

export const __test = { CONTEXT_PATH_RE, parseContextPath, getContextPath, isSafePathComponent, MAX_BODY_BYTES };

// Auto-start when invoked as the entry point. Skipped under node:test so
// tests can import the module without binding a port.
import { fileURLToPath } from "node:url";
const isEntry = (() => {
  try {
    return fileURLToPath(import.meta.url) === process.argv[1];
  } catch {
    return false;
  }
})();
if (isEntry) {
  start();
}