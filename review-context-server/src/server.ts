import { createServer, IncomingMessage, ServerResponse } from "node:http";
import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

const PORT = parseInt(process.env.PORT || "8080", 10);
const DATA_DIR = process.env.DATA_DIR || "./data";
const AUTH_TOKEN = process.env.AUTH_TOKEN || "";

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
  return join(DATA_DIR, owner, repo, `${pr}${suffix}`);
}

function parseContextPath(url: string): ContextParams | null {
  // Accept both /context/o/r/p (v1) and /context/o/r/p/v2 (v2).
  const v1 = url.match(/^\/context\/([^/]+)\/([^/]+)\/([^/]+)$/);
  if (v1) return { owner: v1[1], repo: v1[2], pr: v1[3], variant: "v1" };
  const v2 = url.match(/^\/context\/([^/]+)\/([^/]+)\/([^/]+)\/v2$/);
  if (v2) return { owner: v2[1], repo: v2[2], pr: v2[3], variant: "v2" };
  return null;
}

function isAuthorized(req: IncomingMessage): boolean {
  if (!AUTH_TOKEN) return true;
  const auth = req.headers.authorization || "";
  return auth === `Bearer ${AUTH_TOKEN}`;
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let body = "";
    req.setEncoding("utf-8");
    req.on("data", (chunk: string) => {
      body += chunk;
    });
    req.on("end", () => resolve(body));
    req.on("error", reject);
  });
}

const server = createServer(async (req, res) => {
  const { method, url } = req;

  if (url === "/health") {
    return sendJson(res, 200, { status: "ok", dataDir: DATA_DIR });
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
  } catch (err) {
    console.error(`[${new Date().toISOString()}] Request failed: ${method} ${url}`, err);
    sendJson(res, 500, { error: "Internal server error" });
  }
});

server.listen(PORT, () => {
  console.log(`Review context server listening on port ${PORT}`);
  console.log(`Data directory: ${DATA_DIR}`);
  console.log(`Authentication: ${AUTH_TOKEN ? "enabled" : "disabled"}`);
});
