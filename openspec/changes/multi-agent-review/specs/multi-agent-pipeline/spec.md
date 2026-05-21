## ADDED Requirements

### Requirement: Parallel reviewer execution
The system SHALL launch multiple reviewer agents in parallel using subprocess, each running an independent `opencode github run` invocation with its own prompt. The system MUST wait for all reviewer agents to complete (or timeout) before proceeding to the coordinator phase.

#### Scenario: Three reviewers run in parallel
- **WHEN** the action is configured with 3 reviewers (quality, security, performance)
- **THEN** all 3 reviewer processes are launched simultaneously, and the system waits until all 3 complete before starting the coordinator

#### Scenario: One reviewer times out
- **WHEN** a reviewer exceeds its per-reviewer timeout while other reviewers complete successfully
- **THEN** the timed-out reviewer's output is discarded, and the coordinator proceeds with the remaining completed reviewer outputs

#### Scenario: All reviewers time out
- **WHEN** all reviewers exceed their per-reviewer timeout
- **THEN** the action SHALL fail with a non-zero exit code and post an error comment to the PR

### Requirement: Coordinator synthesis
The system SHALL run a coordinator agent after all reviewer agents complete. The coordinator MUST receive all completed reviewer outputs as prompt context and produce a unified review report. The coordinator output SHALL include a merge decision on the first line.

#### Scenario: Coordinator produces merged report
- **WHEN** 3 reviewers complete with outputs
- **THEN** the coordinator receives all 3 outputs, synthesizes a unified report with deduplicated findings, cross-validated conclusions, and a single merge decision

#### Scenario: Cross-validation of findings
- **WHEN** two or more reviewers independently report the same issue
- **THEN** the coordinator SHALL mark that finding as "多 reviewer 确认" (confirmed by multiple reviewers) in the final report

#### Scenario: Conflicting reviewer conclusions
- **WHEN** reviewers produce contradictory findings
- **THEN** the coordinator SHALL resolve the conflict with its own judgment and note the disagreement in the report

### Requirement: Global timeout budget
The system SHALL enforce a global timeout that covers all reviewers and the coordinator. The system MUST NOT exceed this timeout regardless of individual reviewer states.

#### Scenario: Global timeout reached during reviewer phase
- **WHEN** the global timeout is reached while reviewers are still running
- **THEN** all running reviewer processes are terminated, and the action proceeds with whatever reviewer outputs are available

#### Scenario: Global timeout reached before coordinator
- **WHEN** all reviewers complete but no time remains for the coordinator
- **THEN** the action SHALL post a concatenated raw reviewer output as a fallback PR comment

### Requirement: PR comment output
The system SHALL post exactly one PR comment containing the final coordinator synthesis. The comment MUST include the merge decision, summary, blocking issues, and suggestions in Chinese.

#### Scenario: Successful multi-review completion
- **WHEN** all reviewers and the coordinator complete successfully
- **THEN** a single PR comment is posted with the coordinator's synthesized report

#### Scenario: Reviewer outputs in comment
- **WHEN** the coordinator report is posted
- **THEN** individual reviewer raw outputs SHALL be included in collapsible `<details>` sections for transparency

### Requirement: Model fallback per reviewer
Each reviewer agent SHALL support model fallback using the same mechanism as the existing `review` action (fallback-models, model-timeout-seconds, fallback-on-regex). Each reviewer independently falls back to alternative models on timeout.

#### Scenario: Reviewer model times out and falls back
- **WHEN** a reviewer's primary model times out and fallback-models are configured
- **THEN** that reviewer retries with the next fallback model, while other reviewers continue unaffected

### Requirement: Read-only enforcement
All reviewer and coordinator agents SHALL run in read-only mode. The system MUST deny all edit, bash git, and file modification permissions for every agent invocation.

#### Scenario: Reviewer attempts code modification
- **WHEN** a reviewer agent attempts to modify code or run git commands
- **THEN** the operation is denied by the permission configuration, and the review continues
