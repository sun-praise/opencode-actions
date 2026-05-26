import { execFileSync } from "node:child_process";
import * as https from "node:https";
import * as http from "node:http";

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

/** Get repo in `owner/repo` format from GITHUB_REPOSITORY. */
function getRepo(): string {
  return process.env.GITHUB_REPOSITORY || "";
}

/** Resolve the effective Gitea API token. Priority: env override > GITEA_TOKEN env. */
function getGiteaToken(): string {
  return process.env.GITEA_TOKEN || "";
}

/** Get the Gitea API base URL (e.g. `https://gitea.example.com/api/v1`). */
function getGiteaApiBase(): string {
  const url = process.env.GITEA_API_URL || "";
  return url.replace(/\/+$/, "");
}

/** Check if `tea` CLI is available on PATH. */
function hasTea(): boolean {
  try {
    execFileSync("which", ["tea"], { stdio: "pipe", timeout: 5_000 });
    return true;
  } catch {
    return false;
  }
}

/** Simple HTTP/HTTPS request helper (no external deps). */
function httpRequest(
  url: string,
  options: http.RequestOptions & { body?: string },
): Promise<{ status: number; data: string }> {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const mod = parsed.protocol === "https:" ? https : http;
    const reqOptions: http.RequestOptions = {
      hostname: parsed.hostname,
      port: parsed.port,
      path: parsed.pathname + parsed.search,
      method: options.method || "GET",
      headers: options.headers || {},
    };
    const req = mod.request(reqOptions, (res) => {
      const chunks: Buffer[] = [];
      res.on("data", (chunk: Buffer) => chunks.push(chunk));
      res.on("end", () => {
        resolve({
          status: res.statusCode || 0,
          data: Buffer.concat(chunks).toString("utf-8"),
        });
      });
    });
    req.on("error", reject);
    req.setTimeout(30_000, () => {
      req.destroy(new Error("request timed out"));
    });
    if (options.body) req.write(options.body);
    req.end();
  });
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
  const headers: Record<string, string> = { Accept: "text/plain" };
  if (token) headers["Authorization"] = `token ${token}`;

  // Synchronous wrapper: we're in a sync call chain from index.ts.
  // Use execFileSync with curl for simplicity (available on all Linux runners).
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

  // Gitea
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

  // Gitea run link pattern differs: /<repo>/actions/runs/<id> still works on Gitea
  const runLinkPattern = `/${repo}/actions/runs/${runId}`;
  const errorRe = /(fatal:|remote:|error:\s*\d{3}|unable to access|Write access|permission denied)/i;

  let comments: Array<{ id: number; body: string }>;
  try {
    const url = `${base}/repos/${repo}/issues/${prNumber}/comments`;
    const curlArgs = ["-sSf", "-H", "Accept: application/json"];
    if (token) curlArgs.push("-H", `Authorization: token ${token}`);
    curlArgs.push(url);

    const raw = execFileSync("curl", curlArgs, {
      timeout: 30_000,
      stdio: "pipe",
      maxBuffer: 5 * 1024 * 1024,
    });
    comments = JSON.parse(raw.toString());
  } catch (err) {
    console.error(`cleanup-error-comments: failed to list Gitea comments: ${err}`);
    return;
  }

  for (const comment of comments) {
    if (!comment.body) continue;
    if (!comment.body.includes(runLinkPattern) || !errorRe.test(comment.body)) continue;
    try {
      const url = `${base}/repos/${repo}/issues/comments/${comment.id}`;
      const curlArgs = ["-sSf", "-X", "DELETE"];
      if (token) curlArgs.push("-H", `Authorization: token ${token}`);
      curlArgs.push(url);

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
