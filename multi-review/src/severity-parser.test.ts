import { describe, it } from "node:test";
import assert from "node:assert";
import { parseSeverity, shouldFailOnSeverity, synthesizeCoordinatorFailureSeverity, applyFailedReviewerOverride } from "./severity-parser.js";
import type { ParsedReview } from "./types.js";

describe("parseSeverity", () => {
  // 1. Standard three-level format (Chinese headings with emoji)
  it("parses Chinese headings with emoji", () => {
    const text = `CAN MERGE
### 🔴 阻塞项
- 内存泄漏风险
- 未处理的异常
### 🟡 警告项
- 命名不规范
### 🟢 建议项
- 可提取公共方法
`;
    const result = parseSeverity(text);

    assert.strictEqual(result.fallback, false);
    assert.strictEqual(result.decision, "CAN MERGE");
    assert.deepStrictEqual(result.blocking, ["内存泄漏风险", "未处理的异常"]);
    assert.deepStrictEqual(result.warning, ["命名不规范"]);
    assert.deepStrictEqual(result.suggestion, ["可提取公共方法"]);
  });

  // 1b. Bilingual heading format (what coordinator actually outputs)
  it("parses bilingual heading format (emoji + Chinese / English)", () => {
    const text = `有条件合并

### 🔴 阻塞项 / Blocking Issues (2)
- SQL injection vulnerability
- Missing auth check

### 🟡 警告项 / Warnings (1)
- N+1 query in user service

### 🟢 建议项 / Suggestions (1)
- Add caching layer
`;
    const result = parseSeverity(text);

    assert.strictEqual(result.fallback, false);
    assert.strictEqual(result.decision, "CONDITIONAL MERGE");
    assert.deepStrictEqual(result.blocking, ["SQL injection vulnerability", "Missing auth check"]);
    assert.deepStrictEqual(result.warning, ["N+1 query in user service"]);
    assert.deepStrictEqual(result.suggestion, ["Add caching layer"]);
  });

  // 2. English headings with emoji
  it("parses English headings with emoji", () => {
    const text = `CONDITIONAL MERGE
### 🔴 Blocking Issues
- SQL injection vulnerability
### 🟡 Warnings
- Missing unit tests
- Slow query on /api/list
### 🟢 Suggestions
- Add caching layer
`;
    const result = parseSeverity(text);

    assert.strictEqual(result.fallback, false);
    assert.strictEqual(result.decision, "CONDITIONAL MERGE");
    assert.deepStrictEqual(result.blocking, ["SQL injection vulnerability"]);
    assert.deepStrictEqual(result.warning, ["Missing unit tests", "Slow query on /api/list"]);
    assert.deepStrictEqual(result.suggestion, ["Add caching layer"]);
  });

  // 3. Headings without emoji (backward compat)
  it("parses Chinese headings without emoji (backward compat)", () => {
    const text = `CANNOT MERGE
### 阻塞项
- 硬编码密钥
### 警告项
- 缺少日志
### 建议项
- 重构入口文件
`;
    const result = parseSeverity(text);

    assert.strictEqual(result.fallback, false);
    assert.strictEqual(result.decision, "CANNOT MERGE");
    assert.deepStrictEqual(result.blocking, ["硬编码密钥"]);
    assert.deepStrictEqual(result.warning, ["缺少日志"]);
    assert.deepStrictEqual(result.suggestion, ["重构入口文件"]);
  });

  // 4. Two-level only (no warning section)
  it("returns empty warning array when warning section is absent", () => {
    const text = `CAN MERGE
### 🔴 阻塞项
- 类型错误
### 🟢 建议项
- 添加注释
`;
    const result = parseSeverity(text);

    assert.strictEqual(result.fallback, false);
    assert.deepStrictEqual(result.warning, []);
    assert.deepStrictEqual(result.blocking, ["类型错误"]);
    assert.deepStrictEqual(result.suggestion, ["添加注释"]);
  });

  // 5. Fallback (no severity headings at all)
  it("sets fallback=true and returns empty arrays when no severity headings found", () => {
    const text = `This is just a random review
with no structured headings at all.
- item one
- item two
`;
    const result = parseSeverity(text);

    assert.strictEqual(result.fallback, true);
    assert.strictEqual(result.decision, null);
    assert.deepStrictEqual(result.blocking, []);
    assert.deepStrictEqual(result.warning, []);
    assert.deepStrictEqual(result.suggestion, []);
    assert.strictEqual(result.rawText, text);
  });

  // 6. Decision line extraction
  describe("decision extraction", () => {
    const cases: Array<{ firstLine: string; expected: string }> = [
      { firstLine: "CAN MERGE", expected: "CAN MERGE" },
      { firstLine: "CONDITIONAL MERGE", expected: "CONDITIONAL MERGE" },
      { firstLine: "CANNOT MERGE", expected: "CANNOT MERGE" },
      { firstLine: "可合并", expected: "CAN MERGE" },
      { firstLine: "有条件合并", expected: "CONDITIONAL MERGE" },
      { firstLine: "不可合并", expected: "CANNOT MERGE" },
    ];
    for (const { firstLine, expected } of cases) {
      it(`extracts "${expected}" from "${firstLine}"`, () => {
        const text = `${firstLine}
### 🔴 阻塞项
- issue
`;
        const result = parseSeverity(text);
        assert.strictEqual(result.decision, expected);
      });
    }

    it("returns null when first non-empty line is not a decision keyword", () => {
      const text = `Overall the code looks good.
### 🔴 阻塞项
- issue
`;
      const result = parseSeverity(text);
      assert.strictEqual(result.decision, null);
    });
  });

  // 7. 无/None items filtered
  it("filters out 无 and None items from sections", () => {
    const text = `CAN MERGE
### 🔴 阻塞项
- 无
### 🟡 警告项
- None
### 🟢 建议项
- None
`;
    const result = parseSeverity(text);

    assert.deepStrictEqual(result.blocking, []);
    assert.deepStrictEqual(result.warning, []);
    assert.deepStrictEqual(result.suggestion, []);
  });

  // 8. Empty section with 无 while other sections have items
  it("produces empty array for section with 无 while keeping items in other sections", () => {
    const text = `CANNOT MERGE
### 🔴 阻塞项
- 安全漏洞
- 数据泄露
### 🟡 警告项
- 无
### 🟢 建议项
- 增加监控
`;
    const result = parseSeverity(text);

    assert.strictEqual(result.fallback, false);
    assert.strictEqual(result.decision, "CANNOT MERGE");
    assert.deepStrictEqual(result.blocking, ["安全漏洞", "数据泄露"]);
    assert.deepStrictEqual(result.warning, []);
    assert.deepStrictEqual(result.suggestion, ["增加监控"]);
  });

  // 9. Summary extraction
  it("extracts summary text between decision and first heading", () => {
    const text = `CONDITIONAL MERGE

本 PR 修复了认证模块的 SQL 注入漏洞，但缺少回归测试。建议补充后再合并。

### 🔴 阻塞项 / Blocking Issues (1)
- SQL injection in auth.ts:L42

### 🟢 建议项 / Suggestions (1)
- Add regression test
`;
    const result = parseSeverity(text);
    assert.ok(result.summary.includes("SQL 注入漏洞"));
    assert.ok(result.summary.includes("回归测试"));
  });

  it("returns empty summary when there is no text between decision and headings", () => {
    const text = `CAN MERGE
### 🟢 建议项 / Suggestions (1)
- Minor improvement
`;
    const result = parseSeverity(text);
    assert.strictEqual(result.summary, "");
  });
  it("treats empty string input as fallback with no decision (#280 boundary)", () => {
    const result = parseSeverity("");
    assert.strictEqual(result.fallback, true);
    assert.strictEqual(result.decision, null);
    assert.deepStrictEqual(result.blocking, []);
    assert.strictEqual(result.rawText, "");
  });
});

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

