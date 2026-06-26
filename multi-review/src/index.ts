import { createOpencode } from "@opencode-ai/sdk";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { rm } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { loadReviewers, resolveModel, env, intEnv } from "./reviewers.js";
import { runParallelReviewers, runCoordinator, buildFallbackComment, buildReviewerDetails, cleanupAllSessions } from "./orchestrator.js";
import { formatCostTable } from "./cost-formatter.js";
import { fetchPRDiff, resolvePRNumber, postPRComment, cleanupErrorComments, parseExtraEnv } from "./platform.js";
import { filterDiff } from "./diff-filter.js";
import { parseSeverity, shouldFailOnSeverity, findMissingReviewers, shouldFailOnMissingReviewers } from "./severity-parser.js";
import { renderSeverityComment } from "./severity-renderer.js";
import { loadReviewContext, saveReviewContext, formatPreviousContext, loadReviewBundles, saveReviewBundles } from "./context-cache.js";
import { exportSession } from "./opencode-bundle.js";
import { restoreSessionBundles } from "./session-resume.js";
import type { ParsedReview, CoordinatorResult, ReviewSession, SessionBundle } from "./types.js";

const ALLOWED_REASONING_EFFORTS = new Set(["low", "medium", "high", "max"]);

/**
 * Build SDK config with model, reasoning-effort, and thinking settings.
 * Uses the SDK config layer instead of writing opencode.json — no file side effects.
 */
function buildSdkConfig(model: string): Record<string, unknown> {
  const config: Record<string, unknown> = { model };
  // Inject litellm provider when model starts with "litellm/" and LITELLM_URL is set.
  // opencode has no built-in litellm provider; we use @ai-sdk/openai to talk to
  // any OpenAI-compatible proxy (LiteLLM, etc.) with standard function-type tools.
  const litellmUrl = env("LITELLM_URL");
  if (model.startsWith("litellm/") && litellmUrl) {
    const modelId = model.slice("litellm/".length);
    config.provider = {
      litellm: {
        npm: "@ai-sdk/openai",
        name: "LiteLLM",
        options: { baseURL: litellmUrl.replace(/\/+$/, "") + "/v1" },
        models: { [modelId]: { name: modelId } },
      },
    };
  }
  const reasoningEffort = env("MULTI_REVIEW_REASONING_EFFORT");
  const enableThinkingRaw = env("MULTI_REVIEW_ENABLE_THINKING");
  const enableThinking = enableThinkingRaw.toLowerCase() === "true";
  const agentOptions: Record<string, unknown> = {};
  if (reasoningEffort) {
    if (!ALLOWED_REASONING_EFFORTS.has(reasoningEffort)) {
      console.warn(`Warning: invalid reasoning-effort "${reasoningEffort}", ignoring (allowed: low, medium, high, max)`);
    } else {
      agentOptions.reasoningEffort = reasoningEffort;
    }
  }
  if (enableThinking) {
    agentOptions.thinking = { type: "enabled" };
  }
  // Read-only review: deny all editing and shell access
  const agent: Record<string, unknown> = { permission: { edit: "deny", bash: "deny" } };
  if (Object.keys(agentOptions).length > 0) {
    agent.build = { options: agentOptions };
  }
  config.agent = agent;
  return config;
}

