import type { OpencodeClient } from "@opencode-ai/sdk";
import type { Reviewer, ReviewResult, OrchestratorOptions } from "./types.js";

const DEFAULT_COORDINATOR_PROMPT = `你是一个代码审查协调员。以下审查由独立的专家 reviewer 生成。
你的任务是整合为一个去重后的综合报告。

规则：
1. 跨 reviewer 去重（同一问题只提一次）
2. 交叉验证：至少 2 个 reviewer 同意的问题标记为"已确认"
3. 冲突时取多数意见
4. 保留领域特定见解（如安全发现只来自安全 reviewer）
5. 使用最严重发现的决策作为最终决策
6. 只报告当前代码中仍存在的问题

以下是各 reviewer 的审查结果：

{{REVIEWS}}

输出格式（中文）：
- 第一行：最终决策（可合并 / 有条件合并 / 不可合并）
- 然后简要总结
- "阻塞项"列出合并前必须修复的问题；如无，写"阻塞项：无"
- "建议项"列出非阻塞改进建议；如无，写"建议项：无"`;

function extractText(messages: Array<{ info: { role: string }; parts: Array<{ type: string; text?: string }> }>): string {
  return messages
    .filter((m) => m.info.role === "assistant")
    .flatMap((m) => m.parts.filter((p): p is { type: "text"; text: string } => p.type === "text"))
    .map((p) => p.text)
    .join("\n");
}

export async function runParallelReviewers(
  client: OpencodeClient,
  reviewers: Reviewer[],
  prDiff: string,
  opts: OrchestratorOptions,
): Promise<ReviewResult[]> {
  const deadline = Date.now() + opts.globalTimeoutMs;

  const promises = reviewers.map(async (reviewer) => {
    const remainingMs = Math.max(30_000, deadline - Date.now());
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), remainingMs);

    try {
      const sessionResult = await client.session.create({ throwOnError: true });
      const sessionId = sessionResult.data.id;

      console.log(`[${reviewer.name}] Starting review...`);

      await client.session.prompt({
        path: { id: sessionId },
        body: {
          parts: [{ type: "text", text: reviewer.prompt + "\n\nPR Diff:\n```\n" + prDiff + "\n```" }],
        },
        throwOnError: true,
      });

      const messagesResult = await client.session.messages({
        path: { id: sessionId },
        throwOnError: true,
      });
      const content = extractText(messagesResult.data);

      console.log(`[${reviewer.name}] Review complete (${content.length} chars)`);

      try { await client.session.delete({ path: { id: sessionId } }); } catch { /* ignore */ }
      return { reviewer: reviewer.name, content, success: true };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`[${reviewer.name}] Failed: ${msg}`);
      return { reviewer: reviewer.name, content: "", success: false, error: msg };
    } finally {
      clearTimeout(timeout);
    }
  });

  return Promise.all(promises);
}

export async function runCoordinator(
  client: OpencodeClient,
  reviews: ReviewResult[],
  opts: OrchestratorOptions,
): Promise<string> {
  const reviewsText = reviews
    .map((r) => `## ${r.reviewer}\n${r.success ? r.content : `（失败: ${r.error}）`}`)
    .join("\n\n---\n\n");

  const promptTemplate = opts.coordinatorPrompt || DEFAULT_COORDINATOR_PROMPT;
  const fullPrompt = promptTemplate.replace("{{REVIEWS}}", reviewsText);

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), opts.coordinatorTimeoutMs);

  try {
    const sessionResult = await client.session.create({ throwOnError: true });
    const sessionId = sessionResult.data.id;

    console.log("[coordinator] Starting synthesis...");

    await client.session.prompt({
      path: { id: sessionId },
      body: { parts: [{ type: "text", text: fullPrompt }] },
      throwOnError: true,
    });

    const messagesResult = await client.session.messages({
      path: { id: sessionId },
      throwOnError: true,
    });
    const content = extractText(messagesResult.data);

    console.log(`[coordinator] Synthesis complete (${content.length} chars)`);

    try { await client.session.delete({ path: { id: sessionId } }); } catch { /* ignore */ }
    return content;
  } finally {
    clearTimeout(timeout);
  }
}

export function buildFallbackComment(reviews: ReviewResult[]): string {
  const parts = reviews.map((r) => {
    if (r.success) return `## ${r.reviewer}\n${r.content}`;
    return `## ${r.reviewer}\n（审查失败: ${r.error}）`;
  });
  return "**Multi-Review (fallback — coordinator failed)**\n\n" + parts.join("\n\n---\n\n");
}
