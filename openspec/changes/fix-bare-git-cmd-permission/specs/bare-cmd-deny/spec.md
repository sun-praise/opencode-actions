## ADDED Requirements

### Requirement: Bare git commands SHALL be denied in read-only actions

The bash permission config in `review/action.yml`, `feature-missing/action.yml`, and `spec-coverage/action.yml` SHALL include explicit deny rules for bare git commands (invoked without arguments): `git commit`, `git push`, `git add`, `git stash`, `git reset`, `git checkout`. Each bare rule SHALL appear before its corresponding wildcard rule (e.g., `"git push":"deny"` before `"git push *":"deny"`).

#### Scenario: Bare git commit is denied
- **WHEN** opencode runs `git commit` (no arguments) in a read-only action
- **THEN** the command SHALL be denied by permission config

#### Scenario: Bare git push is denied
- **WHEN** opencode runs `git push` (no arguments) in a read-only action
- **THEN** the command SHALL be denied by permission config

#### Scenario: Git push with arguments is still denied
- **WHEN** opencode runs `git push origin main` in a read-only action
- **THEN** the command SHALL be denied by the existing wildcard rule

#### Scenario: Bare git add is denied
- **WHEN** opencode runs `git add` (no arguments) in a read-only action
- **THEN** the command SHALL be denied by permission config

#### Scenario: Bare git stash is denied
- **WHEN** opencode runs `git stash` (no arguments) in a read-only action
- **THEN** the command SHALL be denied by permission config

#### Scenario: Bare git reset is denied
- **WHEN** opencode runs `git reset` (no arguments) in a read-only action
- **THEN** the command SHALL be denied by permission config

#### Scenario: Bare git checkout is denied
- **WHEN** opencode runs `git checkout` (no arguments) in a read-only action
- **THEN** the command SHALL be denied by permission config

#### Scenario: All three actions have consistent permission rules
- **WHEN** comparing the bash permission JSON in review, feature-missing, and spec-coverage actions
- **THEN** all three SHALL have identical bare + wildcard deny rules for the six git commands
