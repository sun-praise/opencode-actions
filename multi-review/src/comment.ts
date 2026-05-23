import { execFileSync } from "node:child_process";

export function resolvePRNumber(): string | null {
  const ref = process.env.GITHUB_REF || "";
  const match = ref.match(/^refs\/pull\/(\d+)\/merge$/);
  return match ? match[1] : null;
}

export function postPRComment(body: string): void {
  const prNumber = resolvePRNumber();
  if (!prNumber) {
    console.log("Not in PR context, printing review to stdout:");
    console.log("---");
    console.log(body);
    return;
  }

  const repo = process.env.GITHUB_REPOSITORY || "";

  try {
    execFileSync("gh", ["pr", "comment", prNumber, "--repo", repo, "--body", body], {
      env: { ...process.env },
      timeout: 30_000,
      stdio: "pipe",
    });
    console.log(`Posted review comment on PR #${prNumber}`);
  } catch (err) {
    console.error(`Failed to post comment: ${err}`);
    console.log("--- Review (fallback) ---");
    console.log(body);
  }
}

export function cleanupErrorComments(): void {
  const enabled = process.env.MULTI_REVIEW_CLEANUP_ERROR_COMMENTS || "true";
  if (enabled.toLowerCase() !== "true") return;

  const prNumber = resolvePRNumber();
  if (!prNumber) return;

  const repo = process.env.GITHUB_REPOSITORY || "";
  const runId = process.env.GITHUB_RUN_ID || "";
  if (!repo || !runId) return;

  const runLinkPattern = `/${repo}/actions/runs/${runId}`;
  const errorRe = /(fatal:|remote:|error:\s*\d{3}|unable to access|Write access|permission denied)/i;

  let comments: Array<{ id: number; body: string }>;
  try {
    const raw = execFileSync("gh", ["api", "--paginate", "-H", "Accept: application/vnd.github+json", `/repos/${repo}/issues/${prNumber}/comments`], {
      env: { ...process.env },
      timeout: 30_000,
      stdio: "pipe",
      maxBuffer: 5 * 1024 * 1024,
    });
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
