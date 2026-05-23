import { execFileSync } from "node:child_process";

export function resolvePRNumber(): string | null {
  const ref = process.env.GITHUB_REF || "";
  const match = ref.match(/^refs\/pull\/(\d+)\/merge$/);
  return match ? match[1] : null;
}

export async function postPRComment(body: string): Promise<void> {
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
