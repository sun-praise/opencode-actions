## ADDED Requirements

### Requirement: Action triggers on pull_request and issue_comment events

The action SHALL support two trigger modes:
1. Automatic: triggered by `pull_request` (opened, synchronize) events
2. Manual: triggered by `issue_comment` event when comment body starts with `/multi-review`

#### Scenario: Automatic trigger on PR open
- **WHEN** a pull_request event with type `opened` occurs
- **THEN** the action SHALL run multi-review on the PR

#### Scenario: Automatic trigger on PR push
- **WHEN** a pull_request event with type `synchronize` occurs
- **THEN** the action SHALL run multi-review on the updated PR

#### Scenario: Manual trigger via comment
- **WHEN** an issue_comment event occurs with body starting with `/multi-review`
- **AND** the issue is a pull request (not a plain issue)
- **THEN** the action SHALL run multi-review on the PR

#### Scenario: Ignore non-multi-review comments
- **WHEN** an issue_comment event occurs with body not starting with `/multi-review`
- **THEN** the action SHALL skip execution

### Requirement: Action runs multiple reviewer agents in parallel

The action SHALL use pi-parallel-agents team mode to run multiple reviewer agents simultaneously. Each reviewer SHALL receive the PR diff as context and produce independent review findings.

#### Scenario: Default reviewer personas run in parallel
- **WHEN** no custom reviewers configuration is provided
- **THEN** the action SHALL run 4 default reviewers: quality, security, performance, architecture
- **AND** all reviewers SHALL execute in parallel

#### Scenario: Custom reviewers configuration
- **WHEN** user provides a `reviewers-config` input pointing to a YAML file
- **THEN** the action SHALL load reviewer definitions from that file
- **AND** run the specified reviewers instead of defaults

### Requirement: Synthesizer produces single consolidated PR comment

After all reviewers complete, the action SHALL run a synthesizer agent that merges all reviewer findings into a single structured PR comment. The comment SHALL include:
1. Per-reviewer findings (grouped by persona)
2. Cross-validated conclusions (findings agreed upon by multiple reviewers)
3. Actionable recommendations ordered by priority

#### Scenario: Successful synthesis
- **WHEN** all reviewer agents complete successfully
- **THEN** the synthesizer SHALL produce a single PR comment
- **AND** the comment SHALL contain findings from each reviewer
- **AND** the comment SHALL contain a consolidated summary

#### Scenario: Partial reviewer failure
- **WHEN** one or more reviewer agents fail but at least one succeeds
- **THEN** the synthesizer SHALL produce a comment with available findings
- **AND** the comment SHALL note which reviewers failed

#### Scenario: All reviewers fail
- **WHEN** all reviewer agents fail
- **THEN** the action SHALL post an error comment on the PR
- **AND** the action SHALL exit with a failure code

### Requirement: Reviewer personas are configurable via YAML

The action SHALL accept a `reviewers-config` input that accepts an inline YAML string or a file path. Each reviewer persona SHALL define:
- `name`: reviewer identifier
- `role`: role description for the LLM prompt
- `prompt`: custom review instructions (supports `{{diff}}`, `{{title}}`, `{{body}}`, `{{files}}` placeholders)
- `model`: (optional) LLM model to use, defaults to action-level model

#### Scenario: Override default reviewers with custom config
- **WHEN** user provides `reviewers-config` input with 2 custom reviewers
- **THEN** only the 2 custom reviewers SHALL run (defaults are not merged)

#### Scenario: Use default reviewers without config
- **WHEN** `reviewers-config` input is empty
- **THEN** the action SHALL use 4 built-in default reviewers (quality, security, performance, architecture)

### Requirement: Action exposes LLM configuration inputs

The action SHALL expose the following LLM-related inputs:
- `model`: default model for all reviewers (default: `claude-sonnet-4-6`)
- `api-key`: LLM provider API key (required, mapped from secrets)
- `max-tokens`: maximum tokens per reviewer response (default: `4096`)

#### Scenario: User specifies custom model
- **WHEN** user sets `model` to `gpt-4o`
- **THEN** all reviewers (without per-reviewer model override) SHALL use `gpt-4o`

#### Scenario: Per-reviewer model override
- **WHEN** a reviewer persona in `reviewers-config` specifies `model: claude-opus-4-7`
- **THEN** that reviewer SHALL use `claude-opus-4-7` regardless of action-level `model`

### Requirement: Action integrates with shaftoe/pi-coding-agent-action

The action SHALL be a composite action that delegates to `shaftoe/pi-coding-agent-action@v2` with `extensions: npm:pi-parallel-agents`. The action SHALL handle:
1. Constructing the team mode DAG from reviewer config
2. Passing PR context (diff, title, body) to reviewers via prompt templates
3. Formatting the final output as a PR comment

#### Scenario: Composite action delegates correctly
- **WHEN** the action executes
- **THEN** it SHALL call `shaftoe/pi-coding-agent-action@v2` with the appropriate inputs
- **AND** pass `extensions: npm:pi-parallel-agents`
- **AND** pass the constructed team DAG as `prompt`

### Requirement: Example workflow is provided

The action SHALL include an example GitHub workflow file demonstrating both trigger modes (pull_request and issue_comment) with recommended permissions.

#### Scenario: User copies example workflow
- **WHEN** user copies the example workflow to their `.github/workflows/` directory
- **AND** adds the required secrets
- **THEN** multi-review SHALL work on their repository without additional configuration
