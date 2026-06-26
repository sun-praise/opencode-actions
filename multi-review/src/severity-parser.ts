import type { ParsedReview, ReviewResult } from "./types.js";

/**
 * Parse coordinator LLM output into structured severity groups.
 *
 * Extracts a top-level decision line and groups list items under
 * severity headings (blocking / warning / suggestion). Falls back to
 * raw-text mode when no severity headings are detected.
 */
export function parseSeverity(text: string): ParsedReview {
  const decision = extractDecision(text);
  const result: ParsedReview = {
    decision,
    summary: "",
    blocking: [],
    warning: [],
    suggestion: [],
    fallback: false,
    rawText: text,
  };

  // Matches: "### 🔴 阻塞项" | "### 🔴 阻塞项 / Blocking Issues" | "### Blocking Issues" etc.
  const sectionRegex =
    /^###\s*(?:🔴|🟡|🟢)?\s*(阻塞项|Blocking Issues?|警告项|Warnings?|建议项|Suggestions?)(?:\s+\/.*)?$/gim;
  const nextHeadingRegex = /^###\s/m;

  let match: RegExpExecArray | null;
  let foundAny = false;
  let firstHeadingIndex = text.length;

  while ((match = sectionRegex.exec(text)) !== null) {
    foundAny = true;
    if (match.index < firstHeadingIndex) firstHeadingIndex = match.index;

    const heading = match[1].toLowerCase();
    const bodyStart = match.index + match[0].length;

    // Find where the next ### heading starts (or end of text)
    const rest = text.slice(bodyStart);
    const nextMatch = rest.search(nextHeadingRegex);
    const body = nextMatch === -1 ? rest : rest.slice(0, nextMatch);

    const items = parseListItems(body);
    const key =
      heading === "阻塞项" || heading.startsWith("blocking") ? "blocking"
      : heading === "警告项" || heading.startsWith("warning") ? "warning"
      : heading === "建议项" || heading.startsWith("suggestion") ? "suggestion"
      : null;
    if (key) result[key].push(...items);
  }

  // Extract summary: text between decision line and first ### heading
  const firstLineEnd = text.indexOf("\n");
  const afterDecision = firstLineEnd === -1 ? "" : text.slice(firstLineEnd + 1);
  const summaryText = afterDecision.slice(0, firstHeadingIndex - (firstLineEnd + 1)).trim();
  result.summary = summaryText;

  if (!foundAny) {
    result.fallback = true;
  }

  return result;
}

/** Extract the decision from the first non-empty line. */
function extractDecision(text: string): string | null {
  const lines = text.split("\n");
  for (const raw of lines) {
    const line = raw.trim();
    if (line === "") continue;

    const lower = line.toLowerCase();
    if (lower.includes("不可合并") || lower.includes("cannot merge")) {
      return "CANNOT MERGE";
    }
    if (lower.includes("有条件合并") || lower.includes("conditional merge")) {
      return "CONDITIONAL MERGE";
    }
    if (lower.includes("可合并") || lower.includes("can merge")) {
      return "CAN MERGE";
    }

    // Only inspect the first non-empty line
    break;
  }
  return null;
}


/** Collect list-item lines, stripping markers. Ignores "无" / "None". */
function parseListItems(body: string): string[] {
  const items: string[] = [];
  for (const raw of body.split("\n")) {
    const line = raw.trim();
    if (line === "") continue;

    // Match common list markers: "- ", "* ", "1. ", "2. ", etc.
    const itemMatch = line.match(/^[-*]\s+(.+)$|^(\d+)\.\s+(.+)$/);
    if (!itemMatch) continue;

    const content = (itemMatch[1] ?? itemMatch[3]).trim();
    const lower = content.toLowerCase();
    if (lower === "无" || lower === "none") continue;

    items.push(content);
  }
  return items;
}

/**
 * Determine whether the severity gate should trigger a non-zero exit.
 * Pure function — no env access, no side effects.
 *
 * Fail-closed semantics for parse uncertainty (see issue #280):
 * - `failOnSeverity === "none"` — user opted out of severity gating; never
 *   trigger on parse state alone.
 * - `parsed === undefined` — coordinator crashed before producing output.
 *   We have no evidence either way; fail closed when the gate is armed.
 * - `parsed.fallback === true` — coordinator produced text but it lacked
 *   severity headings, so we cannot tell whether blocking/warning issues
 *   exist. Fail closed when the gate is armed (no parse → no certification).
 * - Otherwise apply the configured severity threshold.
 */
export function shouldFailOnSeverity(
  parsed: ParsedReview | undefined,
  failOnSeverity: string,
): boolean {
  if (failOnSeverity === "none") return false;
  if (!parsed) return true;
  if (parsed.fallback) return true;
  if (failOnSeverity === "blocking" && parsed.blocking.length > 0) return true;
  if (failOnSeverity === "warning" && (parsed.blocking.length > 0 || parsed.warning.length > 0)) return true;
  return false;
}

/**
 * Names of reviewers whose output cannot be trusted as evidence.
 *
 * A reviewer is "missing evidence" when EITHER:
 * - `success === false` (the session.prompt threw — auth failure, timeout,
 *   model error, etc.), OR
 * - `success === true` but `content.trim() === ""` (session returned but
 *   produced no assistant text — silent empty completion).
 *
 * Pure function — no env access, no side effects.
 */
export function findMissingReviewers(reviews: ReviewResult[]): string[] {
  const missing: string[] = [];
  for (const r of reviews) {
    if (!r.success || r.content.trim() === "") missing.push(r.reviewer);
  }
  return missing;
}

/**
 * Determine whether missing-reviewer evidence should fail the action.
 *
 * Missing reviewer evidence is an infrastructure failure (not a severity
 * opinion), so it fails closed REGARDLESS of the `failOnSeverity` setting —
 * "reviewer didn't run" cannot be interpreted as "reviewer said pass".
 *
 * The empty-list case is the only one that lets the action exit 0, which
 * matches the previous happy-path behavior.
 *
 * Pure function — no env access, no side effects.
 */
export function shouldFailOnMissingReviewers(missingReviewers: string[]): boolean {
  return missingReviewers.length > 0;
}