async function main(): Promise<number> {
  // 0. Parse extra env vars into process.env
  const envResult = parseExtraEnv();
  if (envResult.blockedKeys.length > 0) {
    return 1;
  }

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

  const prNumber = resolvePRNumber();

  // Load previous review context for the same PR when available.
  const previousContext = prNumber ? await loadReviewContext(prNumber) : null;
  const previousContextText = previousContext ? formatPreviousContext(previousContext) : undefined;
  if (previousContext) {
    console.log(
      `Loaded previous review context for PR #${prNumber}: ${previousContext.sessions.length} sessions`,
    );
  }

  if (!prDiff.trim()) {
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
    console.error(
      `PR diff is empty or unavailable (PR #${prNumber || "?"}) — skipping review. ` +
      "All diff methods failed: gh CLI, REST API, and local git diff.");
    return 1;
  }

  // Filter lock files and auto-generated files to keep LLM request size manageable
  const excludeRaw = env("MULTI_REVIEW_DIFF_EXCLUDE");
  const excludePatterns = excludeRaw ? excludeRaw.split(",").map((s) => s.trim()).filter(Boolean) : undefined;
  const maxDiffKb = intEnv("MULTI_REVIEW_DIFF_MAX_SIZE_KB", 0);
  const { filtered: reviewDiff, removedFiles: excludedFiles, truncated, filteredBytes } = filterDiff(prDiff, {
    excludePatterns,
    maxSizeBytes: maxDiffKb > 0 ? maxDiffKb * 1024 : undefined,
  });
  if (excludedFiles.length > 0) {
    console.log(`Excluded ${excludedFiles.length} lock/auto-generated files from diff: ${excludedFiles.join(", ")}`);
  }
  if (truncated) {
    console.log(`Diff truncated to fit size limit: ${Math.round((filteredBytes ?? 0) / 1024)} KB after filtering, showing first sections`);
  }
  const diffForReview = reviewDiff;

  // 2. Load reviewers (repoDir = workspace root for custom persona loading)
  const repoDir = env("GITHUB_WORKSPACE") || process.cwd();
  const reviewers = loadReviewers({ actionPath, repoDir });
  if (reviewers.length === 0) {
    console.error("No reviewers configured");
    return 1;
  }
  console.log(`Reviewers: ${reviewers.map((r) => r.name).join(", ")}`);

  // 3. Resolve model
  const { providerID, modelID } = resolveModel();
  console.log(`Model: ${providerID}/${modelID}`);

  // 4. v2 cache: try to load session bundles for true cross-runner resume.
  //    When bundles exist, switch to a temp XDG_DATA_HOME so we can
  //    import them into a fresh DB without polluting the runner's main
  //    ~/.local/share/opencode. The map returned to the orchestrator
  //    tells each reviewer which sessionID to continue (if any).
  const reviewBundles = prNumber ? await loadReviewBundles(prNumber) : null;
  const { existingSessions, tempDataHome } = await restoreSessionBundles(reviewBundles, {
    baseTempDir: runnerTemp,
    prLabel: prNumber ? String(prNumber) : "ad-hoc",
  });

  // 5. Start opencode server via SDK
  console.log("Starting opencode server...");
  const sdkConfig = buildSdkConfig(`${providerID}/${modelID}`);
  // Inject litellm API key into opencode's auth.json so the custom provider
  // can authenticate with the proxy.  Safe to call even when not using litellm.
  // When XDG_DATA_HOME is redirected (v2 resume path), auth must live in
  // the redirected location — opencode reads from XDG_DATA_HOME, not $HOME.
  const litellmApiKey = env("LITELLM_API_KEY");
  if (providerID === "litellm" && litellmApiKey) {
    const xdgData = process.env.XDG_DATA_HOME || join(homedir(), ".local", "share");
    const authDir = join(xdgData, "opencode");
    mkdirSync(authDir, { recursive: true });
    const authPath = join(authDir, "auth.json");
    let auth: Record<string, unknown> = {};
    if (existsSync(authPath)) {
      try { auth = JSON.parse(readFileSync(authPath, "utf-8")); } catch { auth = {}; }
    }
    auth.litellm = { type: "api", key: litellmApiKey };
    writeFileSync(authPath, JSON.stringify(auth));
  }
  // SDK 默认 server-start 超时仅 5000ms，繁忙 self-hosted runner 上 opencode binary 启动常 >5s
  // 导致 "Timeout waiting for server to start"。放宽默认到 30s 并允许 env 覆盖。
  const serverTimeoutMs = intEnv("MULTI_REVIEW_SERVER_TIMEOUT_MS", 30000);
  const { client, server } = await createOpencode({
    config: sdkConfig as any,
    timeout: serverTimeoutMs,
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

    // v2 export (step 7b) runs after the review+coordinator and needs
    // every session still alive in the DB so `opencode export <id>` can
    // read it. So we keep sessions across the review step whenever we
    // are going to export (= we know the PR number), and let the outer
    // finally's cleanupAllSessions delete them all afterwards. This flag
    // expresses that intent explicitly; it MUST NOT be gated on
    // tempDataHome — the FIRST run (no tempDataHome) also exports.
    const willExportSessions = Boolean(prNumber);

    const reviews = await runParallelReviewers(client, reviewers, diffForReview, {
      globalTimeoutMs: globalTimeout * 1000,
      coordinatorTimeoutMs: coordinatorTimeout * 1000,
      coordinatorPrompt: env("MULTI_REVIEW_COORDINATOR_PROMPT"),
      previousContextText,
      existingSessions,
      skipSessionCleanup: willExportSessions,
    });

    const missingReviewers = findMissingReviewers(reviews);
    const successCount = reviews.length - missingReviewers.length;
    console.log(
      `Reviews: ${successCount}/${reviews.length} succeeded` +
      (missingReviewers.length > 0 ? `; missing evidence: ${missingReviewers.join(", ")}` : ""),
    );

    // All-failure is the existing hard gate. Partial failure is handled
    // below by `shouldFailOnMissingReviewers` after the coordinator runs
    // (so the user still gets a useful synthesized comment).
    if (missingReviewers.length === reviews.length) {
      console.error("All reviewers failed");
      return 1;
    }

    // 6. Run coordinator
    let comment: string;
    let parsedSeverity: ParsedReview | undefined;
    let coordinatorResult: CoordinatorResult | undefined;
    try {
      coordinatorResult = await runCoordinator(client, reviews, {
        globalTimeoutMs: globalTimeout * 1000,
        coordinatorTimeoutMs: coordinatorTimeout * 1000,
        coordinatorPrompt: env("MULTI_REVIEW_COORDINATOR_PROMPT"),
        existingSessions,
        // Keep coordinator session alive for v2 export (see willExportSessions).
        skipSessionCleanup: willExportSessions,
      });
      // Parse severity from coordinator output
      parsedSeverity = parseSeverity(coordinatorResult.content);
      const reviewerDetails = buildReviewerDetails(reviews);
      const costTable = formatCostTable(reviews, coordinatorResult);
      comment = renderSeverityComment(parsedSeverity, costTable + "\n" + reviewerDetails);
      console.log(`Severity: blocking=${parsedSeverity.blocking.length} warning=${parsedSeverity.warning.length} suggestion=${parsedSeverity.suggestion.length} fallback=${parsedSeverity.fallback}`);
    } catch (err) {
      console.error(`Coordinator failed: ${err}`);
      const costTable = formatCostTable(reviews);
      comment = buildFallbackComment(reviews) + "\n" + costTable;
    }

    // 7. Persist review context for the same PR (best-effort)
    if (prNumber) {
      const newSessions: ReviewSession[] = reviews
        .filter((r) => r.success && r.messages && r.messages.length > 0)
        .map((r) => ({ name: r.reviewer, messages: r.messages! }));
      if (coordinatorResult?.messages && coordinatorResult.messages.length > 0) {
        newSessions.push({ name: "coordinator", messages: coordinatorResult.messages });
      }
      await saveReviewContext(prNumber, newSessions);
    }

    // 7b. v2: export each session's current state and save as bundles.
    //     Run AFTER the review/coordinator finished so the opencode DB
    //     has the latest user+assistant messages for every session.
    //     Exported in parallel — each export invokes a fresh `opencode`
    //     subprocess, and they're independent, so wall-clock time is
    //     determined by the slowest single export rather than the sum.
    if (prNumber) {
      const exportEnv = { ...process.env };
      if (tempDataHome) exportEnv.XDG_DATA_HOME = tempDataHome;
      const exportTargets: Array<{ name: string; sessionID: string | undefined }> = [
        ...reviews
          .filter((r) => r.success && r.sessionID)
          .map((r) => ({ name: r.reviewer, sessionID: r.sessionID! })),
        { name: "coordinator", sessionID: coordinatorResult?.sessionID },
      ].filter((t): t is { name: string; sessionID: string } => Boolean(t.sessionID));
      const exportResults = await Promise.allSettled(
        exportTargets.map(async (t) => {
          const bundle = (await exportSession(t.sessionID, exportEnv)) as Record<string, unknown>;
          return { name: t.name, sessionID: t.sessionID, bundle, savedAt: new Date().toISOString() };
        }),
      );
      const newBundles: SessionBundle[] = [];
      for (let i = 0; i < exportResults.length; i++) {
        const r = exportResults[i];
        const t = exportTargets[i];
        if (r.status === "fulfilled") {
          newBundles.push(r.value);
        } else {
          console.warn(`v2 save: failed to export session ${t.sessionID} (${t.name}): ${r.reason instanceof Error ? r.reason.message : r.reason}`);
        }
      }
      if (newBundles.length > 0) {
        await saveReviewBundles(prNumber, newBundles);
      }
    }

    // 8. Post comment
    postPRComment(comment);

    // 10. Severity gate + missing-reviewer fail-closed gate.
    //     Both gates run after the comment is posted so the user sees the
    //     synthesized explanation; exit code is determined by the gates.
    //     Issue #280: missing-reviewer evidence is an infrastructure
    //     failure, not a severity opinion, so it fails closed regardless of
    //     the `MULTI_REVIEW_FAIL_ON_SEVERITY` setting.
    const failOn = env("MULTI_REVIEW_FAIL_ON_SEVERITY") || "none";
    if (shouldFailOnMissingReviewers(missingReviewers)) {
      console.error(
        `Reviewer evidence missing for: ${missingReviewers.join(", ")} — failing closed. ` +
        "Treat the absence as a blocking finding; rerun after fixing provider/auth or model availability.",
      );
      return 1;
    }
    if (shouldFailOnSeverity(parsedSeverity, failOn)) {
      const b = parsedSeverity?.blocking.length ?? 0;
      const w = parsedSeverity?.warning.length ?? 0;
      console.error(`Severity gate: ${b} blocking + ${w} warning issue(s) found — failing.`);
      return 1;
    }

    return 0;
  } finally {
    await cleanupAllSessions(client);
    server.close();
    // Clean up the v2 temp XDG_DATA_HOME if we created one. The actual
    // bundles are now in the cache server, so the local DB is no longer
    // needed. Keep it if debugging is enabled (preserved for postmortem).
    //
    // SECURITY: setting MULTI_REVIEW_KEEP_TEMP_DB=1 leaves the local
    // opencode.db on disk after the run. That DB contains the full
    // session history including user-supplied PR diffs and any
    // tool-output the opencode server captured. Only enable this on
    // disposable CI runners you control. Default is cleanup (only set
    // this when actively debugging).
    if (tempDataHome && existsSync(tempDataHome) && env("MULTI_REVIEW_KEEP_TEMP_DB") !== "1") {
      try { await rm(tempDataHome, { recursive: true, force: true }); } catch { /* ignore */ }
    }
  }
}

main()
  .then((code) => process.exit(code))
  .catch((err) => {
    console.error("Fatal error:", err);
    process.exit(1);
  });
