## Context

Three read-only actions (`review`, `feature-missing`, `spec-coverage`) enforce write protection via opencode's bash permission config. The current config uses wildcard patterns like `"git push *"` to deny dangerous git commands. However, opencode's matching requires at least one argument to match `*`, so bare commands (`git push`, `git stash`, etc.) are not intercepted and default to allow.

## Goals / Non-Goals

**Goals:**
- Block bare git commands (no arguments) in all read-only actions
- Maintain existing wildcard deny rules for commands with arguments
- Keep the fix minimal and consistent across all three actions

**Non-Goals:**
- Refactoring the permission JSON into a shared constant (separate concern)
- Changing opencode's matching semantics
- Adding new git command restrictions beyond the existing set

## Decisions

**Decision: Add explicit bare command rules before wildcard rules**

Each git command gets two entries: `"git push":"deny"` (bare) and `"git push *":"deny"` (with args). These cover disjoint cases — opencode's `*` glob requires at least one argument, so `"git push *"` does not match the bare `git push`. The bare rule matches commands with no arguments, and the wildcard rule matches commands with arguments.

Alternative considered: Using a single regex-like pattern — rejected because opencode permission config uses glob-style matching, not regex.

## Risks / Trade-offs

- [Opencode changes matching semantics] → Unlikely; the glob-style matching is documented behavior. If it changes, the explicit bare rules provide defense-in-depth anyway.
- [New git subcommands added later] → Out of scope; this fix addresses the known set of dangerous commands.
