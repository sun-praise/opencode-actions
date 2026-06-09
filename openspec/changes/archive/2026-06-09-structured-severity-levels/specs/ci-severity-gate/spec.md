## ADDED Requirements

### Requirement: fail-on-severity action input

The action MUST accept a `fail-on-severity` input controlling whether the action exits non-zero based on review severity.

#### Scenario: fail-on-severity is "none" (default)
- **WHEN** `fail-on-severity` is unset or set to `none`
- **THEN** the action always exits 0 (unless a runtime error occurs), regardless of review findings

#### Scenario: fail-on-severity is "blocking"
- **WHEN** `fail-on-severity` is set to `blocking`
- **AND** parsed review result has one or more items in the `blocking` array
- **THEN** the action exits 1 after posting the PR comment

#### Scenario: fail-on-severity is "warning"
- **WHEN** `fail-on-severity` is set to `warning`
- **AND** parsed review result has one or more items in `blocking` OR `warning` arrays
- **THEN** the action exits 1 after posting the PR comment

#### Scenario: fail-on-severity is "warning" but only suggestions exist
- **WHEN** `fail-on-severity` is set to `warning`
- **AND** parsed review result has items only in `suggestion` array (no blocking, no warning)
- **THEN** the action exits 0

### Requirement: Severity gate does not suppress comment

#### Scenario: Action exits 1 due to severity
- **WHEN** the severity gate triggers a non-zero exit
- **THEN** the PR comment has already been posted before the exit (comment posting is never skipped)

### Requirement: Fallback mode bypasses severity gate

#### Scenario: Parsing failed (fallback mode)
- **WHEN** the parser returned empty arrays for all levels (raw text fallback)
- **THEN** the severity gate is skipped and the action exits 0 (same as `fail-on-severity: none`)