describe("shouldFailOnSeverity", () => {
  it("returns true when parsed is undefined and gate is armed (fail-closed, #280)", () => {
    assert.strictEqual(shouldFailOnSeverity(undefined, "blocking"), true);
    assert.strictEqual(shouldFailOnSeverity(undefined, "warning"), true);
  });

  it("returns false when parsed is undefined and failOnSeverity is 'none'", () => {
    assert.strictEqual(shouldFailOnSeverity(undefined, "none"), false);
  });

  it("returns true when fallback is true and gate is armed (fail-closed, #280)", () => {
    const parsed = makeParsed({ fallback: true, blocking: ["SQL injection"] });
    assert.strictEqual(shouldFailOnSeverity(parsed, "blocking"), true);
    assert.strictEqual(shouldFailOnSeverity(parsed, "warning"), true);
  });

  it("returns false when fallback is true and failOnSeverity is 'none'", () => {
    const parsed = makeParsed({ fallback: true });
    assert.strictEqual(shouldFailOnSeverity(parsed, "none"), false);
  });

  it("returns false when failOnSeverity is 'none'", () => {
    const parsed = makeParsed({ blocking: ["critical bug"] });
    assert.strictEqual(shouldFailOnSeverity(parsed, "none"), false);
  });

  it("returns true for 'blocking' when blocking issues exist", () => {
    const parsed = makeParsed({ blocking: ["critical bug"] });
    assert.strictEqual(shouldFailOnSeverity(parsed, "blocking"), true);
  });

  it("returns false for 'blocking' when only warnings exist", () => {
    const parsed = makeParsed({ warning: ["perf concern"] });
    assert.strictEqual(shouldFailOnSeverity(parsed, "blocking"), false);
  });

  it("returns true for 'warning' when warning issues exist", () => {
    const parsed = makeParsed({ warning: ["perf concern"] });
    assert.strictEqual(shouldFailOnSeverity(parsed, "warning"), true);
  });

  it("returns true for 'warning' when blocking issues exist", () => {
    const parsed = makeParsed({ blocking: ["critical bug"] });
    assert.strictEqual(shouldFailOnSeverity(parsed, "warning"), true);
  });

  it("returns false for 'warning' when only suggestions exist", () => {
    const parsed = makeParsed({ suggestion: ["rename variable"] });
    assert.strictEqual(shouldFailOnSeverity(parsed, "warning"), false);
  });

  it("returns true for unknown failOnSeverity values when fallback/undefined (fail-closed default, #280 boundary)", () => {
    assert.strictEqual(shouldFailOnSeverity(undefined, "invalid"), true);
    const parsed = makeParsed({ fallback: true });
    assert.strictEqual(shouldFailOnSeverity(parsed, "invalid"), true);
  });

  it("returns false for unknown failOnSeverity values when parsed is well-formed (no match → fallthrough)", () => {
    const parsed = makeParsed({ blocking: ["x"], warning: ["y"] });
    assert.strictEqual(shouldFailOnSeverity(parsed, "invalid"), false);
  });
});

