/**
 * Strip lock files and auto-generated files from a unified diff to keep
 * LLM request sizes manageable. Lock files can easily push diffs past 1MB,
 * which exceeds model context windows and causes "Unexpected server error"
 * across all reviewers simultaneously.
 */

/** Patterns that match basenames of known lock / auto-generated files. */
const LOCK_PATTERNS: RegExp[] = [
  // All *.lock and *.lockb files
  /\.lockb?$/,
  // Specific well-known lock files (catches alternate naming)
  /^(pnpm-lock|package-lock|yarn|bun)\.(yaml|json|lock|lockb)$/,
  // Python / Rust / Ruby / PHP / Go ecosystem lock files
  /^(uv|poetry|Gemfile|Cargo|composer)\.lock$/,
  /^go\.sum$/,
  /^(Pipfile|requirements)\.lock$/,
  // Nix flake lock
  /^flake\.lock$/,
];

/** Options for filterDiff. */
export interface FilterDiffOptions {
  /** Additional glob patterns to exclude, matched against the full file path
   *  in the diff header (e.g. "vendor/**", "*.generated.ts"). */
  excludePatterns?: string[];
  /** Maximum diff size in bytes. If the filtered diff exceeds this, sections
   *  are dropped from the end and a truncation notice is appended. */
  maxSizeBytes?: number;
}

export interface FilterDiffResult {
  filtered: string;
  removedFiles: string[];
  truncated?: boolean;
  originalBytes?: number;
}

/**
 * Convert a simple glob pattern to a RegExp.
   Supports *, ?, and ** (globstar).
 */
function globToRegex(pattern: string): RegExp {
  const escaped = pattern
    .replace(/[.+^${}()|[\]\\]/g, "\\$&")
    .replace(/\*\*/g, "{{GLOBSTAR}}")
    .replace(/\*/g, "[^/]*")
    .replace(/\?/g, "[^/]")
    .replace(/\{\{GLOBSTAR\}\}/g, ".*");
  return new RegExp("^" + escaped + "$");
}

/** Pre-parsed exclusion rule: regex + whether to match against full path or basename. */
interface ExcludeRule {
  regex: RegExp;
  /** true = match against full path; false = match against basename only. */
  full: boolean;
}

/** Build exclusion rules from glob patterns. Gitignore convention:
 *  patterns without "/" match against basename; patterns with "/" match full path. */
function buildExcludeRules(patterns: string[]): ExcludeRule[] {
  return patterns.map((p) => ({
    regex: globToRegex(p),
    full: p.includes("/"),
  }));
}

/**
 * Parse a "diff --git a/<path> b/<path>" header line and return the b-side path.
 */
function parseDiffPath(header: string): string | null {
  const m = header.match(/^diff --git a\/.* b\/(.+?)(?:\s|$)/);
  return m ? m[1] : null;
}

/** Extract basename from a file path. */
function basenameOf(path: string): string {
  const idx = path.lastIndexOf("/");
  return idx >= 0 ? path.slice(idx + 1) : path;
}

/**
 * Filter lock / auto-generated files from a unified diff string.
 *
 * Parses the diff into per-file sections, removes any section whose
 * path matches a lock file pattern or user-provided exclusion, and
 * optionally truncates the result to stay within a byte budget.
 */
export function filterDiff(
  diff: string,
  options?: FilterDiffOptions,
): FilterDiffResult {
  if (!diff) return { filtered: "", removedFiles: [] };

  const excludeRules = buildExcludeRules(options?.excludePatterns ?? []);
  const maxBytes = options?.maxSizeBytes;

  const sections = diff.split(/(?=^diff --git )/m);
  const kept: string[] = [];
  const removed: string[] = [];

  for (const section of sections) {
    if (!section) continue;

    const newlineIdx = section.indexOf("\n");
    const header = newlineIdx >= 0 ? section.slice(0, newlineIdx) : section;

    const filePath = parseDiffPath(header);
    const base = filePath ? basenameOf(filePath) : null;

    const isLock = base && LOCK_PATTERNS.some((re) => re.test(base));
    const isExcluded =
      (base && excludeRules.some((r) => !r.full && r.regex.test(base))) ||
      (filePath && excludeRules.some((r) => r.full && r.regex.test(filePath)));

    if (isLock || isExcluded) {
      removed.push(filePath || base || "unknown");
    } else {
      kept.push(section);
    }
  }

  let filtered = kept.join("");
  let truncated: boolean | undefined;
  const originalBytes = Buffer.byteLength(filtered, "utf-8");

  if (maxBytes && originalBytes > maxBytes) {
    // Truncate: keep whole sections from the start until budget exhausted
    const truncatedKept: string[] = [];
    let budget = maxBytes;
    for (const section of kept) {
      const size = Buffer.byteLength(section, "utf-8");
      if (size > budget) break;
      truncatedKept.push(section);
      budget -= size;
    }
    const shownCount = truncatedKept.length;
    const totalCount = kept.length;
    const notice = `\n[Diff truncated: ${shownCount} of ${totalCount} file sections shown — ${Math.round(originalBytes / 1024)} KB total after lock-file filtering]\n`;
    filtered = truncatedKept.join("") + notice;
    truncated = true;
  }

  const result: FilterDiffResult = { filtered, removedFiles: removed };
  if (truncated) {
    result.truncated = true;
    result.originalBytes = originalBytes;
  }
  return result;
}