import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync, unlinkSync, mkdtempSync, chmodSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

// ── Types ──────────────────────────────────────────────────────────────

export type Platform = "github" | "gitea";

// ── Platform detection (cached) ────────────────────────────────────────

let _platform: Platform | undefined;

/** Detect the current CI platform (cached after first call). */
export function detectPlatform(): Platform {
  if (_platform === undefined) {
    _platform = process.env.GITEA_API_URL ? "gitea" : "github";
  }
  return _platform;
}

// ── Helpers (cached) ───────────────────────────────────────────────────

export function resolvePRNumber(): string | null {
  const ref = process.env.GITHUB_REF || "";
  // GitHub injects refs/pull/N/merge; Gitea injects refs/pull/N/head for PR events.
  const match = ref.match(/^refs\/pull\/(\d+)\/(?:merge|head)$/);
  if (match) return match[1];
  return resolvePRNumberFromEvent();
}

/**
 * Fallback PR-number resolver: read pull_request.number from the webhook
 * payload at GITHUB_EVENT_PATH. Independent of the GITHUB_REF format, so it
 * survives platforms/versions that use a different ref convention (e.g. Gitea).
 * Gated to pull_request events so an issue or deploy number is never mistaken
 * for a PR number.
 */
function resolvePRNumberFromEvent(): string | null {
  const eventName = process.env.GITHUB_EVENT_NAME || "";
  if (!eventName.startsWith("pull_request")) return null;

  const eventPath = process.env.GITHUB_EVENT_PATH || "";
  if (!eventPath) return null;

  try {
    const payload = JSON.parse(readFileSync(eventPath, "utf-8")) as {
      number?: unknown;
      pull_request?: { number?: unknown };
    };
    const num = payload.number ?? payload.pull_request?.number;
    if (typeof num === "number" && Number.isInteger(num) && num > 0) {
      return String(num);
    }
  } catch (err) {
    console.debug(`resolvePRNumber: failed to read PR number from GITHUB_EVENT_PATH: ${formatError(err)}`);
  }
  return null;
}

const REPO_RE = /^[\w.-]+\/[\w.-]+$/;

let _repo: string | undefined;
function getRepo(): string {
  if (_repo !== undefined) return _repo;
  const repo = process.env.GITHUB_REPOSITORY || "";
  if (repo && !REPO_RE.test(repo)) {
    console.warn(`Warning: invalid GITHUB_REPOSITORY format: "${repo}" (expected owner/repo)`);
    _repo = "";
  } else {
    _repo = repo;
  }
  return _repo;
}

let _giteaToken: string | undefined;
function getGiteaToken(): string {
  if (_giteaToken !== undefined) return _giteaToken;
  _giteaToken = process.env.GITEA_TOKEN || process.env.GITHUB_RUN_OPENCODE_GITEA_TOKEN || "";
  return _giteaToken;
}

let _giteaApiBase: string | undefined;
function getGiteaApiBase(): string {
  if (_giteaApiBase !== undefined) return _giteaApiBase;
  const url = process.env.GITEA_API_URL || "";
  _giteaApiBase = url.replace(/\/+$/, "");
  return _giteaApiBase;
}

let _teaAvailable: boolean | undefined;
function hasTea(): boolean {
  if (_teaAvailable !== undefined) return _teaAvailable;
  try {
    execFileSync("which", ["tea"], { stdio: "pipe", timeout: 5_000 });
    _teaAvailable = true;
  } catch {
    _teaAvailable = false;
  }
  return _teaAvailable;
}

let _ghAvailable: boolean | undefined;
function hasGh(): boolean {
  if (_ghAvailable !== undefined) return _ghAvailable;
  try {
    execFileSync("which", ["gh"], { stdio: "pipe", timeout: 5_000 });
    _ghAvailable = true;
  } catch {
    _ghAvailable = false;
  }
  return _ghAvailable;
}

