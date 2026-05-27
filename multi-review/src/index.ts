import { createOpencode } from "@opencode-ai/sdk";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { loadReviewers, resolveModel, env, intEnv } from "./reviewers.js";
import { runParallelReviewers, runCoordinator, buildFallbackComment, buildReviewerDetails, cleanupAllSessions } from "./orchestrator.js";
import { postPRComment, cleanupErrorComments, parseExtraEnv } from "./comment.js";
import { fetchPRDiff, resolvePRNumber } from "./platform.js";

async function main(): Promise<number> {
  // 0. Parse extra env vars into process.env
  parseExtraEnv();

  const actionPath = env("GITHUB_ACTION_PATH");
  const runnerTemp = env("RUNNER_TEMP") || "/tmp";

  // 1. Fetch PR diff — prefer pre-fetched file (avoids duplicate API call),
  //    then fallback to platform-aware fetch
  let prDiff = "";
  const diffPath = join(runnerTemp, ".pr-diff.txt");
  try {
    prDiff = readFileSync(diffPath, "utf-8");
    if (prDiff.trim()) {
      console.log(`PR diff loaded from pre-fetched file: ${prDiff.length} chars`);
    }
  } catch {
    // File doesn't exist or unreadable, try platform fetch below
  }

  if (!prDiff.trim()) {
    const prNumber = resolvePRNumber();
    if (prNumber) {
      try {
        prDiff = fetchPRDiff(prNumber);
        console.log(`PR diff fetched via platform adapter: ${prDiff.length} chars`);
      } catch (err) {
        console.error(`Platform diff fetch failed: ${err}`);
      }
    }
  }

  if (!prDiff.trim()) {
    console.error("PR diff is empty or unavailable");
    return 1;
  }

  // 2. Load reviewers
  const reviewers = loadReviewers({ actionPath });
  if (reviewers.length === 0) {
    console.error("No reviewers configured");
    return 1;
  }
  console.log(`Reviewers: ${reviewers.map((r) => r.name).join(", ")}`);

  // 3. Resolve model
  const { providerID, modelID } = resolveModel();
  console.log(`Model: ${providerID}/${modelID}`);

  // 4. Start opencode server via SDK
  console.log("Starting opencode server...");
  const { client, server } = await createOpencode({
    config: { model: `${providerID}/${modelID}` },
  });
  console.log("Server ready");

  // Register signal handlers for graceful cleanup (best-effort)
  const shutdown = (signal: string) => {
    console.log(`Received ${signal}, cleaning up sessions...`);
    cleanupAllSessions(client)
      .catch(() => { /* ignore */ })
      .finally(() => {
        server.close();
        process.exit(signal === "SIGTERM" ? 143 : 130);
      });
  };
  process.once("SIGTERM", () => shutdown("SIGTERM"));
  process.once("SIGINT", () => shutdown("SIGINT"));

  try {
    // 5. Run reviewers in parallel
    const globalTimeout = intEnv("MULTI_REVIEW_TIMEOUT_SECONDS", 900);
    const coordinatorTimeout = intEnv("MULTI_REVIEW_COORDINATOR_TIMEOUT_SECONDS", 300);

    const reviews = await runParallelReviewers(client, reviewers, prDiff, {
      globalTimeoutMs: globalTimeout * 1000,
      coordinatorTimeoutMs: coordinatorTimeout * 1000,
      coordinatorPrompt: env("MULTI_REVIEW_COORDINATOR_PROMPT"),
    });

    const successCount = reviews.filter((r) => r.success).length;
    console.log(`Reviews: ${successCount}/${reviews.length} succeeded`);

    if (successCount === 0) {
      console.error("All reviewers failed");
      return 1;
    }

    // 6. Run coordinator
    let comment: string;
    try {
      const synthesis = await runCoordinator(client, reviews, {
        globalTimeoutMs: globalTimeout * 1000,
        coordinatorTimeoutMs: coordinatorTimeout * 1000,
        coordinatorPrompt: env("MULTI_REVIEW_COORDINATOR_PROMPT"),
      });
      comment = synthesis + "\n\n---\n\n" + buildReviewerDetails(reviews);
    } catch (err) {
      console.error(`Coordinator failed: ${err}`);
      comment = buildFallbackComment(reviews);
    }

    // 7. Post comment
    postPRComment(comment);

    // 8. Cleanup error comments from previous runs
    cleanupErrorComments();

    return 0;
  } finally {
    await cleanupAllSessions(client);
    server.close();
  }
}

main()
  .then((code) => process.exit(code))
  .catch((err) => {
    console.error("Fatal error:", err);
    process.exit(1);
  });
