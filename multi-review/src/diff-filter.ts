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

/**
 * Filter lock / auto-generated files from a unified diff string.
 *
 * Parses the diff into per-file sections, removes any section whose
 * basename matches a lock file pattern, and returns the filtered diff.
 * Also returns the list of removed filenames for logging.
 */
export function filterDiff(diff: string): { filtered: string; removedFiles: string[] } {
  if (!diff) return { filtered: "", removedFiles: [] };

  const sections = diff.split(/(?=^diff --git )/m);
  const kept: string[] = [];
  const removed: string[] = [];

  for (const section of sections) {
    if (!section) continue;

    // Extract the first line (the diff header)
    const newlineIdx = section.indexOf("\n");
    const header = newlineIdx >= 0 ? section.slice(0, newlineIdx) : section;

    // Parse basename from "diff --git a/<path> b/<path>"
    const pathMatch = header.match(/^diff --git a\/.* b\/(.+?)(?:\s|$)/);
    const basename = pathMatch
      ? (() => {
          const p = pathMatch[1];
          const lastSlash = p.lastIndexOf("/");
          return lastSlash >= 0 ? p.slice(lastSlash + 1) : p;
        })()
      : null;

    if (basename && LOCK_PATTERNS.some((re) => re.test(basename))) {
      removed.push(basename);
    } else {
      kept.push(section);
    }
  }

  return { filtered: kept.join(""), removedFiles: removed };
}
