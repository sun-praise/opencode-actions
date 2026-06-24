import { mkdir, readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import type { ReviewContext, ReviewSession } from "./types.js";

const CACHE_VERSION = 1;
const CONTEXT_DIR_NAME = join("opencode-actions", "review-context");
const MAX_ROUNDS_PER_SESSION_NAME = 3;
const FILE_MODE = 0o600;

function isSafePathComponent(value: string): boolean {
  if (!value) return false;
  // Reject traversal, null bytes, and absolute paths.
  if (value.includes("..") || value.includes("\0") || value.startsWith("/")) return false;
  return /^[\w./-]+$/.test(value);
}

function getRepo(): string {
  const repo = process.env.GITHUB_REPOSITORY || "";
  if (!repo || !/^[\w.-]+\/[\w.-]+$/.test(repo)) {
    return "";
  }
  return repo;
}

function getContextKey(prNumber: string): { owner: string; repo: string; pr: string } | null {
  const repo = getRepo();
  if (!repo || !prNumber) {
    return null;
  }
  const [owner, repoName] = repo.split("/");
  const safePr = prNumber.replace(/\D/g, "");
  if (!safePr || !isSafePathComponent(owner) || !isSafePathComponent(repoName)) {
    return null;
  }
  return { owner, repo: repoName, pr: safePr };
}

function getContextCacheUrl(): string | undefined {
  const url = process.env.MULTI_REVIEW_CONTEXT_CACHE_URL || "";
  return url ? url.replace(/\/+$/, "") : undefined;
}

function getContextCacheToken(): string | undefined {
  const token = process.env.MULTI_REVIEW_CONTEXT_CACHE_TOKEN || "";
  return token || undefined;
}

function validateLoadedContext(parsed: unknown, expectedPrNumber: string): ReviewContext | null {
  if (!parsed || typeof parsed !== "object") return null;
  const ctx = parsed as Partial<ReviewContext>;
  const repo = getRepo();
  if (
    ctx.version !== CACHE_VERSION ||
    ctx.repo !== repo ||
    ctx.prNumber !== expectedPrNumber ||
    !Array.isArray(ctx.sessions)
  ) {
    return null;
  }
  return parsed as ReviewContext;
}

/**
 * Keep only the most recent sessions for each session name to prevent
 * unbounded cache growth across repeated re-reviews of the same PR.
 */
export function trimSessions(
  sessions: ReviewSession[],
  maxPerName = MAX_ROUNDS_PER_SESSION_NAME,
): ReviewSession[] {
  const counts = new Map<string, number>();
  const result: ReviewSession[] = [];
  for (let i = sessions.length - 1; i >= 0; i--) {
    const session = sessions[i];
    const count = counts.get(session.name) || 0;
    if (count < maxPerName) {
      result.unshift(session);
      counts.set(session.name, count + 1);
    }
  }
  return result;
}

// ── HTTP cache server backend ──────────────────────────────────────────

async function httpGetContext(url: string, token: string | undefined, key: ReturnType<typeof getContextKey>): Promise<ReviewContext | null> {
  const fullUrl = `${url}/context/${key.owner}/${key.repo}/${key.pr}`;
  const headers: Record<string, string> = {};
  if (token) headers["Authorization"] = `Bearer ${token}`;
  try {
    const res = await fetch(fullUrl, { headers });
    if (res.status === 404) return null;
    if (!res.ok) {
      console.warn(`[context-cache] HTTP GET ${fullUrl} failed: ${res.status}`);
      return null;
    }
    const parsed = (await res.json()) as unknown;
    return validateLoadedContext(parsed, key.pr);
  } catch (err) {
    console.warn(`[context-cache] HTTP GET failed: ${err instanceof Error ? err.message : err}`);
    return null;
  }
}

async function httpPutContext(
  url: string,
  token: string | undefined,
  key: ReturnType<typeof getContextKey>,
  context: ReviewContext,
): Promise<void> {
  const fullUrl = `${url}/context/${key.owner}/${key.repo}/${key.pr}`;
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (token) headers["Authorization"] = `Bearer ${token}`;
  try {
    const res = await fetch(fullUrl, {
      method: "PUT",
      headers,
      body: JSON.stringify(context),
    });
    if (!res.ok) {
      console.warn(`[context-cache] HTTP PUT ${fullUrl} failed: ${res.status}`);
      return;
    }
    console.log(`Saved review context for PR #${key.pr}: ${context.sessions.length} sessions`);
  } catch (err) {
    console.warn(`[context-cache] HTTP PUT failed: ${err instanceof Error ? err.message : err}`);
  }
}

// ── Filesystem backend (fallback / local testing) ───────────────────────

export function getContextCacheDir(): string {
  const raw = process.env.XDG_CACHE_HOME || join(homedir(), ".cache");
  const resolved = resolve(raw);
  const expectedRoot = resolve(raw);
  if (!resolved.startsWith(expectedRoot + "/") && resolved !== expectedRoot) {
    throw new Error(`Refusing to use unsafe XDG_CACHE_HOME: ${raw}`);
  }
  return join(resolved, CONTEXT_DIR_NAME);
}

function getFilesystemPath(key: ReturnType<typeof getContextKey>): string {
  const repoKey = `${key.owner}-${key.repo}`;
  return join(getContextCacheDir(), `${repoKey}-pr-${key.pr}.json`);
}

async function fsGetContext(key: ReturnType<typeof getContextKey>): Promise<ReviewContext | null> {
  const path = getFilesystemPath(key);
  if (!existsSync(path)) return null;
  try {
    const raw = await readFile(path, "utf-8");
    const parsed = JSON.parse(raw) as unknown;
    return validateLoadedContext(parsed, key.pr);
  } catch (err) {
    console.warn(`Failed to load review context (${path}): ${err instanceof Error ? err.message : err}`);
    return null;
  }
}

async function fsPutContext(key: ReturnType<typeof getContextKey>, context: ReviewContext): Promise<void> {
  const path = getFilesystemPath(key);
  try {
    await mkdir(dirname(path), { recursive: true, mode: 0o700 });
    await writeFile(path, JSON.stringify(context, null, 2), { mode: FILE_MODE });
    console.log(`Saved review context for PR #${key.pr}: ${context.sessions.length} sessions`);
  } catch (err) {
    console.warn(`Failed to save review context (${path}): ${err instanceof Error ? err.message : err}`);
  }
}

// ── Public API ─────────────────────────────────────────────────────────

/**
 * Load the previously saved review context for a PR.
 * Prefers the configured HTTP cache server; falls back to the local filesystem.
 */
export async function loadReviewContext(prNumber: string): Promise<ReviewContext | null> {
  const key = getContextKey(prNumber);
  if (!key) return null;

  const url = getContextCacheUrl();
  if (url) {
    const ctx = await httpGetContext(url, getContextCacheToken(), key);
    if (ctx) {
      console.log(`Loaded previous review context for PR #${prNumber}: ${ctx.sessions.length} sessions`);
      return ctx;
    }
    return null;
  }

  return fsGetContext(key);
}

/**
 * Save (append) review sessions for a PR.
 * Prefers the configured HTTP cache server; falls back to the local filesystem.
 */
export async function saveReviewContext(
  prNumber: string,
  newSessions: ReviewSession[],
): Promise<void> {
  const key = getContextKey(prNumber);
  if (!key) {
    console.warn("Skipping review context save: unable to determine repo or PR number");
    return;
  }
  if (!newSessions.length) return;

  const repo = getRepo();
  if (!repo) {
    console.warn("Skipping review context save: GITHUB_REPOSITORY is unset or invalid");
    return;
  }

  const existing = await loadReviewContext(prNumber);
  const context: ReviewContext = {
    version: CACHE_VERSION,
    repo,
    prNumber,
    savedAt: new Date().toISOString(),
    sessions: trimSessions([...(existing?.sessions || []), ...newSessions]),
  };

  const url = getContextCacheUrl();
  if (url) {
    await httpPutContext(url, getContextCacheToken(), key, context);
  } else {
    await fsPutContext(key, context);
  }
}

/**
 * Format a previously saved review context as text that can be prepended
 * to a new reviewer prompt. This keeps the full history visible to the model
 * while clearly demarcating it from the current review request.
 */
export function formatPreviousContext(context: ReviewContext): string {
  const lines: string[] = [];
  lines.push(`=== Previous review context for PR #${context.prNumber} ===`);
  lines.push(`Saved at: ${context.savedAt}`);
  lines.push("");

  for (const session of context.sessions) {
    lines.push(`--- Session: ${session.name} ---`);
    for (const message of session.messages) {
      const role = message.info.role;
      const text = message.parts
        .filter((p): p is { type: "text"; text: string } => p.type === "text" && typeof p.text === "string")
        .map((p) => p.text)
        .join("\n");
      if (!text) continue;
      lines.push(`[${role}] ${text}`);
      lines.push("");
    }
  }

  return lines.join("\n");
}
