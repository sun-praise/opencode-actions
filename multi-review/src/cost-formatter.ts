import type { ReviewResult, CoordinatorResult } from "./types.js";


/** Module-level singleton to avoid repeated construction. */
const tokFmt = new Intl.NumberFormat("en");

const fmtCost = (n: number): string => {
  const safe = Number.isFinite(n) ? n : 0;
  return `$${safe.toFixed(4)}`;
};
const fmtTok = (n: number): string => tokFmt.format(Number.isFinite(n) ? n : 0);

interface Row {
  role: string;
  /** Cost in ten-thousandths (multiplied by 10000) to avoid float precision errors. */
  costX10000: number;
  input: number;
  output: number;
  reasoning: number;
  cacheRead: number;
  cacheWrite: number;
}

/**
 * Format review cost data as a markdown table wrapped in `<details>` HTML.
 *
 * Cost is accumulated as integer ten-thousandths to avoid floating-point
 * precision errors in the total row.
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
      costX10000: Math.round((r.cost ?? 0) * 10000),
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
      costX10000: Math.round((coordinatorResult!.cost ?? 0) * 10000),
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
      costX10000: acc.costX10000 + r.costX10000,
      input: acc.input + r.input,
      output: acc.output + r.output,
      reasoning: acc.reasoning + r.reasoning,
      cacheRead: acc.cacheRead + r.cacheRead,
      cacheWrite: acc.cacheWrite + r.cacheWrite,
    }),
    { role: "**Total**", costX10000: 0, input: 0, output: 0, reasoning: 0, cacheRead: 0, cacheWrite: 0 },
  );

  const header = "| Role | Cost (USD) | Input | Output | Reasoning | Cache Read | Cache Write |";
  const divider = "| --- | --- | --- | --- | --- | --- | --- |";

  const body = rows
    .map(
      (r) =>
        `| ${r.role} | ${fmtCost(r.costX10000 / 10000)} | ${fmtTok(r.input)} | ${fmtTok(r.output)} | ${fmtTok(r.reasoning)} | ${fmtTok(r.cacheRead)} | ${fmtTok(r.cacheWrite)} |`,
    )
    .join("\n");

  const totalLine = `| **Total** | **${fmtCost(total.costX10000 / 10000)}** | **${fmtTok(total.input)}** | **${fmtTok(total.output)}** | **${fmtTok(total.reasoning)}** | **${fmtTok(total.cacheRead)}** | **${fmtTok(total.cacheWrite)}** |`;

  return `<details>
<summary>💰 Review Cost — ${fmtCost(total.costX10000 / 10000)}</summary>

${header}
${divider}
${body}
${totalLine}

</details>`;
}
