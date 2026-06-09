## 1. Types & Parsing Foundation

- [x] 1.1 Add `Severity` type (`blocking` | `warning` | `suggestion`) and `ParsedReview` interface to `types.ts` with `decision`, `blocking`, `warning`, `suggestion` arrays and `rawText` fallback field
- [x] 1.2 Create `multi-review/src/severity-parser.ts` with `parseSeverity(text: string): ParsedReview` — regex-based parser matching `### 🔴` / `### 🟡` / `### 🟢` headings (bilingual: `阻塞项`/`Blocking Issues`, `警告项`/`Warnings`, `建议项`/`Suggestions`) and extracting list items under each heading
- [x] 1.3 Implement decision line extraction: match first non-empty line against `可合并`/`CAN MERGE`/`有条件合并`/`CONDITIONAL MERGE`/`不可合并`/`CANNOT MERGE`
- [x] 1.4 Implement fallback: when no severity heading is found, return empty arrays + raw text preserved

## 2. Severity Rendering

- [x] 2.1 Create `multi-review/src/severity-renderer.ts` with `renderSeverityComment(parsed: ParsedReview, reviewerDetails: string): string`
- [x] 2.2 Render decision line with emoji (`✅` / `⚠️` / `🚫`) when `decision` is non-null
- [x] 2.3 Render severity sections in order (blocking → warning → suggestion), each with `### 🔴/🟡/🟢` heading + item count + list items; omit sections with zero items
- [x] 2.4 When all severity arrays are empty (fallback mode), render `rawText` as-is (identical to current behavior)
- [x] 2.5 Append reviewer details `<details>` section after severity sections

## 3. Prompt Updates

- [x] 3.1 Update `DEFAULT_COORDINATOR_PROMPT` in `orchestrator.ts` to require three-level output format with emoji headings (`### 🔴 阻塞项 / Blocking Issues`, `### 🟡 警告项 / Warnings`, `### 🟢 建议项 / Suggestions`), keeping backward-compatible when custom `coordinator-prompt` is provided
- [x] 3.2 Update `multi-review/reviewers/quality.yaml` — add "警告" severity level to output format instructions
- [x] 3.3 Update `multi-review/reviewers/security.yaml` — add "警告" severity level
- [x] 3.4 Update `multi-review/reviewers/performance.yaml` — add "警告" severity level
- [x] 3.5 Update `multi-review/reviewers/architecture.yaml` — add "警告" severity level
- [x] 3.6 Update `multi-review/reviewers/regression-test.yaml` — add "警告" severity level
- [x] 3.7 Update `multi-review/reviewers/test-value.yaml` — add "警告" severity level
- [x] 3.8 Update `multi-review/reviewers/spec-coverage.yaml` — add "警告" severity level

## 4. CI Severity Gate

- [x] 4.1 Add `fail-on-severity` input to `multi-review/action.yml` with allowed values `none` (default) / `blocking` / `warning`
- [x] 4.2 Wire `MULTI_REVIEW_FAIL_ON_SEVERITY` env var in action.yml run step
- [x] 4.3 In `index.ts` main flow: after coordinator output, parse severity, render comment, post it, then evaluate severity gate — exit 1 if threshold met (comment already posted)
- [x] 4.4 Skip severity gate when parser returned fallback (all arrays empty)

## 5. Tests

- [x] 5.1 Add unit tests for `severity-parser.ts`: standard three-level format, bilingual headings, two-level (no warning), empty sections, no headings (fallback), decision line extraction
- [x] 5.2 Add unit tests for `severity-renderer.ts`: all three levels, partial levels, fallback mode, decision line rendering, reviewer details preservation
- [x] 5.3 Add unit test for severity gate logic (`shouldFailOnSeverity`): `none` always returns false, `blocking` triggers on blocking items, `warning` triggers on warning+blocking, fallback bypasses gate

## 6. Build & Verify

- [x] 6.1 Run `npm run build` in `multi-review/` and fix any type errors
- [x] 6.2 Run `npm test` in `multi-review/` and ensure all tests pass
