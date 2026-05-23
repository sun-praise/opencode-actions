// src/index.ts
import { createOpencode } from "@opencode-ai/sdk";
import { readFileSync as readFileSync2 } from "fs";
import { join as join2 } from "path";

// src/reviewers.ts
import { readFileSync } from "fs";
import { join } from "path";
var DEFAULT_TEAM = "quality:1,security:1,performance:1,architecture:1";
function parseTeam(teamStr) {
  const result = /* @__PURE__ */ new Map();
  for (const entry of teamStr.split(",")) {
    const [name, count] = entry.trim().split(":");
    if (name) result.set(name.trim(), Math.max(1, parseInt(count || "1", 10) || 1));
  }
  return result;
}
function loadBuiltInReviewers(reviewersDir) {
  const map = /* @__PURE__ */ new Map();
  for (const file of ["quality.yaml", "security.yaml", "performance.yaml", "architecture.yaml"]) {
    try {
      const raw = readFileSync(join(reviewersDir, file), "utf-8");
      const parsed = parseYAML(raw);
      if (parsed.name && parsed.prompt) map.set(parsed.name, { name: parsed.name, prompt: parsed.prompt });
    } catch {
    }
  }
  return map;
}
function parseYAML(raw) {
  const result = {};
  let currentKey = "";
  let inPrompt = false;
  for (const line of raw.split("\n")) {
    if (!inPrompt && line.match(/^(\w+):\s*(.*)/)) {
      const [, key, value] = line.match(/^(\w+):\s*(.*)/) || [];
      if (key === "prompt" && value.trim().startsWith("|")) {
        inPrompt = true;
        currentKey = "prompt";
        result.prompt = "";
      } else if (key) {
        result[key] = value?.trim() || "";
      }
    } else if (inPrompt) {
      if (line && !line.startsWith(" ") && !line.startsWith("	")) {
        inPrompt = false;
      } else {
        result[currentKey] = (result[currentKey] || "") + line.trimStart() + "\n";
      }
    }
  }
  if (result.prompt) result.prompt = result.prompt.trim();
  return result;
}
function loadReviewers(opts) {
  const builtInDir = join(opts.actionPath, "reviewers");
  const personas = loadBuiltInReviewers(builtInDir);
  const teamStr = opts.team || env("MULTI_REVIEW_DEFAULT_TEAM") || DEFAULT_TEAM;
  const team = parseTeam(teamStr);
  const reviewers = [];
  for (const [name, count] of team) {
    const persona = personas.get(name);
    if (!persona) {
      console.warn(`Warning: unknown reviewer persona "${name}", skipping`);
      continue;
    }
    for (let i = 0; i < count; i++) {
      reviewers.push({
        name: count > 1 ? `${name}-${i + 1}` : name,
        prompt: persona.prompt
      });
    }
  }
  return reviewers;
}
function env(key) {
  return process.env[key] || "";
}
function intEnv(key, fallback) {
  const v = parseInt(process.env[key] || "", 10);
  return isNaN(v) ? fallback : v;
}
function resolveModel() {
  const raw = env("MULTI_REVIEW_MODEL") || env("MODEL_NAME") || "zhipuai-coding-plan/glm-5.1";
  const idx = raw.indexOf("/");
  if (idx === -1) {
    throw new Error(`Model "${raw}" missing provider (expected format: provider/model)`);
  }
  return { providerID: raw.slice(0, idx), modelID: raw.slice(idx + 1) };
}

