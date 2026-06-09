export interface Reviewer {
  name: string;
  prompt: string;
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
}

export interface OrchestratorOptions {
  globalTimeoutMs: number;
  coordinatorTimeoutMs: number;
  coordinatorPrompt: string;
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
