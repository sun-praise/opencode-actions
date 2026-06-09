import type { ReviewResult } from "./types.js";
import type { CoordinatorResult } from "./orchestrator.js";

/** Read language from env (set by action.yml from `language` input). */
function getLang(): "zh" | "en" {
  const raw = process.env.MULTI_REVIEW_LANGUAGE?.trim().toLowerCase();
  return raw === "en" ? "en" : "zh";
}

const fmtCost = (n: number, lang: "zh" | "en"): string =>
  lang === "zh" ? `¥${n.toFixed(4)}` : `$${n.toFixed(4)}`;
const fmtTok = (n: number): string => new Intl.NumberFormat("en-US").format(n);

interface Row {
  role: string;
  cost: number;
  input: number;
  output: number;
  reasoning: number;
  cacheRead: number;
  cacheWrite: number;
}

/**
 * Format review cost data as a markdown table wrapped in `<details>` HTML.
 *
 * @param reviews - Individual reviewer results.
 * @param coordinatorResult - Optional coordinator result to include.
 * @returns A markdown string, or empty string when no cost data is present.
 */
export function formatCostTable(
  reviews: ReviewResult[],
  coordinatorResult?: CoordinatorResult,
): string {
  const reviewRows: Row[] = reviews
    .filter((r) => r.success && r.cost !== undefined)
    .map((r) => ({
      role: r.reviewer,
      cost: r.cost!,
      input: r.tokens?.input ?? 0,
      output: r.tokens?.output ?? 0,
      reasoning: r.tokens?.reasoning ?? 0,
      cacheRead: r.tokens?.cache.read ?? 0,
      cacheWrite: r.tokens?.cache.write ?? 0,
    }));

  const hasCoordinatorCost =
    coordinatorResult !== undefined && coordinatorResult.cost !== undefined;

  if (reviewRows.length === 0 && !hasCoordinatorCost) return "";

  const rows: Row[] = [...reviewRows];

  if (hasCoordinatorCost) {
    rows.push({
      role: "coordinator",
      cost: coordinatorResult!.cost!,
      input: coordinatorResult!.tokens?.input ?? 0,
      output: coordinatorResult!.tokens?.output ?? 0,
      reasoning: coordinatorResult!.tokens?.reasoning ?? 0,
      cacheRead: coordinatorResult!.tokens?.cache.read ?? 0,
      cacheWrite: coordinatorResult!.tokens?.cache.write ?? 0,
    });
  }

  const total: Row = rows.reduce(
    (acc, r) => ({
      role: "**Total**",
      cost: acc.cost + r.cost,
      input: acc.input + r.input,
      output: acc.output + r.output,
      reasoning: acc.reasoning + r.reasoning,
      cacheRead: acc.cacheRead + r.cacheRead,
      cacheWrite: acc.cacheWrite + r.cacheWrite,
    }),
    { role: "**Total**", cost: 0, input: 0, output: 0, reasoning: 0, cacheRead: 0, cacheWrite: 0 },
  );
  const lang = getLang();
  const costLabel = lang === "zh" ? "花费 (CNY)" : "Cost (USD)";
  const summaryText = lang === "zh" ? "💰 审查花费" : "💰 Review Cost";
  const header = `| Role | ${costLabel} | Input | Output | Reasoning | Cache Read | Cache Write |`;
  const divider = "| --- | --- | --- | --- | --- | --- | --- |";

  const body = rows
    .map(
      (r) =>
        `| ${r.role} | ${fmtCost(r.cost, lang)} | ${fmtTok(r.input)} | ${fmtTok(r.output)} | ${fmtTok(r.reasoning)} | ${fmtTok(r.cacheRead)} | ${fmtTok(r.cacheWrite)} |`,
    )
    .join("\n");

  const totalLine = `| **Total** | **${fmtCost(total.cost, lang)}** | **${fmtTok(total.input)}** | **${fmtTok(total.output)}** | **${fmtTok(total.reasoning)}** | **${fmtTok(total.cacheRead)}** | **${fmtTok(total.cacheWrite)}** |`;

  return `<details>
<summary>${summaryText} — ${fmtCost(total.cost, lang)}</summary>

${header}
${divider}
${body}
${totalLine}

</details>`;
}