// src/orchestrator.ts
var DEFAULT_COORDINATOR_PROMPT = `\u4F60\u662F\u4E00\u4E2A\u4EE3\u7801\u5BA1\u67E5\u534F\u8C03\u5458\u3002\u4EE5\u4E0B\u5BA1\u67E5\u7531\u72EC\u7ACB\u7684\u4E13\u5BB6 reviewer \u751F\u6210\u3002
\u4F60\u7684\u4EFB\u52A1\u662F\u6574\u5408\u4E3A\u4E00\u4E2A\u53BB\u91CD\u540E\u7684\u7EFC\u5408\u62A5\u544A\u3002

\u89C4\u5219\uFF1A
1. \u8DE8 reviewer \u53BB\u91CD\uFF08\u540C\u4E00\u95EE\u9898\u53EA\u63D0\u4E00\u6B21\uFF09
2. \u4EA4\u53C9\u9A8C\u8BC1\uFF1A\u81F3\u5C11 2 \u4E2A reviewer \u540C\u610F\u7684\u95EE\u9898\u6807\u8BB0\u4E3A"\u5DF2\u786E\u8BA4"
3. \u51B2\u7A81\u65F6\u53D6\u591A\u6570\u610F\u89C1
4. \u4FDD\u7559\u9886\u57DF\u7279\u5B9A\u89C1\u89E3\uFF08\u5982\u5B89\u5168\u53D1\u73B0\u53EA\u6765\u81EA\u5B89\u5168 reviewer\uFF09
5. \u4F7F\u7528\u6700\u4E25\u91CD\u53D1\u73B0\u7684\u51B3\u7B56\u4F5C\u4E3A\u6700\u7EC8\u51B3\u7B56
6. \u53EA\u62A5\u544A\u5F53\u524D\u4EE3\u7801\u4E2D\u4ECD\u5B58\u5728\u7684\u95EE\u9898

\u4EE5\u4E0B\u662F\u5404 reviewer \u7684\u5BA1\u67E5\u7ED3\u679C\uFF1A

{{REVIEWS}}

\u8F93\u51FA\u683C\u5F0F\uFF08\u4E2D\u6587\uFF09\uFF1A
- \u7B2C\u4E00\u884C\uFF1A\u6700\u7EC8\u51B3\u7B56\uFF08\u53EF\u5408\u5E76 / \u6709\u6761\u4EF6\u5408\u5E76 / \u4E0D\u53EF\u5408\u5E76\uFF09
- \u7136\u540E\u7B80\u8981\u603B\u7ED3
- "\u963B\u585E\u9879"\u5217\u51FA\u5408\u5E76\u524D\u5FC5\u987B\u4FEE\u590D\u7684\u95EE\u9898\uFF1B\u5982\u65E0\uFF0C\u5199"\u963B\u585E\u9879\uFF1A\u65E0"
- "\u5EFA\u8BAE\u9879"\u5217\u51FA\u975E\u963B\u585E\u6539\u8FDB\u5EFA\u8BAE\uFF1B\u5982\u65E0\uFF0C\u5199"\u5EFA\u8BAE\u9879\uFF1A\u65E0"`;
function extractText(messages) {
  return messages.filter((m) => m.info.role === "assistant").flatMap((m) => m.parts.filter((p) => p.type === "text")).map((p) => p.text).join("\n");
}
function withTimeout(promise, ms, label) {
  let timer;
  return Promise.race([
    promise,
    new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms);
    })
  ]).finally(() => {
    if (timer !== void 0) clearTimeout(timer);
  });
}
async function runParallelReviewers(client, reviewers, prDiff, opts) {
  const deadline = Date.now() + opts.globalTimeoutMs;
  const promises = reviewers.map(async (reviewer) => {
    try {
      const remaining = () => Math.max(3e4, deadline - Date.now());
      console.log(`[${reviewer.name}] Starting review (timeout: ${remaining()}ms)...`);
      const sessionResult = await withTimeout(
        client.session.create({ throwOnError: true }),
        remaining(),
        reviewer.name
      );
      const sessionId = sessionResult.data.id;
      const promptResult = await withTimeout(
        client.session.prompt({
          path: { id: sessionId },
          body: {
            parts: [{ type: "text", text: reviewer.prompt + "\n\nPR Diff:\n```\n" + prDiff + "\n```" }]
          },
          throwOnError: true
        }),
        remaining(),
        reviewer.name
      );
      const messagesResult = await withTimeout(
        client.session.messages({ path: { id: sessionId }, throwOnError: true }),
        remaining(),
        reviewer.name
      );
      const content = extractText(messagesResult.data);
      console.log(`[${reviewer.name}] Review complete (${content.length} chars)`);
      try {
        await client.session.delete({ path: { id: sessionId } });
      } catch {
      }
      return { reviewer: reviewer.name, content, success: true };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`[${reviewer.name}] Failed: ${msg}`);
      return { reviewer: reviewer.name, content: "", success: false, error: msg };
    }
  });
  return Promise.all(promises);
}
async function runCoordinator(client, reviews, opts) {
  const reviewsText = reviews.map((r) => `## ${r.reviewer}
${r.success ? r.content : `\uFF08\u5931\u8D25: ${r.error}\uFF09`}`).join("\n\n---\n\n");
  const promptTemplate = opts.coordinatorPrompt || DEFAULT_COORDINATOR_PROMPT;
  const fullPrompt = promptTemplate.split("{{REVIEWS}}").join(reviewsText);
  try {
    const sessionResult = await withTimeout(
      client.session.create({ throwOnError: true }),
      opts.coordinatorTimeoutMs,
      "coordinator"
    );
    const sessionId = sessionResult.data.id;
    console.log("[coordinator] Starting synthesis...");
    await withTimeout(
      client.session.prompt({
        path: { id: sessionId },
        body: { parts: [{ type: "text", text: fullPrompt }] },
        throwOnError: true
      }),
      opts.coordinatorTimeoutMs,
      "coordinator"
    );
    const messagesResult = await withTimeout(
      client.session.messages({ path: { id: sessionId }, throwOnError: true }),
      opts.coordinatorTimeoutMs,
      "coordinator"
    );
    const content = extractText(messagesResult.data);
    console.log(`[coordinator] Synthesis complete (${content.length} chars)`);
    try {
      await client.session.delete({ path: { id: sessionId } });
    } catch {
    }
    return content;
  } catch (err) {
    throw err;
  }
}
function buildFallbackComment(reviews) {
  const parts = reviews.map((r) => {
    if (r.success) return `## ${r.reviewer}
${r.content}`;
    return `## ${r.reviewer}
\uFF08\u5BA1\u67E5\u5931\u8D25: ${r.error}\uFF09`;
  });
  return "**Multi-Review (fallback \u2014 coordinator failed)**\n\n" + parts.join("\n\n---\n\n");
}

