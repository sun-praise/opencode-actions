## ADDED Requirements

### Requirement: Render severity-grouped PR comment

The system MUST render the final PR comment with severity groups visually distinguished using emoji and markdown formatting.

#### Scenario: All three severity levels present
- **WHEN** parsed result has items in `blocking`, `warning`, and `suggestion`
- **THEN** the comment renders three sections in order:
  1. `### 🔴 阻塞项 / Blocking Issues` with item count, listing each item
  2. `### 🟡 警告项 / Warnings` with item count, listing each item
  3. `### 🟢 建议项 / Suggestions` with item count, listing each item
- **AND** each section shows the count in parentheses after the heading

#### Scenario: A severity level has no items
- **WHEN** parsed result has `warning: []` but has blocking and suggestion items
- **THEN** the warning section is omitted entirely from the comment (not shown as "无 / None")

#### Scenario: All levels empty (fallback)
- **WHEN** parsing returned empty arrays for all levels (fallback mode)
- **THEN** the raw coordinator text is rendered as-is, identical to current behavior

### Requirement: Include decision summary

#### Scenario: Decision was parsed
- **WHEN** `decision` field is non-null
- **THEN** the comment starts with a decision line using the appropriate emoji:
  - `CAN MERGE` → `✅ 可合并 / CAN MERGE`
  - `CONDITIONAL MERGE` → `⚠️ 有条件合并 / CONDITIONAL MERGE`
  - `CANNOT MERGE` → `🚫 不可合并 / CANNOT MERGE`

#### Scenario: Decision was not parsed
- **WHEN** `decision` is null
- **THEN** no decision line is rendered

### Requirement: Preserve reviewer details section

#### Scenario: Comment with reviewer details
- **WHEN** the final comment is assembled
- **THEN** reviewer details (`<details>` blocks) are appended after the severity sections, same as current behavior
