import type { ParsedReview } from "./types.js";

/**
 * Decision label mapping – internal decision string → bilingual display text.
 */
const DECISION_LABELS: Record<string, string> = {
  "CAN MERGE": "✅ 可合并 / CAN MERGE",
  "CONDITIONAL MERGE": "⚠️ 有条件合并 / CONDITIONAL MERGE",
  "CANNOT MERGE": "🚫 不可合并 / CANNOT MERGE",
};

/**
 * Severity section descriptor: key on ParsedReview, heading text, and emoji marker.
 */
interface SeveritySection {
  key: "blocking" | "warning" | "suggestion";
  heading: string;
}

const SECTIONS: SeveritySection[] = [
  { key: "blocking", heading: "🔴 阻塞项 / Blocking Issues" },
  { key: "warning", heading: "🟡 警告项 / Warnings" },
  { key: "suggestion", heading: "🟢 建议项 / Suggestions" },
];

/**
 * Render a parsed review into a structured, bilingual comment body.
 *
 * - When `parsed.fallback` is `true`, the original raw text is returned
 *   verbatim followed by the reviewer details.
 * - Otherwise the output contains a decision line (if present), severity
 *   sections for each non-empty array, and the reviewer details footer.
 * - If all severity arrays are empty and fallback is false, a
 *   "No issues found" note is shown after the decision line.
 *
 * @param parsed - The parsed review output from the severity parser.
 * @param reviewerDetails - Human-readable label listing the reviewers involved.
 * @returns The formatted comment string.
 */
export function renderSeverityComment(
  parsed: ParsedReview,
  reviewerDetails: string,
): string {
  if (parsed.fallback) {
    return parsed.rawText + "\n" + reviewerDetails;
  }

  const lines: string[] = [];

  // ── Decision line ──────────────────────────────────────────────────
  if (parsed.decision != null) {
    const label = DECISION_LABELS[parsed.decision];
    lines.push(label ?? parsed.decision);
  }

  // ── Summary paragraph ─────────────────────────────────────────────
  if (parsed.summary) {
    lines.push("", parsed.summary);
  }

  // ── Severity sections ──────────────────────────────────────────────
  const totalIssues =
    parsed.blocking.length +
    parsed.warning.length +
    parsed.suggestion.length;

  for (const section of SECTIONS) {
    const items = parsed[section.key];
    if (items.length === 0) continue;

    lines.push(
      `### ${section.heading} (${items.length})`,
      ...items.map((item) => `- ${item}`),
    );
  }

  // ── No-issues note ─────────────────────────────────────────────────
  if (totalIssues === 0) {
    lines.push("> ℹ️ No issues found / 未发现问题");
  }

  // ── Reviewer details footer ────────────────────────────────────────
  lines.push("", reviewerDetails);

  return lines.join("\n");
}
