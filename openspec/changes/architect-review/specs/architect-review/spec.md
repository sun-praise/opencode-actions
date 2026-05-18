## ADDED Requirements

### Requirement: Architect review action definition
The system SHALL provide a `architect-review/action.yml` composite action that runs architecture-level PR review using the opencode agent engine.

#### Scenario: Action runs successfully on Linux
- **WHEN** a workflow uses `architect-review` action on a Linux runner
- **THEN** the action installs opencode, runs the architect review prompt, and posts the result as a PR comment

#### Scenario: Action rejects non-Linux runners
- **WHEN** a workflow uses `architect-review` action on a non-Linux runner
- **THEN** the action fails with message "architect-review currently supports Linux runners only"

### Requirement: Architecture-focused review prompt
The action SHALL use a default prompt focused on architecture concerns: coupling, layering, responsibility boundaries, interface design, and shotgun surgery patterns.

#### Scenario: Default prompt covers architecture dimensions
- **WHEN** no custom prompt is provided
- **THEN** the review covers: unnecessary coupling between modules, correct module placement, layer/responsibility boundary violations, interface design appropriateness, and cross-cutting change patterns

#### Scenario: Custom prompt overrides default
- **WHEN** user provides a custom `prompt` input
- **THEN** the action uses the custom prompt instead of the default architecture prompt

### Requirement: Architecture context injection
The action SHALL accept an `architecture-context` input specifying file paths to project architecture documentation, which is appended to the prompt.

#### Scenario: Architecture context files are appended to prompt via action.yml shell step
- **WHEN** user provides `architecture-context: "AGENTS.md,docs/architecture.md"`
- **THEN** a shell step in action.yml reads each file's content and appends it to the PROMPT environment variable before execution

#### Scenario: Architecture context file not found
- **WHEN** user provides `architecture-context: "missing-file.md"` and the file does not exist
- **THEN** the action outputs a warning and continues without the file content appended

#### Scenario: No architecture context provided
- **WHEN** `architecture-context` is empty or not provided
- **THEN** the action performs architecture review based solely on the PR diff and repository structure without additional context files

### Requirement: Chinese output format with verdict
The action SHALL produce Chinese-language output with a first-line verdict matching the review action format.

#### Scenario: Output format with verdict
- **WHEN** the architect review completes
- **THEN** the first line is exactly one of: "可合并", "有条件合并", "不可合并"
- **AND** the output includes "架构阻塞项" and "架构建议项" sections

### Requirement: Read-only permission enforcement
The action SHALL enforce read-only mode by setting `GITHUB_RUN_OPENCODE_PERMISSION` to deny all write operations.

#### Scenario: Write operations are denied
- **WHEN** the opencode agent attempts git commit, push, add, stash, reset, or checkout
- **THEN** the operation is denied by the permission configuration

### Requirement: Reuse opencode execution engine
The action SHALL reuse the existing `github-run-opencode/run-github-opencode.py` script and `setup-opencode/` installation logic without modification.

#### Scenario: Same execution path as review action
- **WHEN** the action runs
- **THEN** it calls `setup-opencode/install-opencode.sh` for installation and `github-run-opencode/run-github-opencode.py` for execution, identical to the review action

### Requirement: Example workflow
The system SHALL provide an example workflow at `examples/opencode-architect-review.yml` demonstrating how to use the action.

#### Scenario: Example workflow is valid
- **WHEN** a user copies `examples/opencode-architect-review.yml` into their `.github/workflows/`
- **THEN** the workflow triggers on pull_request events and runs the architect-review action with appropriate permissions
