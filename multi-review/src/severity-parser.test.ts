import { describe, it, expect } from "vitest";
import { parseSeverity, shouldFailOnSeverity } from "./severity-parser.js";
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

    expect(result.fallback).toBe(false);
    expect(result.decision).toBe("CAN MERGE");
    expect(result.blocking).toEqual(["内存泄漏风险", "未处理的异常"]);
    expect(result.warning).toEqual(["命名不规范"]);
    expect(result.suggestion).toEqual(["可提取公共方法"]);
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

    expect(result.fallback).toBe(false);
    expect(result.decision).toBe("CONDITIONAL MERGE");
    expect(result.blocking).toEqual(["SQL injection vulnerability", "Missing auth check"]);
    expect(result.warning).toEqual(["N+1 query in user service"]);
    expect(result.suggestion).toEqual(["Add caching layer"]);
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

    expect(result.fallback).toBe(false);
    expect(result.decision).toBe("CONDITIONAL MERGE");
    expect(result.blocking).toEqual(["SQL injection vulnerability"]);
    expect(result.warning).toEqual(["Missing unit tests", "Slow query on /api/list"]);
    expect(result.suggestion).toEqual(["Add caching layer"]);
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

    expect(result.fallback).toBe(false);
    expect(result.decision).toBe("CANNOT MERGE");
    expect(result.blocking).toEqual(["硬编码密钥"]);
    expect(result.warning).toEqual(["缺少日志"]);
    expect(result.suggestion).toEqual(["重构入口文件"]);
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

    expect(result.fallback).toBe(false);
    expect(result.warning).toEqual([]);
    expect(result.blocking).toEqual(["类型错误"]);
    expect(result.suggestion).toEqual(["添加注释"]);
  });

  // 5. Fallback (no severity headings at all)
  it("sets fallback=true and returns empty arrays when no severity headings found", () => {
    const text = `This is just a random review
with no structured headings at all.
- item one
- item two
`;
    const result = parseSeverity(text);

    expect(result.fallback).toBe(true);
    expect(result.decision).toBeNull();
    expect(result.blocking).toEqual([]);
    expect(result.warning).toEqual([]);
    expect(result.suggestion).toEqual([]);
    expect(result.rawText).toBe(text);
  });

  // 6. Decision line extraction
  describe("decision extraction", () => {
    it.each([
      { firstLine: "CAN MERGE", expected: "CAN MERGE" },
      { firstLine: "CONDITIONAL MERGE", expected: "CONDITIONAL MERGE" },
      { firstLine: "CANNOT MERGE", expected: "CANNOT MERGE" },
      { firstLine: "可合并", expected: "CAN MERGE" },
      { firstLine: "有条件合并", expected: "CONDITIONAL MERGE" },
      { firstLine: "不可合并", expected: "CANNOT MERGE" },
    ] as const)('extracts "$expected" from "$firstLine"', ({ firstLine, expected }) => {
      const text = `${firstLine}
### 🔴 阻塞项
- issue
`;
      const result = parseSeverity(text);
      expect(result.decision).toBe(expected);
    });

    it("returns null when first non-empty line is not a decision keyword", () => {
      const text = `Overall the code looks good.
### 🔴 阻塞项
- issue
`;
      const result = parseSeverity(text);
      expect(result.decision).toBeNull();
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

    expect(result.blocking).toEqual([]);
    expect(result.warning).toEqual([]);
    expect(result.suggestion).toEqual([]);
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

    expect(result.fallback).toBe(false);
    expect(result.decision).toBe("CANNOT MERGE");
    expect(result.blocking).toEqual(["安全漏洞", "数据泄露"]);
    expect(result.warning).toEqual([]);
    expect(result.suggestion).toEqual(["增加监控"]);
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
    expect(result.summary).toContain("SQL 注入漏洞");
    expect(result.summary).toContain("回归测试");
  });

  it("returns empty summary when there is no text between decision and headings", () => {
    const text = `CAN MERGE
### 🟢 建议项 / Suggestions (1)
- Minor improvement
`;
    const result = parseSeverity(text);
    expect(result.summary).toBe("");
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
  it("returns false when parsed is undefined", () => {
    expect(shouldFailOnSeverity(undefined, "blocking")).toBe(false);
  });

  it("returns false when fallback is true", () => {
    const parsed = makeParsed({ fallback: true, blocking: ["SQL injection"] });
    expect(shouldFailOnSeverity(parsed, "blocking")).toBe(false);
  });

  it("returns false when failOnSeverity is 'none'", () => {
    const parsed = makeParsed({ blocking: ["critical bug"] });
    expect(shouldFailOnSeverity(parsed, "none")).toBe(false);
  });

  it("returns true for 'blocking' when blocking issues exist", () => {
    const parsed = makeParsed({ blocking: ["critical bug"] });
    expect(shouldFailOnSeverity(parsed, "blocking")).toBe(true);
  });

  it("returns false for 'blocking' when only warnings exist", () => {
    const parsed = makeParsed({ warning: ["perf concern"] });
    expect(shouldFailOnSeverity(parsed, "blocking")).toBe(false);
  });

  it("returns true for 'warning' when warning issues exist", () => {
    const parsed = makeParsed({ warning: ["perf concern"] });
    expect(shouldFailOnSeverity(parsed, "warning")).toBe(true);
  });

  it("returns true for 'warning' when blocking issues exist", () => {
    const parsed = makeParsed({ blocking: ["critical bug"] });
    expect(shouldFailOnSeverity(parsed, "warning")).toBe(true);
  });

  it("returns false for 'warning' when only suggestions exist", () => {
    const parsed = makeParsed({ suggestion: ["rename variable"] });
    expect(shouldFailOnSeverity(parsed, "warning")).toBe(false);
  });
});