// src/comment.ts
import { execFileSync } from "child_process";
function resolvePRNumber() {
  const ref = process.env.GITHUB_REF || "";
  const match = ref.match(/^refs\/pull\/(\d+)\/merge$/);
  return match ? match[1] : null;
}
function postPRComment(body) {
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
      timeout: 3e4,
      stdio: "pipe"
    });
    console.log(`Posted review comment on PR #${prNumber}`);
  } catch (err) {
    console.error(`Failed to post comment: ${err}`);
    console.log("--- Review (fallback) ---");
    console.log(body);
  }
}
function cleanupErrorComments() {
  const enabled = process.env.MULTI_REVIEW_CLEANUP_ERROR_COMMENTS || "true";
  if (enabled.toLowerCase() !== "true") return;
  const prNumber = resolvePRNumber();
  if (!prNumber) return;
  const repo = process.env.GITHUB_REPOSITORY || "";
  const runId = process.env.GITHUB_RUN_ID || "";
  if (!repo || !runId) return;
  const runLinkPattern = `/${repo}/actions/runs/${runId}`;
  const errorRe = /(fatal:|remote:|error:\s*\d{3}|unable to access|Write access|permission denied)/i;
  let comments;
  try {
    const raw = execFileSync("gh", ["api", "--paginate", "-H", "Accept: application/vnd.github+json", `/repos/${repo}/issues/${prNumber}/comments`], {
      env: { ...process.env },
      timeout: 3e4,
      stdio: "pipe",
      maxBuffer: 5 * 1024 * 1024
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
        timeout: 1e4,
        stdio: "pipe"
      });
      console.log(`Deleted error comment ${comment.id}`);
    } catch {
    }
  }
}
function parseExtraEnv() {
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

// src/index.ts
async function main() {
  parseExtraEnv();
  const actionPath = env("GITHUB_ACTION_PATH");
  const runnerTemp = env("RUNNER_TEMP") || "/tmp";
  const diffPath = join2(runnerTemp, ".pr-diff.txt");
  let prDiff = "";
  try {
    prDiff = readFileSync2(diffPath, "utf-8");
  } catch {
    console.error("No PR diff found at", diffPath);
    return 1;
  }
  console.log(`PR diff loaded: ${prDiff.length} chars`);
  const reviewers = loadReviewers({ actionPath });
  if (reviewers.length === 0) {
    console.error("No reviewers configured");
    return 1;
  }
  console.log(`Reviewers: ${reviewers.map((r) => r.name).join(", ")}`);
  const { providerID, modelID } = resolveModel();
  console.log(`Model: ${providerID}/${modelID}`);
  console.log("Starting opencode server...");
  const { client, server } = await createOpencode({
    config: { model: `${providerID}/${modelID}` }
  });
  console.log("Server ready");
  try {
    const globalTimeout = intEnv("MULTI_REVIEW_TIMEOUT_SECONDS", 900);
    const coordinatorTimeout = intEnv("MULTI_REVIEW_COORDINATOR_TIMEOUT_SECONDS", 300);
    const reviews = await runParallelReviewers(client, reviewers, prDiff, {
      globalTimeoutMs: globalTimeout * 1e3,
      coordinatorTimeoutMs: coordinatorTimeout * 1e3,
      coordinatorPrompt: env("MULTI_REVIEW_COORDINATOR_PROMPT")
    });
    const successCount = reviews.filter((r) => r.success).length;
    console.log(`Reviews: ${successCount}/${reviews.length} succeeded`);
    if (successCount === 0) {
      console.error("All reviewers failed");
      return 1;
    }
    let comment;
    try {
      comment = await runCoordinator(client, reviews, {
        globalTimeoutMs: globalTimeout * 1e3,
        coordinatorTimeoutMs: coordinatorTimeout * 1e3,
        coordinatorPrompt: env("MULTI_REVIEW_COORDINATOR_PROMPT")
      });
    } catch (err) {
      console.error(`Coordinator failed: ${err}`);
      comment = buildFallbackComment(reviews);
    }
    postPRComment(comment);
    cleanupErrorComments();
    return 0;
  } finally {
    server.close();
  }
}
main().then((code) => process.exit(code)).catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
