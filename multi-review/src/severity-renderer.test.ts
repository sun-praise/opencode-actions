import { describe, it, expect } from "vitest";
import { renderSeverityComment } from "./severity-renderer.js";
import type { ParsedReview } from "./types.js";

function makeParsed(overrides: Partial<ParsedReview> = {}): ParsedReview {
  return {
    decision: null,
    summary: "",
    blocking: [],
    warning: [],
    suggestion: [],
    fallback: false,
    rawText: "",
    ...overrides,
  };
}

describe("renderSeverityComment", () => {
  it("renders all three severity levels", () => {
    const parsed = makeParsed({
      blocking: ["block-1"],
      warning: ["warn-1"],
      suggestion: ["suggest-1"],
    });
    const out = renderSeverityComment(parsed, "reviewer-details");

    expect(out).toContain("### 🔴");
    expect(out).toContain("(1)");
    expect(out).toContain("### 🟡");
    expect(out).toContain("### 🟢");
  });

  it("renders only blocking when other arrays are empty", () => {
    const parsed = makeParsed({ blocking: ["block-1"] });
    const out = renderSeverityComment(parsed, "reviewer-details");

    expect(out).toContain("### 🔴");
    expect(out).not.toContain("### 🟡");
    expect(out).not.toContain("### 🟢");
  });

  it("returns raw text + reviewer details in fallback mode", () => {
    const parsed = makeParsed({
      fallback: true,
      rawText: "hello world",
    });
    const out = renderSeverityComment(parsed, "<details>test</details>");

    expect(out).toBe("hello world\n<details>test</details>");
  });

  describe("decision line rendering", () => {
    it("renders CAN MERGE with ✅", () => {
      const out = renderSeverityComment(
        makeParsed({ decision: "CAN MERGE" }),
        "details",
      );
      expect(out).toContain("✅");
    });

    it("renders CONDITIONAL MERGE with ⚠️", () => {
      const out = renderSeverityComment(
        makeParsed({ decision: "CONDITIONAL MERGE" }),
        "details",
      );
      expect(out).toContain("⚠️");
    });

    it("renders CANNOT MERGE with 🚫", () => {
      const out = renderSeverityComment(
        makeParsed({ decision: "CANNOT MERGE" }),
        "details",
      );
      expect(out).toContain("🚫");
    });

    it("omits decision line when decision is null", () => {
      const out = renderSeverityComment(makeParsed({ decision: null }), "details");
      expect(out).not.toContain("✅");
      expect(out).not.toContain("⚠️");
      expect(out).not.toContain("🚫");
    });
  });

  it("preserves reviewer details at the end of output", () => {
    const details = "<details>test</details>";
    const out = renderSeverityComment(makeParsed(), details);
    expect(out.endsWith(details)).toBe(true);
  });

  it("shows 'No issues found' when all arrays are empty and fallback is false", () => {
    const out = renderSeverityComment(makeParsed(), "details");
    expect(out).toContain("No issues found");
  });

  it("renders summary paragraph after decision line", () => {
    const parsed = makeParsed({
      decision: "CONDITIONAL MERGE",
      summary: "本 PR 修复了 SQL 注入但缺少回归测试。",
      blocking: ["SQL injection"],
    });
    const out = renderSeverityComment(parsed, "details");
    expect(out).toContain("⚠️");
    expect(out).toContain("本 PR 修复了 SQL 注入但缺少回归测试。");
    expect(out).toContain("### 🔴");
  });

  it("does not inject extra content when summary is empty", () => {
    const out = renderSeverityComment(makeParsed({ summary: "" }), "details");
    // Should not contain any stray text between sections
    expect(out).toContain("No issues found");
    // Count blank-line runs: empty summary should not add extra blank lines
    const blankRuns = out.match(/\n{3,}/g);
    expect(blankRuns).toBeNull();
  });
});