/** Format an unknown error for safe logging (avoids [object Object]). */
function formatError(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/** Execute curl with headers, returning raw Buffer. */
function curlWithAuth(
  url: string,
  headers: Record<string, string>,
  opts: { method?: string; body?: string; maxBuffer?: number; timeout?: number } = {},
): Buffer {
  const args = ["-sSf"];
  if (opts.method) args.push("-X", opts.method);
  for (const [k, v] of Object.entries(headers)) {
    args.push("-H", `${k}: ${v}`);
  }
  if (opts.body) args.push("-d", opts.body);
  args.push(url);

  return execFileSync("curl", args, {
    timeout: opts.timeout ?? 30_000,
    stdio: "pipe",
    maxBuffer: opts.maxBuffer ?? 5 * 1024 * 1024,
  });
}

const MAX_PAGES = 20;

/** Create a unique temp directory for auth header files (avoids concurrent job conflicts). */
const _tempDir = mkdtempSync(join(tmpdir(), "opencode-review-"));
// Restrict directory permissions to owner-only (prevent other processes from reading auth headers)
chmodSync(_tempDir, 0o700);

/** Write auth header to a unique temp file and return its path. Caller must unlink when done. */
function writeAuthHeader(token: string, prefix: string): string {
  const path = join(_tempDir, `${prefix}-${process.pid}`);
  writeFileSync(path, `Authorization: Bearer ${token}`);
  chmodSync(path, 0o600);
  return path;
}

function fetchAllGiteaComments(baseUrl: string, token: string): Array<{ id: number; body: string }> {
  const allComments: Array<{ id: number; body: string }> = [];
  let page = 1;
  const limit = 50;

  while (page <= MAX_PAGES) {
    const sep = baseUrl.includes("?") ? "&" : "?";
    const url = `${baseUrl}${sep}page=${page}&limit=${limit}`;
    const hdrs: Record<string, string> = { Accept: "application/json" };
    if (token) hdrs["Authorization"] = `token ${token}`;

    const raw = curlWithAuth(url, hdrs);
    const batch: Array<{ id: number; body: string }> = JSON.parse(raw.toString());
    if (!Array.isArray(batch) || batch.length === 0) break;
    allComments.push(...batch);
    if (batch.length < limit) break;
    page++;
  }

  if (page > MAX_PAGES) {
    console.warn(`Warning: fetchAllGiteaComments hit MAX_PAGES=${MAX_PAGES} limit, some comments may be missed`);
  }

  return allComments;
}

// ── Escape hash-number references (platform-layer guarantee) ──────────
//
// The platform layer is the authoritative safeguard — it escapes "#N" patterns
// in agent output before posting to GitHub/Gitea. Prompt-layer instructions
// in reviewers.ts / run-github-opencode.py are merely hints to reduce the
// volume of corrections needed at this layer.
//
// Note: HASH_NUM_RE uses the global (g) flag. Do not share exec/matchAll
// state across calls — always use replace() or reconstruct matchAll().

/** Matches "#N" preceded by whitespace, opening punctuation, or line start,
 *  and followed by whitespace, punctuation, or line end. */
const HASH_NUM_RE = /(?:^|(?<=[\s(\[{<（"'`>:，、：]))(#)(\d{1,6})(?=[\s)\]}>）"'`,.!?;，。！？、：]|$)/gm;

/** Matches triple-backtick fenced code blocks. */
const FENCED_CODE_RE = /```[\s\S]*?```/g;

/** Matches inline code (single backtick). Does not cross line boundaries. */
const INLINE_CODE_RE = /`[^`\n]+`/g;

/**
 * Escape hash-number patterns ("#N") in text to prevent GitHub/Gitea from
 * auto-converting them to issue/PR references. Inserts a zero-width space
 * between "#" and the digit.
 *
 * Coverage:
 * - Escapes "#N" after whitespace, `(`, `[`, `{`, `<`, `（`, `"`, `'`, `` ` ```,
 *   `>`, `:`, and Chinese punctuation `：`, `，`, `、`.
 * - Skips content inside fenced code blocks (```...```) and inline code
 *   (`...`). Does NOT handle unclosed fences/backticks; unclosed markers
 *   will cause subsequent content to be treated as code and left unescaped.
 */
/** @internal Exported for testing only — not a public API. */
export function escapeHashReferences(text: string): string {
  if (!text || !text.includes("#")) return text;
  const segments: string[] = [];
  let lastEnd = 0;
  for (const m of text.matchAll(FENCED_CODE_RE)) {
    if (m.index !== undefined) {
      segments.push(escapeSegment(text.slice(lastEnd, m.index)));
      segments.push(m[0]);
      lastEnd = m.index + m[0].length;
    }
  }
  const tail = text.slice(lastEnd);
  segments.push(escapeSegment(tail));
  return segments.join("");
}

function escapeSegment(text: string): string {
  const parts: string[] = [];
  let lastEnd = 0;
  for (const m of text.matchAll(INLINE_CODE_RE)) {
    if (m.index !== undefined) {
      parts.push(text.slice(lastEnd, m.index).replace(HASH_NUM_RE, "$1\u200B$2"));
      parts.push(m[0]);
      lastEnd = m.index + m[0].length;
    }
  }
  parts.push(text.slice(lastEnd).replace(HASH_NUM_RE, "$1\u200B$2"));
  return parts.join("");
}

// ── Post PR comment (with PR-context guard) ───────────────────────────

export function postPRComment(body: string): void {
  const escaped = escapeHashReferences(body);
  const prNumber = resolvePRNumber();
  if (!prNumber) {
    console.log("Not in PR context, printing review to stdout:");
    console.log("---");
    console.log(escaped);
    return;
  }

  const platform = detectPlatform();
  if (platform === "github") {
    postCommentGithub(prNumber, escaped);
  } else {
    postCommentGitea(prNumber, escaped);
  }
}

function postCommentGithub(prNumber: string, body: string): void {
  const repo = getRepo();
  if (hasGh()) {
    try {
      execFileSync("gh", ["pr", "comment", prNumber, "--repo", repo, "--body", body], {
        env: { ...process.env },
        timeout: 30_000,
        stdio: "pipe",
      });
      console.log(`Posted review comment on PR #${prNumber}`);
      return;
    } catch (err) {
      console.warn(`gh CLI comment failed, falling back to REST API: ${formatError(err)}`);
    }
  }

  // Fallback: GitHub REST API via curl (works on self-hosted runners without gh)
  const token = process.env.GITHUB_TOKEN || process.env.MULTI_REVIEW_GITHUB_TOKEN || "";
  if (!token) {
    console.warn("No GitHub token available for REST API fallback");
    fallbackStdout(body);
    return;
  }

  const githubApiUrl = process.env.GITHUB_API_URL || "https://api.github.com";
  const url = `${githubApiUrl.replace(/\/+$/, "")}/repos/${repo}/issues/${prNumber}/comments`;

  const headerFile = writeAuthHeader(token, "comment");
  const curlArgs = [
    "-sSf", "-X", "POST",
    "-H", "Accept: application/vnd.github+json",
    "-H", `@${headerFile}`,
    "-H", "Content-Type: application/json",
    "-d", JSON.stringify({ body }),
    url,
  ];

  try {
    execFileSync("curl", curlArgs, { timeout: 30_000, stdio: "pipe" });
    console.log(`Posted review comment on PR #${prNumber} (via REST API)`);
  } catch (err) {
    console.error(`Failed to post comment via REST API: ${formatError(err)}`);
    fallbackStdout(body);
  } finally {
    try { unlinkSync(headerFile); } catch (e) { console.debug(`Failed to delete temp auth header: ${formatError(e)}`); }
  }
}

function postCommentGitea(prNumber: string, body: string): void {
  const repo = getRepo();
  const base = getGiteaApiBase();
  const token = getGiteaToken();

  if (!base || !repo) {
    console.error("Cannot post Gitea comment: missing GITEA_API_URL or GITHUB_REPOSITORY");
    fallbackStdout(body);
    return;
  }

  if (hasTea()) {
    try {
      execFileSync("tea", ["issues", "comment", prNumber, "--repo", repo, "--body", body], {
        env: { ...process.env },
        timeout: 30_000,
        stdio: "pipe",
      });
      console.log(`Posted review comment on PR #${prNumber} (via tea)`);
      return;
    } catch (err) {
      console.error(`tea comment failed, falling back to REST API: ${formatError(err)}`);
    }
  }

  const url = `${base}/repos/${repo}/issues/${prNumber}/comments`;
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    Accept: "application/json",
  };
  if (token) headers["Authorization"] = `token ${token}`;

  try {
    curlWithAuth(url, headers, { method: "POST", body: JSON.stringify({ body }) });
    console.log(`Posted review comment on PR #${prNumber} (via Gitea API)`);
  } catch (err) {
    console.error(`Failed to post Gitea comment: ${formatError(err)}`);
    fallbackStdout(body);
  }
}

function fallbackStdout(body: string): void {
  console.log("--- Review (fallback to stdout) ---");
  console.log(body);
}

// ── Git ref validation ─────────────────────────────────────────────────
const GIT_REF_RE = /^[a-zA-Z0-9_\/.\-]+$/;
/** Validate a git ref name to prevent shell injection. Only alphanumeric, slash, dot, hyphen, underscore allowed. */
export function validateGitRef(ref: string): string {
  if (!GIT_REF_RE.test(ref)) {
    throw new Error(`Invalid git ref: "${ref}" contains disallowed characters`);
  }
  return ref;
}
// ── Fetch PR diff ──────────────────────────────────────────────────────

export function fetchPRDiff(prNumber: string): string {
  if (detectPlatform() === "github") {
    return fetchDiffGithub(prNumber);
  }

  if (hasTea()) {
    try {
      return execFileSync("tea", ["pulls", "diff", prNumber, "--repo", getRepo()], {
        env: { ...process.env },
        timeout: 30_000,
        stdio: "pipe",
        maxBuffer: 10 * 1024 * 1024,
      }).toString("utf-8");
    } catch (err) {
      console.error(`tea pr diff failed, falling back to REST API: ${formatError(err)}`);
    }
  }

  return fetchDiffGitea(prNumber);
}

function fetchDiffGithub(prNumber: string): string {
  const repo = getRepo();

  // Try gh CLI first (available on GitHub-hosted runners)
  if (hasGh()) {
    try {
      return execFileSync("gh", ["pr", "diff", prNumber, "--repo", repo], {
        env: { ...process.env },
        timeout: 30_000,
        stdio: "pipe",
        maxBuffer: 10 * 1024 * 1024,
      }).toString("utf-8");
    } catch (err) {
      console.warn(`gh CLI failed, falling back to REST API: ${formatError(err)}`);
    }
  }
  // Fallback 2: GitHub REST API via curl (works on self-hosted runners without gh)
  // Write auth header to a temp file to avoid exposing token in /proc/<pid>/cmdline
  const token = process.env.GITHUB_TOKEN || process.env.MULTI_REVIEW_GITHUB_TOKEN || "";
  if (token) {
    const githubApiUrl = process.env.GITHUB_API_URL || "https://api.github.com";
    const url = `${githubApiUrl.replace(/\/+$/, "")}/repos/${repo}/pulls/${prNumber}.diff`;
    const headerFile = writeAuthHeader(token, "diff");
    const curlArgs = ["-sSf", "-H", "Accept: application/vnd.github.v3.diff", "-H", `@${headerFile}`, url];
    try {
      return execFileSync("curl", curlArgs, {
        timeout: 30_000,
        stdio: "pipe",
        maxBuffer: 10 * 1024 * 1024,
      }).toString("utf-8");
    } catch (err) {
      console.warn(`REST API failed, falling back to local git diff: ${formatError(err)}`);
    } finally {
      try { unlinkSync(headerFile); } catch (e) { console.debug(`Failed to delete temp auth header: ${formatError(e)}`); }
    }
  } else {
    console.warn("gh CLI unavailable and no GitHub token \u2014 trying local git diff");
  }
  // Fallback 3: local git fetch + diff (bypasses GitHub API 20000-line limit)
  const baseRef = validateGitRef(process.env.GITHUB_BASE_REF || "main");
  try {
    execFileSync("git", ["fetch", "origin", baseRef, "--depth=1"], {
      timeout: 30_000,
      stdio: "pipe",
    });
    return execFileSync("git", ["diff", `origin/${baseRef}..HEAD`], {
      timeout: 30_000,
      stdio: "pipe",
      maxBuffer: 50 * 1024 * 1024,
    }).toString("utf-8");
  } catch (err) {
    throw new Error(`All diff methods failed (gh, REST API, local git): ${formatError(err)}`);
  }
}

function fetchDiffGitea(prNumber: string): string {
  const repo = getRepo();
  const base = getGiteaApiBase();
  const token = getGiteaToken();

  if (!base || !repo) {
    throw new Error(
      `Gitea diff fetch requires GITEA_API_URL and GITHUB_REPOSITORY (got: base=${base}, repo=${repo})`,
    );
  }

  const url = `${base}/repos/${repo}/pulls/${prNumber}.diff`;
  const headers: Record<string, string> = { Accept: "text/plain" };
  if (token) headers["Authorization"] = `token ${token}`;

  return curlWithAuth(url, headers, { maxBuffer: 10 * 1024 * 1024 }).toString("utf-8");
}

// ── Cleanup error comments ────────────────────────────────────────────

export function cleanupErrorComments(): void {
  const enabled = process.env.MULTI_REVIEW_CLEANUP_ERROR_COMMENTS || "true";
  if (enabled.toLowerCase() !== "true") return;

  const prNumber = resolvePRNumber();
  if (!prNumber) return;

  const repo = getRepo();
  const runId = process.env.GITHUB_RUN_ID || "";
  if (!repo || !runId) return;

  if (detectPlatform() === "github") {
    cleanupErrorCommentsGithub(prNumber, repo, runId);
  } else {
    cleanupErrorCommentsGitea(prNumber, repo, runId);
  }
}

const ERROR_RE = /(fatal:|remote:|error:\s*\d{3}|unable to access|Write access|permission denied)/i;

function cleanupErrorCommentsGithub(prNumber: string, repo: string, runId: string): void {
  const runLinkSnippet = `/${repo}/actions/runs/${runId}`;

  let comments: Array<{ id: number; body: string }>;
  if (hasGh()) {
    try {
      const raw = execFileSync(
        "gh",
        ["api", "--paginate", "-H", "Accept: application/vnd.github+json", `/repos/${repo}/issues/${prNumber}/comments`],
        { env: { ...process.env }, timeout: 30_000, stdio: "pipe", maxBuffer: 5 * 1024 * 1024 },
      );
      const parsed = JSON.parse(raw.toString());
      if (!Array.isArray(parsed)) {
        console.error("cleanup-error-comments: unexpected API response format (expected array)");
        return;
      }
      comments = parsed;
    } catch {
      // gh CLI failed — fall back to REST API via curl
      console.warn("cleanup-error-comments: gh CLI failed, falling back to REST API");
      try {
        comments = listCommentsGithubRest(prNumber, repo);
      } catch (err) {
        console.error(`cleanup-error-comments: failed to list comments via REST API: ${formatError(err)}`);
        return;
      }
    }
  } else {
    // gh CLI not available — use REST API directly
    try {
      comments = listCommentsGithubRest(prNumber, repo);
    } catch (err) {
      console.error(`cleanup-error-comments: failed to list comments via REST API: ${formatError(err)}`);
      return;
    }
  }

  for (const comment of comments) {
    if (!comment.body) continue;
    if (!comment.body.includes(runLinkSnippet) || !ERROR_RE.test(comment.body)) continue;
    try {
      deleteCommentGithub(comment.id, repo);
      console.log(`Deleted error comment ${comment.id}`);
    } catch (e) {
      console.debug(`Failed to delete error comment ${comment.id}: ${formatError(e)}`);
    }
  }
}

/** List all PR comments via GitHub REST API with pagination (curl fallback for self-hosted runners). */
function listCommentsGithubRest(prNumber: string, repo: string): Array<{ id: number; body: string }> {
  const token = process.env.GITHUB_TOKEN || process.env.MULTI_REVIEW_GITHUB_TOKEN || "";
  const githubApiUrl = process.env.GITHUB_API_URL || "https://api.github.com";
  const baseUrl = `${githubApiUrl.replace(/\/+$/, "")}/repos/${repo}/issues/${prNumber}/comments`;

  const allComments: Array<{ id: number; body: string }> = [];
  let page = 1;
  const perPage = 100;

  // Write auth header once for all paginated requests
  let headerFile: string | undefined;
  const headerArgs: string[] = [];
  if (token) {
    headerFile = writeAuthHeader(token, "cleanup-list");
    headerArgs.push("-H", `@${headerFile}`);
  }

  try {
    while (page <= MAX_PAGES) {
      const sep = baseUrl.includes("?") ? "&" : "?";
      const url = `${baseUrl}${sep}page=${page}&per_page=${perPage}`;
      const curlArgs = ["-sSf", "-H", "Accept: application/vnd.github+json", ...headerArgs, url];

      const raw = execFileSync("curl", curlArgs, {
        timeout: 30_000,
        stdio: "pipe",
        maxBuffer: 5 * 1024 * 1024,
      });
      const batch: Array<{ id: number; body: string }> = JSON.parse(raw.toString());
      if (!Array.isArray(batch) || batch.length === 0) break;
      allComments.push(...batch);
      if (batch.length < perPage) break;
      page++;
    }

    if (page > MAX_PAGES) {
      console.warn(`Warning: listCommentsGithubRest hit MAX_PAGES=${MAX_PAGES} limit, some comments may be missed`);
    }

    return allComments;
  } finally {
    if (headerFile) {
      try { unlinkSync(headerFile); } catch (e) { console.debug(`Failed to delete temp auth header: ${formatError(e)}`); }
    }
  }
}

/** Delete a PR comment via GitHub REST API (curl fallback for self-hosted runners). */
function deleteCommentGithub(commentId: number, repo: string): void {
  // Try gh CLI first
  if (hasGh()) {
    try {
      execFileSync("gh", ["api", "-X", "DELETE", `/repos/${repo}/issues/comments/${commentId}`], {
        env: { ...process.env },
        timeout: 10_000,
        stdio: "pipe",
      });
      return;
    } catch (e) {
      console.debug(`gh delete comment ${commentId} failed, falling back to REST API: ${formatError(e)}`);
    }
  }

  const token = process.env.GITHUB_TOKEN || process.env.MULTI_REVIEW_GITHUB_TOKEN || "";
  if (!token) {
    console.warn(`Cannot delete comment ${commentId} via REST API: no token available`);
    return;
  }

  const githubApiUrl = process.env.GITHUB_API_URL || "https://api.github.com";
  const url = `${githubApiUrl.replace(/\/+$/, "")}/repos/${repo}/issues/comments/${commentId}`;

  const headerFile = writeAuthHeader(token, "cleanup-del");
  const curlArgs = ["-sSf", "-X", "DELETE", "-H", "Accept: application/vnd.github+json", "-H", `@${headerFile}`, url];

  try {
    execFileSync("curl", curlArgs, { timeout: 10_000, stdio: "pipe" });
  } finally {
    try { unlinkSync(headerFile); } catch (e) { console.debug(`Failed to delete temp auth header: ${formatError(e)}`); }
  }
}

function cleanupErrorCommentsGitea(prNumber: string, repo: string, runId: string): void {
  const base = getGiteaApiBase();
  const token = getGiteaToken();
  if (!base) return;

  const runLinkSnippet = `/${repo}/actions/runs/${runId}`;
  const listUrl = `${base}/repos/${repo}/issues/${prNumber}/comments`;

  let comments: Array<{ id: number; body: string }>;
  try {
    comments = fetchAllGiteaComments(listUrl, token);
  } catch (err) {
    console.error(`cleanup-error-comments: failed to list Gitea comments: ${formatError(err)}`);
    return;
  }

  for (const comment of comments) {
    if (!comment.body) continue;
    if (!comment.body.includes(runLinkSnippet) || !ERROR_RE.test(comment.body)) continue;
    try {
      const delUrl = `${base}/repos/${repo}/issues/comments/${comment.id}`;
      const delHeaders: Record<string, string> = {};
      if (token) delHeaders["Authorization"] = `token ${token}`;
      curlWithAuth(delUrl, delHeaders, { method: "DELETE", timeout: 10_000 });
      console.log(`Deleted error comment ${comment.id}`);
    } catch (e) {
      console.debug(`Failed to delete Gitea error comment ${comment.id}: ${formatError(e)}`);
    }
  }
}

// ── Parse extra env ───────────────────────────────────────────────────

const SENSITIVE_ENV_KEYS = new Set([
  "GITHUB_TOKEN", "ZHIPU_API_KEY", "OPENCODE_API_KEY",
  "DEEPSEEK_API_KEY", "MINIMAX_API_KEY", "XIAOMI_API_KEY", "LITELLM_API_KEY",
  "GITEA_TOKEN", "MODEL", "PROMPT", "USE_GITHUB_TOKEN",
  "OPENCODE_ARGS", "OPENCODE_CONFIG_CONTENT",
  "OPENCODE_WORKING_DIRECTORY", "OPENCODE_ATTEMPTS",
  "OPENCODE_RETRY_PROFILE", "OPENCODE_RETRY_ON_REGEX",
  "OPENCODE_RETRY_DELAY_SECONDS",
]);

export interface ExtraEnvResult {
  blockedKeys: string[];
  prefixBlocked: string[];
  sensitiveBlocked: string[];
}

function emptyResult(): ExtraEnvResult {
  return { blockedKeys: [], prefixBlocked: [], sensitiveBlocked: [] };
}

export function parseExtraEnv(): ExtraEnvResult {
  const raw = process.env.MULTI_REVIEW_EXTRA_ENV || "";
  if (!raw) return emptyResult();
  const allowSensitive = ["true", "1", "yes"].includes(
    (process.env.MULTI_REVIEW_EXTRA_ENV_ALLOW_SENSITIVE || "false").trim().toLowerCase(),
  );
  const prefixBlocked: string[] = [];
  const sensitiveBlocked: string[] = [];
  for (const line of raw.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eqIdx = trimmed.indexOf("=");
    if (eqIdx === -1) continue;
    const key = trimmed.slice(0, eqIdx).trim();
    const value = trimmed.slice(eqIdx + 1).trim();
    if (!key) continue;
    if (key.startsWith("MULTI_REVIEW_")) {
      console.log(`::error::extra-env key '${key}' starts with reserved prefix 'MULTI_REVIEW_' and is not allowed`);
      prefixBlocked.push(key);
      continue;
    }
    if (SENSITIVE_ENV_KEYS.has(key)) {
      if (allowSensitive) {
        console.log(`::warning::extra-env key '${key}' overrides a sensitive runtime variable (allowed by extra-env-allow-sensitive)`);
      } else {
        console.log(`::error::extra-env key '${key}' overrides a sensitive runtime variable; set extra-env-allow-sensitive to 'true' to allow`);
        sensitiveBlocked.push(key);
        continue;
      }
    }
    process.env[key] = value;
  }
  const allBlocked = [...prefixBlocked, ...sensitiveBlocked];
  if (allBlocked.length === 0) return emptyResult();
  if (prefixBlocked.length > 0) {
    console.error(`extra-env: blocked ${prefixBlocked.length} reserved-prefix key(s): ${prefixBlocked.join(", ")}`);
  }
  if (sensitiveBlocked.length > 0) {
    console.error(`extra-env: blocked ${sensitiveBlocked.length} sensitive key override(s): ${sensitiveBlocked.join(", ")}`);
  }
  return { blockedKeys: allBlocked, prefixBlocked, sensitiveBlocked };
}
