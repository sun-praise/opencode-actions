## 1. Update permission rules in all read-only actions

- [x] 1.1 Update `review/action.yml` — add bare git command deny rules before wildcard rules in bash permission JSON
- [x] 1.2 Update `feature-missing/action.yml` — add bare git command deny rules before wildcard rules in bash permission JSON
- [x] 1.3 Update `spec-coverage/action.yml` — add bare git command deny rules before wildcard rules in bash permission JSON

## 2. Verify consistency

- [x] 2.1 Diff the three action files to confirm identical bash permission blocks
