export interface Reviewer {
  name: string;
  prompt: string;
}

export interface Message {
  info: { role: string };
  parts: Array<{ type: string; text?: string }>;
}

export interface ReviewSession {
  name: string;
  messages: Message[];
}

export interface ReviewContext {
  version: 1;
  repo: string;
  prNumber: string;
  savedAt: string;
  sessions: ReviewSession[];
}

/**
 * v2 cache entry: a serialized opencode session captured by
 * `opencode export <sessionID>`. Holds the JSON bundle (session row +
 * messages + parts) so a fresh runner can `opencode import` it and call
 * `client.session.prompt(existingSessionID, newDiff)` for true session
 * continuation — not text-blob re-feeding.
 *
 * `name` ties the bundle back to a multi-review persona so the same
 * reviewer always resumes its own session across PR re-reviews.
 *
 * `bundle` is `Record<string, unknown>` rather than `unknown` so callers
 * can safely index into the export shape (`bundle.info.id`, etc.). The
 * exact fields are owned by the opencode CLI; we don't want to bake
 * them into a TS interface (it would drift across versions).
 */
export interface SessionBundle {
  name: string;
  sessionID: string;
  /** Parsed JSON from `opencode export`. Always an object on the wire. */
  bundle: Record<string, unknown>;
  /** ISO timestamp when the bundle was captured. */
  savedAt: string;
}

export interface ReviewContextV2 {
  version: 2;
  repo: string;
  prNumber: string;
  savedAt: string;
  bundles: SessionBundle[];
}

export interface ReviewResult {
  reviewer: string;
  content: string;
  success: boolean;
  error?: string;
  cost?: number;
  tokens?: {
    input: number;
    output: number;
    reasoning: number;
    cache: { read: number; write: number };
  };
  /** Full conversation history for session-level context reuse. */
  messages?: Message[];
  /** opencode sessionID used for this review. Set on both success and failure paths. */
  sessionID?: string;
}

export interface CoordinatorResult {
  content: string;
  cost?: number;
  tokens?: {
    input: number;
    output: number;
    reasoning: number;
    cache: { read: number; write: number };
  };
  /** Full conversation history for session-level context reuse. */
  messages?: Message[];
  /** opencode sessionID used for this synthesis. */
  sessionID?: string;
}

export interface OrchestratorOptions {
  globalTimeoutMs: number;
  coordinatorTimeoutMs: number;
  coordinatorPrompt: string;
  /** Pre-formatted previous review context text for the same PR, if any. */
  previousContextText?: string;
  /**
   * Per-reviewer existing sessionID (from v2 cache). When set for a
   * reviewer, the orchestrator issues `client.session.prompt` on that
   * session instead of creating a new one — true session continuation
   * across runners.
   *
   * Map keys are reviewer.name (e.g. "quality", "coordinator").
   * Reviewers missing from the map fall back to the create+prompt path.
   */
  existingSessions?: Map<string, string>;
  /**
   * When true, the orchestrator keeps the opencode session alive after the
   * run so the caller can introspect / export it. The default (`false`)
   * deletes the session in the `finally` block — but for the v2 cache
   * path the caller needs the session row preserved until after
   * `opencode export` runs, so it sets this to `true` and is responsible
   * for any follow-up cleanup.
   */
  skipSessionCleanup?: boolean;
}

// ── Severity parsing ─────────────────────────────────────────────────

export type Severity = "blocking" | "warning" | "suggestion";

export interface ParsedReview {
  /** Parsed decision line (e.g. "CAN MERGE") or null if not detected. */
  decision: string | null;
  /** Summary paragraph between decision line and first severity heading. */
  summary: string;
  /** Issues grouped by severity. Empty arrays when parsing fails (fallback). */
  blocking: string[];
  warning: string[];
  suggestion: string[];
  /** When true, parsing found no severity headings → render raw text as-is. */
  fallback: boolean;
  /** Original raw text from coordinator output. */
  rawText: string;
}
