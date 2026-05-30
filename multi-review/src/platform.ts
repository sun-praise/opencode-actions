import { execFileSync } from "node:child_process";
import { writeFileSync, unlinkSync } from "node:fs";
import { join } from "node:path";

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
  const match = ref.match(/^refs\/pull\/(\d+)\/merge$/);
  return match ? match[1] : null;
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

const MAX_PAGES = 20;

function fetchAllGiteaComments(baseUrl: string, token: string): Array<{ id: number; body: string }> {
  const allComments: Array<{ id: number; body: string }> = [];
  let page = 1;
  const limit = 50;

  while (page <= MAX_PAGES) {
    const sep = baseUrl.includes("?") ? "&" : "?";
    const url = `${baseUrl}${sep}page=${page}&limit=${limit}`;
    const curlArgs = ["-sSf", "-H", "Accept: application/json"];
    if (token) curlArgs.push("-H", `Authorization: token ${token}`);
    curlArgs.push(url);

    const raw = execFileSync("curl", curlArgs, {
      timeout: 30_000,
      stdio: "pipe",
      maxBuffer: 5 * 1024 * 1024,
    });
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

// ── Post PR comment (with PR-context guard) ───────────────────────────

export function postPRComment(body: string): void {
  const prNumber = resolvePRNumber();
  if (!prNumber) {
    console.log("Not in PR context, printing review to stdout:");
    console.log("---");
    console.log(body);
    return;
  }

  const platform = detectPlatform();
  if (platform === "github") {
    postCommentGithub(prNumber, body);
  } else {
    postCommentGitea(prNumber, body);
  }
}

function postCommentGithub(prNumber: string, body: string): void {
  const repo = getRepo();
  try {
    execFileSync("gh", ["pr", "comment", prNumber, "--repo", repo, "--body", body], {
      env: { ...process.env },
      timeout: 30_000,
      stdio: "pipe",
    });
    console.log(`Posted review comment on PR #${prNumber}`);
  } catch (err) {
    console.error(`Failed to post comment: ${err}`);
    fallbackStdout(body);
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
      console.error(`tea comment failed, falling back to REST API: ${err}`);
    }
  }

  const url = `${base}/repos/${repo}/issues/${prNumber}/comments`;
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    Accept: "application/json",
  };
  if (token) headers["Authorization"] = `token ${token}`;

  try {
    const curlArgs = ["-sSf", "-X", "POST", url];
    for (const [k, v] of Object.entries(headers)) {
      curlArgs.push("-H", `${k}: ${v}`);
    }
    curlArgs.push("-d", JSON.stringify({ body }));

    execFileSync("curl", curlArgs, { timeout: 30_000, stdio: "pipe" });
    console.log(`Posted review comment on PR #${prNumber} (via Gitea API)`);
  } catch (err) {
    console.error(`Failed to post Gitea comment: ${err}`);
    fallbackStdout(body);
  }
}

function fallbackStdout(body: string): void {
  console.log("--- Review (fallback to stdout) ---");
  console.log(body);
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
      console.error(`tea pr diff failed, falling back to REST API: ${err}`);
    }
  }

  return fetchDiffGitea(prNumber);
}

function fetchDiffGithub(prNumber: string): string {
  const repo = getRepo();

  // Try gh CLI first (available on GitHub-hosted runners)
  try {
    return execFileSync("gh", ["pr", "diff", prNumber, "--repo", repo], {
      env: { ...process.env },
      timeout: 30_000,
      stdio: "pipe",
      maxBuffer: 10 * 1024 * 1024,
    }).toString("utf-8");
  } catch (err) {
    console.warn(`gh CLI not available or failed: ${err instanceof Error ? err.message : err}`);
  }

  // Fallback: GitHub REST API via curl (works on self-hosted runners without gh)
  // Write auth header to a temp file to avoid exposing token in /proc/<pid>/cmdline
  const token = process.env.GITHUB_TOKEN || process.env.MULTI_REVIEW_GITHUB_TOKEN || "";
  const githubApiUrl = process.env.GITHUB_API_URL || "https://api.github.com";
  const url = `${githubApiUrl.replace(/\/+$/, "")}/repos/${repo}/pulls/${prNumber}.diff`;

  const curlArgs = ["-sSf", "-H", "Accept: application/vnd.github.v3.diff"];
  let headerFile: string | undefined;
  if (token) {
    headerFile = join(process.env.RUNNER_TEMP || "/tmp", ".diff-auth-header");
    writeFileSync(headerFile, `Authorization: Bearer ${token}`);
    curlArgs.push("-H", `@${headerFile}`);
  }
  curlArgs.push(url);

  try {
    return execFileSync("curl", curlArgs, {
      timeout: 30_000,
      stdio: "pipe",
      maxBuffer: 10 * 1024 * 1024,
    }).toString("utf-8");
  } finally {
    if (headerFile) {
      try { unlinkSync(headerFile); } catch { /* ignore */ }
    }
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
  const curlArgs = ["-sSf", "-H", "Accept: text/plain"];
  if (token) {
    curlArgs.push("-H", `Authorization: token ${token}`);
  }
  curlArgs.push(url);

  return execFileSync("curl", curlArgs, {
    timeout: 30_000,
    stdio: "pipe",
    maxBuffer: 10 * 1024 * 1024,
  }).toString("utf-8");
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
  try {
    const raw = execFileSync(
      "gh",
      ["api", "--paginate", "-H", "Accept: application/vnd.github+json", `/repos/${repo}/issues/${prNumber}/comments`],
      { env: { ...process.env }, timeout: 30_000, stdio: "pipe", maxBuffer: 5 * 1024 * 1024 },
    );
    comments = JSON.parse(raw.toString());
  } catch {
    console.error("cleanup-error-comments: failed to list comments");
    return;
  }

  for (const comment of comments) {
    if (!comment.body) continue;
    if (!comment.body.includes(runLinkSnippet) || !ERROR_RE.test(comment.body)) continue;
    try {
      execFileSync("gh", ["api", "-X", "DELETE", `/repos/${repo}/issues/comments/${comment.id}`], {
        env: { ...process.env },
        timeout: 10_000,
        stdio: "pipe",
      });
      console.log(`Deleted error comment ${comment.id}`);
    } catch {
      /* ignore — delete failed */
    }
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
    console.error(`cleanup-error-comments: failed to list Gitea comments: ${err}`);
    return;
  }

  for (const comment of comments) {
    if (!comment.body) continue;
    if (!comment.body.includes(runLinkSnippet) || !ERROR_RE.test(comment.body)) continue;
    try {
      const delUrl = `${base}/repos/${repo}/issues/comments/${comment.id}`;
      const curlArgs = ["-sSf", "-X", "DELETE"];
      if (token) curlArgs.push("-H", `Authorization: token ${token}`);
      curlArgs.push(delUrl);

      execFileSync("curl", curlArgs, { timeout: 10_000, stdio: "pipe" });
      console.log(`Deleted error comment ${comment.id}`);
    } catch {
      /* ignore — delete failed */
    }
  }
}

// ── Parse extra env ───────────────────────────────────────────────────

export function parseExtraEnv(): void {
  const raw = process.env.MULTI_REVIEW_EXTRA_ENV || "";
  if (!raw) return;
  for (const line of raw.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eqIdx = trimmed.indexOf("=");
    if (eqIdx === -1) continue;
    const key = trimmed.slice(0, eqIdx).trim();
    const value = trimmed.slice(eqIdx + 1).trim();
    if (key) process.env[key] = value;
  }
}
