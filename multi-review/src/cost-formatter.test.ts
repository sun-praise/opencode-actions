import { describe, it, expect } from "vitest";
import { formatCostTable } from "./cost-formatter.js";
import type { ReviewResult, CoordinatorResult } from "./types.js";

function makeReview(overrides: Partial<ReviewResult> = {}): ReviewResult {
  return { reviewer: "test", content: "", success: true, ...overrides };
}

function makeCoordinator(overrides: Partial<CoordinatorResult> = {}): CoordinatorResult {
  return { content: "", ...overrides };
}

describe("formatCostTable", () => {
  const fullTokens = {
    input: 5000,
    output: 2000,
    reasoning: 1000,
    cache: { read: 3000, write: 800 },
  };

  it("includes all reviewer rows, coordinator row, and total with correct formatting", () => {
    
    const reviews: ReviewResult[] = [
      makeReview({
        reviewer: "security",
        cost: 1.2345,
        tokens: { input: 10000, output: 5000, reasoning: 2000, cache: { read: 8000, write: 1500 } },
      }),
      makeReview({
        reviewer: "quality",
        cost: 0.5678,
        tokens: { input: 6000, output: 3000, reasoning: 1500, cache: { read: 4000, write: 900 } },
      }),
    ];
    const coordinator = makeCoordinator({
      cost: 0.0023,
      tokens: { input: 12000, output: 8000, reasoning: 500, cache: { read: 1000, write: 200 } },
    });

    const result = formatCostTable(reviews, coordinator);

    // Contains all three data rows plus total
    expect(result).toContain("security");
    expect(result).toContain("quality");
    expect(result).toContain("coordinator");

    // Cost formatting: $X.XXXX
    expect(result).toContain("$1.2345");
    expect(result).toContain("$0.5678");
    expect(result).toContain("$0.0023");

    // Thousands separators
    expect(result).toContain("10,000");
    expect(result).toContain("12,000");

    // Total row
    expect(result).toContain("**Total**");
    // Total cost = 1.2345 + 0.5678 + 0.0023 = 1.8046
    expect(result).toContain("$1.8046");
  });

  it("only includes successful reviews with cost data", () => {
    const reviews: ReviewResult[] = [
      makeReview({ reviewer: "ok", cost: 0.5, tokens: fullTokens }),
      makeReview({ reviewer: "failed", success: false, cost: 0.3, tokens: fullTokens }),
      makeReview({ reviewer: "no-cost", cost: undefined }),
    ];

    const result = formatCostTable(reviews);

    expect(result).toContain("ok");
    expect(result).not.toContain("failed");
    expect(result).not.toContain("no-cost");
  });

  it("omits coordinator row when coordinator is undefined", () => {
    
    const reviews: ReviewResult[] = [
      makeReview({ reviewer: "r1", cost: 1.0, tokens: fullTokens }),
      makeReview({ reviewer: "r2", cost: 2.0, tokens: fullTokens }),
    ];

    const result = formatCostTable(reviews, undefined);

    expect(result).not.toContain("coordinator");
    expect(result).toContain("r1");
    expect(result).toContain("r2");

    // Total sums reviewers only: $3.0000
    expect(result).toContain("$3.0000");
  });

  it("returns empty string when no cost data exists", () => {
    const reviews: ReviewResult[] = [
      makeReview({ cost: undefined }),
      makeReview({ success: false, cost: 0.1 }),
    ];

    expect(formatCostTable(reviews)).toBe("");
    expect(formatCostTable([], undefined)).toBe("");
    expect(formatCostTable([], makeCoordinator({ cost: undefined }))).toBe("");
  });

  it("formats cost with 4 decimal places and tokens with thousands separators", () => {
    
    const reviews: ReviewResult[] = [
      makeReview({ reviewer: "fmt", cost: 0.1, tokens: { input: 1000, output: 500, reasoning: 0, cache: { read: 0, write: 0 } } }),
    ];

    const result = formatCostTable(reviews);

    // $0.1000 format (4 decimals)
    expect(result).toContain("$0.1000");
    // 1,000 format
    expect(result).toContain("1,000");
  });

  it("wraps output in details and summary HTML tags", () => {
    const reviews: ReviewResult[] = [
      makeReview({ reviewer: "r", cost: 0.01, tokens: fullTokens }),
    ];

    const result = formatCostTable(reviews);

    expect(result).toContain("<details>");
    expect(result).toContain("</details>");
    expect(result).toContain("<summary>");
    expect(result).toContain("</summary>");
    // Uses markdown table syntax with | delimiters
    expect(result).toContain("| Role |");
    expect(result).toContain("| --- |");
  });

  it("total row sums correctly across multiple reviewers", () => {
    
    const reviews: ReviewResult[] = [
      makeReview({
        reviewer: "a",
        cost: 0.1,
        tokens: { input: 1000, output: 500, reasoning: 200, cache: { read: 300, write: 100 } },
      }),
      makeReview({
        reviewer: "b",
        cost: 0.2,
        tokens: { input: 2000, output: 1500, reasoning: 800, cache: { read: 700, write: 400 } },
      }),
      makeReview({
        reviewer: "c",
        cost: 0.3,
        tokens: { input: 3000, output: 1000, reasoning: 500, cache: { read: 200, write: 50 } },
      }),
    ];
    const coordinator = makeCoordinator({
      cost: 0.4,
      tokens: { input: 5000, output: 2000, reasoning: 1000, cache: { read: 1000, write: 500 } },
    });

    const result = formatCostTable(reviews, coordinator);

    // Total cost: 0.1 + 0.2 + 0.3 + 0.4 = 1.0 → $1.0000
    expect(result).toContain("$1.0000");

    // Extract the total row and verify token sums
    // Input total: 1000+2000+3000+5000 = 11000
    expect(result).toContain("11,000");
    // Output total: 500+1500+1000+2000 = 5000
    // Reasoning total: 200+800+500+1000 = 2500
    expect(result).toContain("2,500");
    // Cache read total: 300+700+200+1000 = 2200
    // Cache write total: 100+400+50+500 = 1050
    expect(result).toContain("1,050");
  });


  it("handles cost=0 correctly (zero not filtered out)", () => {
    
    const reviews: ReviewResult[] = [
      makeReview({ reviewer: "free-tier", cost: 0, tokens: { input: 100, output: 50, reasoning: 0, cache: { read: 0, write: 0 } } }),
    ];

    const result = formatCostTable(reviews);

    expect(result).toContain("free-tier");
    expect(result).toContain("$0.0000");
    expect(result).toContain("**Total**");
  });

  it("handles missing tokens (tokens undefined)", () => {
    
    const reviews: ReviewResult[] = [
      makeReview({ reviewer: "no-tokens", cost: 0.5, tokens: undefined }),
    ];

    const result = formatCostTable(reviews);

    expect(result).toContain("no-tokens");
    expect(result).toContain("$0.5000");
    // Token columns should show 0
    expect(result).toContain("| 0 |");
  });

  it("handles coordinator-only cost (no reviewer cost)", () => {
    
    const reviews: ReviewResult[] = [
      makeReview({ reviewer: "failed", cost: undefined, success: false }),
    ];
    const coordinator = makeCoordinator({
      cost: 0.003,
      tokens: { input: 5000, output: 2000, reasoning: 1000, cache: { read: 3000, write: 800 } },
    });

    const result = formatCostTable(reviews, coordinator);

    expect(result).toContain("coordinator");
    expect(result).toContain("$0.0030");
    expect(result).not.toContain("failed");
    expect(result).toContain("**Total**");
  });
});
