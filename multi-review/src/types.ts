export interface Reviewer {
  name: string;
  prompt: string;
}

export interface ReviewResult {
  reviewer: string;
  content: string;
  success: boolean;
  error?: string;
}

export interface OrchestratorOptions {
  globalTimeoutMs: number;
  coordinatorTimeoutMs: number;
  coordinatorPrompt: string;
}
