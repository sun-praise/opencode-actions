import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import type { ReviewContext, ReviewSession } from "./types.js";

export type { ReviewContext, ReviewSession } from "./types.js";

const CACHE_VERSION = 1;
const CONTEXT_DIR_NAME = join("opencode-actions", "review-context");

/**
 * Resolve the directory used to store review contexts.
 * Relies on XDG_CACHE_HOME being set by the action; falls back to ~/.cache.
 */
export function getContextCacheDir(): string {
  const xdgCacheHome = process.env.XDG_CACHE_HOME || join(homedir(), ".cache");
  return join(xdgCacheHome, CONTEXT_DIR_NAME);
}

function getRepo(): string {
  const repo = process.env.GITHUB_REPOSITORY || "";
  if (!repo || !/^[\w.-]+\/[\w.-]+$/.test(repo)) {
    return "";
  }
  return repo;
}

function getContextPath(prNumber: string): string | null {
  const repo = getRepo();
  if (!repo || !prNumber) {
    return null;
  }
  const safeRepo = repo.replace(/\//g, "-");
  const safePr = prNumber.replace(/\D/g, "");
  if (!safePr) {
    return null;
  }
  return join(getContextCacheDir(), `${safeRepo}-pr-${safePr}.json`);
}

/**
 * Load the previously saved review context for a PR.
 * Returns null if no context exists, the repo is unknown, or the file is corrupt.
 */
export function loadReviewContext(prNumber: string): ReviewContext | null {
  const path = getContextPath(prNumber);
  if (!path) {
    return null;
  }
  if (!existsSync(path)) {
    return null;
  }
  try {
    const raw = readFileSync(path, "utf-8");
    const parsed = JSON.parse(raw) as ReviewContext;
    if (parsed?.version !== CACHE_VERSION || !Array.isArray(parsed.sessions)) {
      console.warn(`Ignoring malformed review context: ${path}`);
      return null;
    }
    return parsed;
  } catch (err) {
    console.warn(`Failed to load review context (${path}): ${err instanceof Error ? err.message : err}`);
    return null;
  }
}

/**
 * Save (append) review sessions for a PR.
 * Existing sessions are preserved; new sessions are appended.
 * Failures are logged and ignored so the main review flow is never blocked.
 */
export function saveReviewContext(
  prNumber: string,
  newSessions: ReviewSession[],
): void {
  const path = getContextPath(prNumber);
  if (!path) {
    console.warn("Skipping review context save: unable to determine repo or PR number");
    return;
  }
  if (!newSessions.length) {
    return;
  }

  const repo = getRepo();
  if (!repo) {
    console.warn("Skipping review context save: GITHUB_REPOSITORY is unset or invalid");
    return;
  }

  const existing = loadReviewContext(prNumber);
  const context: ReviewContext = {
    version: CACHE_VERSION,
    repo,
    prNumber,
    savedAt: new Date().toISOString(),
    sessions: [...(existing?.sessions || []), ...newSessions],
  };

  try {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, JSON.stringify(context, null, 2));
    console.log(`Saved review context for PR #${prNumber}: ${context.sessions.length} sessions`);
  } catch (err) {
    console.warn(`Failed to save review context (${path}): ${err instanceof Error ? err.message : err}`);
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
