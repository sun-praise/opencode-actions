import type { ParsedReview } from "./types.js";

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
 */
export function shouldFailOnSeverity(
  parsed: ParsedReview | undefined,
  failOnSeverity: string,
): boolean {
  if (!parsed || parsed.fallback) return false;
  if (failOnSeverity === "blocking" && parsed.blocking.length > 0) return true;
  if (failOnSeverity === "warning" && (parsed.blocking.length > 0 || parsed.warning.length > 0)) return true;
  return false;
}
