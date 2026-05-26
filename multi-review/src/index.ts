import { createOpencode } from "@opencode-ai/sdk";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { loadReviewers, resolveModel, env, intEnv } from "./reviewers.js";
import { runParallelReviewers, runCoordinator, buildFallbackComment, buildReviewerDetails } from "./orchestrator.js";
import { postPRComment, cleanupErrorComments, parseExtraEnv } from "./comment.js";

/**
 * Generate or modify opencode.json with reasoning effort and thinking configuration.
 * Mirrors the Python configure_opencode_json() in run-github-opencode.py.
 */
function configureOpencodeJson(reasoningEffort: string, enableThinking: string, workingDirectory: string): void {
  const configPath = join(workingDirectory || ".", "opencode.json");

  let config: Record<string, unknown> = {};
  if (existsSync(configPath)) {
    try {
      config = JSON.parse(readFileSync(configPath, "utf-8"));
    } catch {
      config = {};
    }
  }

  if (!config.agent) config.agent = {};
  const agent = config.agent as Record<string, unknown>;
  if (!agent.build) agent.build = {};
  const build = agent.build as Record<string, unknown>;
  if (!build.options) build.options = {};
  const options = build.options as Record<string, unknown>;

  if (reasoningEffort) {
    options.reasoningEffort = reasoningEffort;
  }

  if (enableThinking.toLowerCase() === "true") {
    options.thinking = { type: "enabled" };
  }

  writeFileSync(configPath, JSON.stringify(config, null, 2) + "\n", "utf-8");
}

async function main(): Promise<number> {
  // 0. Parse extra env vars into process.env
  parseExtraEnv();

  const actionPath = env("GITHUB_ACTION_PATH");
  const runnerTemp = env("RUNNER_TEMP") || "/tmp";
  const workingDirectory = env("MULTI_REVIEW_WORKING_DIRECTORY");

  // 1. Read PR diff (pre-fetched by action.yml)
  const diffPath = join(runnerTemp, ".pr-diff.txt");
  let prDiff = "";
  try {
    prDiff = readFileSync(diffPath, "utf-8");
  } catch {
    console.error("No PR diff found at", diffPath);
    return 1;
  }
  console.log(`PR diff loaded: ${prDiff.length} chars`);

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

  // 4. Configure reasoning/thinking via opencode.json
  const reasoningEffort = env("MULTI_REVIEW_REASONING_EFFORT");
  const enableThinking = env("MULTI_REVIEW_ENABLE_THINKING");
  if (reasoningEffort || enableThinking.toLowerCase() === "true") {
    configureOpencodeJson(reasoningEffort, enableThinking, workingDirectory);
    console.log(`Configured opencode.json: reasoningEffort=${reasoningEffort || "(default)"}, enableThinking=${enableThinking}`);
  }

  // 5. Start opencode server via SDK
  console.log("Starting opencode server...");
  const { client, server } = await createOpencode({
    config: { model: `${providerID}/${modelID}` },
  });
  console.log("Server ready");

  try {
    // 6. Run reviewers in parallel
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

    // 7. Run coordinator
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

    // 8. Post comment
    postPRComment(comment);

    // 9. Cleanup error comments from previous runs
    cleanupErrorComments();

    return 0;
  } finally {
    server.close();
  }
}

main()
  .then((code) => process.exit(code))
  .catch((err) => {
    console.error("Fatal error:", err);
    process.exit(1);
  });
