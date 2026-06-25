import { createServer, IncomingMessage, ServerResponse } from "node:http";
import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

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
  return join(getDataDir(), owner, repo, `${pr}${suffix}`);
}

// Single regex with an optional /v2 suffix group. Matches both layouts.
const CONTEXT_PATH_RE = /^\/context\/([^/]+)\/([^/]+)\/([^/]+)(?:\/(v2))?$/;

function parseContextPath(url: string): ContextParams | null {
  const m = url.match(CONTEXT_PATH_RE);
  if (!m) return null;
  return {
    owner: m[1],
    repo: m[2],
    pr: m[3],
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

export const __test = { CONTEXT_PATH_RE, parseContextPath, getContextPath, MAX_BODY_BYTES };

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