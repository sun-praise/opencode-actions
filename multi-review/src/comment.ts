import { resolvePRNumber, postPRComment as platformPostComment, cleanupErrorComments as platformCleanup } from "./platform.js";

export { resolvePRNumber } from "./platform.js";

/**
 * Post a review comment to the current PR (or fallback to stdout).
 * Delegates to the platform abstraction layer.
 */
export function postPRComment(body: string): void {
  const prNumber = resolvePRNumber();
  if (!prNumber) {
    console.log("Not in PR context, printing review to stdout:");
    console.log("---");
    console.log(body);
    return;
  }

  platformPostComment(prNumber, body);
}

/**
 * Delete error comments posted by opencode to the current PR.
 * Delegates to the platform abstraction layer.
 */
export function cleanupErrorComments(): void {
  platformCleanup();
}

/**
 * Parse MULTI_REVIEW_EXTRA_ENV into process.env.
 * Platform-agnostic, not delegated.
 */
export function parseExtraEnv(): void {
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
