## ADDED Requirements

### Requirement: Parse coordinator output into structured severity groups

The system MUST parse the coordinator's markdown output into a structured object containing three severity groups: `blocking`, `warning`, and `suggestion`.

#### Scenario: Coordinator outputs standard three-level format
- **WHEN** coordinator output contains `### 🔴 阻塞项` or `### 🔴 Blocking Issues` heading followed by list items
- **THEN** those items are extracted into the `blocking` array

#### Scenario: Coordinator outputs warning items
- **WHEN** coordinator output contains `### 🟡 警告项` or `### 🟡 Warnings` heading followed by list items
- **THEN** those items are extracted into the `warning` array

#### Scenario: Coordinator outputs suggestion items
- **WHEN** coordinator output contains `### 🟢 建议项` or `### 🟢 Suggestions` heading followed by list items
- **THEN** those items are extracted into the `suggestion` array

### Requirement: Fallback to raw text on parse failure

#### Scenario: Coordinator output does not match expected format
- **WHEN** the parser cannot find any severity heading (`### 🔴` / `### 🟡` / `### 🟢`) in the coordinator output
- **THEN** the parser returns a fallback result with `blocking: []`, `warning: []`, `suggestion: []` and the raw text preserved for rendering as-is

#### Scenario: Coordinator outputs only two levels (blocking + suggestion, no warning)
- **WHEN** coordinator output contains blocking and suggestion headings but no warning heading
- **THEN** `warning` array is empty; other arrays are populated normally

### Requirement: Support bilingual headings

#### Scenario: Chinese headings
- **WHEN** headings use Chinese text (`阻塞项`, `警告项`, `建议项`)
- **THEN** items are correctly categorized regardless of whether the heading is Chinese or English

#### Scenario: English headings
- **WHEN** headings use English text (`Blocking Issues`, `Warnings`, `Suggestions`)
- **THEN** items are correctly categorized

### Requirement: Parse decision line

#### Scenario: Coordinator outputs decision line
- **WHEN** the first non-empty line of coordinator output matches `可合并` / `CAN MERGE` / `有条件合并` / `CONDITIONAL MERGE` / `不可合并` / `CANNOT MERGE`
- **THEN** the parser extracts it as `decision` field

#### Scenario: Decision line absent
- **WHEN** no recognizable decision line is found
- **THEN** `decision` defaults to `null`