describe("synthesizeCoordinatorFailureSeverity (#280)", () => {
  it("produces a CANNOT MERGE verdict", () => {
    const parsed = synthesizeCoordinatorFailureSeverity(new Error("boom"));
    assert.strictEqual(parsed.decision, "CANNOT MERGE");
    assert.strictEqual(parsed.fallback, false);
  });

  it("includes the coordinator failure in summary and blocking", () => {
    const parsed = synthesizeCoordinatorFailureSeverity(new Error("network down"));
    assert.ok(parsed.summary.includes("Coordinator failed: network down"), `summary was: ${parsed.summary}`);
    assert.ok(parsed.blocking.some((b) => b.includes("Coordinator itself failed")), `blocking was: ${JSON.stringify(parsed.blocking)}`);
  });

  it("handles non-Error throwables by stringifying them", () => {
    const parsed = synthesizeCoordinatorFailureSeverity("string error");
    assert.ok(parsed.summary.includes("string error"), `summary was: ${parsed.summary}`);
  });

  it("keeps warning and suggestion empty (no spurious issues)", () => {
    const parsed = synthesizeCoordinatorFailureSeverity(new Error("x"));
    assert.deepStrictEqual(parsed.warning, []);
    assert.deepStrictEqual(parsed.suggestion, []);
  });

  it("is fail-closed under shouldFailOnSeverity when gate is armed", () => {
    const parsed = synthesizeCoordinatorFailureSeverity(new Error("x"));
    assert.strictEqual(shouldFailOnSeverity(parsed, "blocking"), true);
    assert.strictEqual(shouldFailOnSeverity(parsed, "warning"), true);
    assert.strictEqual(shouldFailOnSeverity(parsed, "none"), false);
  });
});

describe("applyFailedReviewerOverride (#280)", () => {
  it("leaves parsed unchanged when no reviewers failed", () => {
    const parsed = makeParsed({ decision: "CAN MERGE", blocking: [] });
    applyFailedReviewerOverride(parsed, []);
    assert.strictEqual(parsed.decision, "CAN MERGE");
    assert.deepStrictEqual(parsed.blocking, []);
  });

  it("forces CANNOT MERGE and lists missing reviewer under blocking", () => {
    const parsed = makeParsed({ decision: "CAN MERGE", blocking: [] });
    applyFailedReviewerOverride(parsed, ["quality"]);
    assert.strictEqual(parsed.decision, "CANNOT MERGE");
    assert.ok(parsed.blocking.some((b) => b.includes("quality")), `blocking: ${JSON.stringify(parsed.blocking)}`);
  });

  it("lists multiple missing reviewers comma-separated", () => {
    const parsed = makeParsed({ decision: "CAN MERGE", blocking: [] });
    applyFailedReviewerOverride(parsed, ["quality", "security"]);
    const note = parsed.blocking.find((b) => b.includes("Reviewer"));
    assert.ok(note, "missing reviewer note not found");
    assert.ok(note!.includes("quality"), `note: ${note}`);
    assert.ok(note!.includes("security"), `note: ${note}`);
  });

  it("overrides fallback=true to false so render uses structured mode", () => {
    const parsed = makeParsed({ decision: null, fallback: true, rawText: "garbage" });
    applyFailedReviewerOverride(parsed, ["quality"]);
    assert.strictEqual(parsed.decision, "CANNOT MERGE");
    assert.strictEqual(parsed.fallback, false);
  });

  it("is idempotent — does not duplicate the reviewer note on re-apply", () => {
    const parsed = makeParsed({ decision: "CAN MERGE", blocking: [] });
    applyFailedReviewerOverride(parsed, ["quality"]);
    const afterFirst = parsed.blocking.length;
    applyFailedReviewerOverride(parsed, ["quality"]);
    assert.strictEqual(parsed.blocking.length, afterFirst);
  });

  it("preserves existing blocking items from the coordinator", () => {
    const parsed = makeParsed({ decision: "CONDITIONAL MERGE", blocking: ["SQL injection"] });
    applyFailedReviewerOverride(parsed, ["security"]);
    assert.strictEqual(parsed.decision, "CANNOT MERGE");
    assert.ok(parsed.blocking.includes("SQL injection"));
    assert.ok(parsed.blocking.some((b) => b.includes("security")));
  });
});
