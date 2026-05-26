import { execFileSync } from "node:child_process";

// ── Types ──────────────────────────────────────────────────────────────

export type Platform = "github" | "gitea";

// ── Platform detection ─────────────────────────────────────────────────

/**
 * Detect the current CI platform.
 * Gitea Actions injects `GITEA_API_URL`; GitHub Actions does not.
 */
export function detectPlatform(): Platform {
  if (process.env.GITEA_API_URL) return "gitea";
  return "github";
}

// ── Helpers ────────────────────────────────────────────────────────────

/** Resolve PR number from GITHUB_REF (both GitHub and Gitea set this). */
export function resolvePRNumber(): string | null {
  const ref = process.env.GITHUB_REF || "";
  const match = ref.match(/^refs\/pull\/(\d+)\/merge$/);
  return match ? match[1] : null;
}

const REPO_RE = /^[\w.-]+\/[\w.-]+$/;

/** Get repo in `owner/repo` format from GITHUB_REPOSITORY. Validates format. */
function getRepo(): string {
  const repo = process.env.GITHUB_REPOSITORY || "";
  if (repo && !REPO_RE.test(repo)) {
    throw new Error(`Invalid GITHUB_REPOSITORY format: "${repo}" (expected owner/repo)`);
  }
  return repo;
}

/** Resolve the effective Gitea API token. Priority: env override > GITEA_TOKEN env. */
function getGiteaToken(): string {
  return process.env.GITEA_TOKEN || "";
}

/** Get the Gitea API base URL. Warns if non-HTTPS (token transmitted in cleartext). */
function getGiteaApiBase(): string {
  const url = process.env.GITEA_API_URL || "";
  if (url && url.startsWith("http://")) {
    console.warn(
      `Warning: GITEA_API_URL uses plain HTTP — API token will be transmitted in cleartext: ${url}`,
    );
  }
  return url.replace(/\/+$/, "");
}

/** Lazily cached check whether `tea` CLI is available on PATH. */
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

/** Fetch all pages of Gitea API comments (handles pagination). */
function fetchAllGiteaComments(baseUrl: string, token: string): Array<{ id: number; body: string }> {
  const allComments: Array<{ id: number; body: string }> = [];
  let page = 1;
  const limit = 50;

  // eslint-disable-next-line no-constant-condition
  while (true) {
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

  return allComments;
}

// ── Fetch PR diff ──────────────────────────────────────────────────────

export function fetchPRDiff(prNumber: string): string {
  const platform = detectPlatform();

  if (platform === "github") {
    return fetchDiffGithub(prNumber);
  }

  // Gitea: try tea CLI first, then REST API
  if (hasTea()) {
    try {
      return execFileSync("tea", ["pulls", "diff", prNumber], {
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
  return execFileSync("gh", ["pr", "diff", prNumber, "--repo", repo], {
    env: { ...process.env },
    timeout: 30_000,
    stdio: "pipe",
    maxBuffer: 10 * 1024 * 1024,
  }).toString("utf-8");
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

// ── Post PR comment ───────────────────────────────────────────────────

export function postPRComment(prNumber: string, body: string): void {
  const platform = detectPlatform();

  if (platform === "github") {
    postCommentGithub(prNumber, body);
    return;
  }

  postCommentGitea(prNumber, body);
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

  // Try tea CLI first
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

  // REST API fallback
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

    execFileSync("curl", curlArgs, {
      timeout: 30_000,
      stdio: "pipe",
    });
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

// ── Cleanup error comments ────────────────────────────────────────────

export function cleanupErrorComments(): void {
  const enabled = process.env.MULTI_REVIEW_CLEANUP_ERROR_COMMENTS || "true";
  if (enabled.toLowerCase() !== "true") return;

  const prNumber = resolvePRNumber();
  if (!prNumber) return;

  const repo = getRepo();
  const runId = process.env.GITHUB_RUN_ID || "";
  if (!repo || !runId) return;

  const platform = detectPlatform();

  if (platform === "github") {
    cleanupErrorCommentsGithub(prNumber, repo, runId);
  } else {
    cleanupErrorCommentsGitea(prNumber, repo, runId);
  }
}

function cleanupErrorCommentsGithub(prNumber: string, repo: string, runId: string): void {
  const runLinkPattern = `/${repo}/actions/runs/${runId}`;
  const errorRe = /(fatal:|remote:|error:\s*\d{3}|unable to access|Write access|permission denied)/i;

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
    if (!comment.body.includes(runLinkPattern) || !errorRe.test(comment.body)) continue;
    try {
      execFileSync("gh", ["api", "-X", "DELETE", `/repos/${repo}/issues/comments/${comment.id}`], {
        env: { ...process.env },
        timeout: 10_000,
        stdio: "pipe",
      });
      console.log(`Deleted error comment ${comment.id}`);
    } catch {
      /* ignore */
    }
  }
}

function cleanupErrorCommentsGitea(prNumber: string, repo: string, runId: string): void {
  const base = getGiteaApiBase();
  const token = getGiteaToken();
  if (!base) return;

  // Note: variable prefixed github_* for compatibility — Gitea Actions injects
  // the same GITHUB_REF/GITHUB_REPOSITORY/GITHUB_RUN_ID variables.
  const runLinkPattern = `/${repo}/actions/runs/${runId}`;
  const errorRe = /(fatal:|remote:|error:\s*\d{3}|unable to access|Write access|permission denied)/i;

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
    if (!comment.body.includes(runLinkPattern) || !errorRe.test(comment.body)) continue;
    try {
      const delUrl = `${base}/repos/${repo}/issues/comments/${comment.id}`;
      const curlArgs = ["-sSf", "-X", "DELETE"];
      if (token) curlArgs.push("-H", `Authorization: token ${token}`);
      curlArgs.push(delUrl);

      execFileSync("curl", curlArgs, {
        timeout: 10_000,
        stdio: "pipe",
      });
      console.log(`Deleted error comment ${comment.id}`);
    } catch {
      /* ignore */
    }
  }
}
