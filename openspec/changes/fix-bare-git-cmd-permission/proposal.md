## Why

Bash permission rules in read-only actions use wildcard patterns like `"git push *"` to block dangerous git commands, but bare commands (no arguments) such as `git push`, `git stash` are NOT matched and default to allow. This is a security gap — a bare `git push` with a configured upstream can still push code in CI.

## What Changes

- Add bare command deny rules (`"git commit"`, `"git push"`, `"git add"`, `"git stash"`, `"git reset"`, `"git checkout"`) before their wildcard counterparts in all three read-only actions' bash permission config
- Affects `review/action.yml`, `feature-missing/action.yml`, `spec-coverage/action.yml`

## Capabilities

### New Capabilities

- `bare-cmd-deny`: Explicit deny rules for bare git commands (no arguments) in opencode bash permission config, ensuring zero-write enforcement even when commands are invoked without arguments

## Impact

- `review/action.yml`, `feature-missing/action.yml`, `spec-coverage/action.yml` — bash permission JSON objects modified
- No API or dependency changes
- No breaking changes to action consumers — this tightens existing security guarantees
