## ADDED Requirements

### Requirement: Built-in reviewer personas
The system SHALL provide 4 built-in reviewer personas: `quality`, `security`, `performance`, and `architecture`. Each persona SHALL have a predefined prompt focused on its domain.

#### Scenario: Default team uses built-in personas
- **WHEN** the user does not provide a custom reviewer config
- **THEN** the action uses the default team of `quality` (count: 1) and `security` (count: 1)

#### Scenario: User selects specific built-in personas
- **WHEN** the user specifies `reviewers: quality:1,performance:1` in the action config
- **THEN** only the quality and performance reviewers run, with 1 instance each

### Requirement: Custom reviewer personas
The system SHALL allow users to define custom reviewer personas via a YAML configuration file. Each custom persona MUST have a unique name and a prompt. Custom personas override built-in personas with the same name.

#### Scenario: User defines custom persona
- **WHEN** the user provides a YAML file with a custom persona named `api-design` with a specific prompt
- **THEN** the action creates a reviewer using that prompt and the name `api-design`

#### Scenario: Custom persona overrides built-in
- **WHEN** the user defines a custom persona named `security` with a custom prompt
- **THEN** the built-in `security` persona is replaced by the user's custom version

### Requirement: Reviewer redundancy
The system SHALL support running multiple instances of the same persona by setting a `count` field greater than 1. The coordinator MUST treat redundant instances of the same persona as independent reviewers for cross-validation.

#### Scenario: Two quality reviewers run
- **WHEN** the user configures `quality` with count: 2
- **THEN** two independent quality reviewer instances run in parallel with the same prompt

#### Scenario: Redundant reviewers agree
- **WHEN** two redundant instances of the same persona both report the same issue
- **THEN** the coordinator marks that finding with higher confidence

#### Scenario: Redundant reviewers disagree
- **WHEN** two redundant instances of the same persona produce conflicting findings
- **THEN** the coordinator notes the disagreement and makes a final judgment

### Requirement: Reviewer config file path
The system SHALL accept a `reviewer-config` input specifying the path to a YAML file defining the reviewer team. When not provided, the system uses the built-in default team.

#### Scenario: Custom config file provided
- **WHEN** the user sets `reviewer-config: .github/reviewers.yaml`
- **THEN** the action reads reviewer definitions from that file

#### Scenario: Config file not found
- **WHEN** the specified config file does not exist
- **THEN** the action SHALL fail with an error message indicating the file was not found

#### Scenario: No config file provided
- **WHEN** the user does not set `reviewer-config`
- **THEN** the action uses the default team (quality + security)
