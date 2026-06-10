# Changelog

All notable changes to this project will be documented in this file.

## [3.8.2] - 2026-06-10
### Fixed
- fix: inject litellm provider config and auth for opencode (#243)
- fix: use @ai-sdk/openai adapter instead of @ai-sdk/openai-compatible for litellm tools compatibility

## [3.8.1] - 2026-06-09

### Changed
- fix(multi-review): unify cost display to USD regardless of language setting (#239)

## [3.8.0] - 2026-06-09

### Added
- feat(multi-review): cost/token tracking per reviewer and coordinator session (#236)
- feat(multi-review): CoordinatorResult type with cost/tokens from SDK prompt results

## [3.7.0] - 2026-06-09

### Added
- feat(multi-review): structured three-level severity classification (blocking/warning/suggestion) (#233)
- feat(multi-review): severity parser with bilingual heading support and fallback
- feat(multi-review): severity-aware comment rendering with emoji-labeled sections

## [3.6.1] - 2026-06-08

### Added
- feat(multi-review): add spec-coverage reviewer persona (#225)
- feat: add litellm-url and litellm-api-key support across all actions (#228)

## [3.6.0] - 2026-06-07

### Added
- feat: add regression-test-missing composite action (#211)
- feat: add test-value-detector action (#49)
- feat(multi-review): add regression-test reviewer persona (#212)
- feat(multi-review): support custom reviewer personas from target repo (#214)
## [3.5.0] - 2026-06-07

### Added
- feat(review): add tiered feedback with warning level, output-format and pass-level inputs (#62)
- feat: add opencode.db cleanup and migration failure auto-recovery (#202)
- chore(marketplace): add per-action README and branding metadata (#192)

### Changed
- test: add unit tests for extract_decision function
- test: verify v3.4.0 tag with multi-review and feature-missing actions

### Fixed
- fix: review action no longer fails on opencode session-share push denial (#129, #190)
- fix(multi-review): filter lock files from PR diff to prevent LLM context overflow (#195)
- fix(multi-review): add local git diff fallback for PRs exceeding 20000 lines (#204)
- fix(multi-review): add configurable diff exclusion and size-based truncation (#196)
- fix(run-opencode): correct env level and reasoning-effort default in README
- fix: address review feedback and YAML parse errors for tiered feedback feature
- fix: avoid redundant JSON re-parse when json.loads succeeds without decision key

## [3.4.0] - 2026-06-04

### Added
- feat: add extra-env sensitive key guard to multi-review + regression tests (#177)
- feat: CI dist consistency check, split blocked key logs, more edge-case tests (#182)
- feat: add language support to architect-review and multi-review (#170)
- feat: add bilingual (zh/en) language support to all actions (#170)

### Changed
- refactor: TS reads hash-avoid prompts from file at runtime (#184)
- refactor: single-source hash-avoid prompts + official npm registry (#181)
- refactor: improve hash regex, parseExtraEnv API, test assertions (#180)
- refactor: address review suggestions from PR #178 (#179)
- fix: address review issues — dead code, dedup, extra-env, set_env, split README (#170)
- fix: address remaining review feedback on PR #184 — single-source-of-truth, sanitized errors, new TS unit tests (#186)
- docs: recommend DeepSeek for multi-review (#169)

### Fixed
- fix: review polish — test naming, ExtraEnvResult, regex safety, CI filter (#183)
- fix: address review feedback from PR #176 (#178)
- fix: address review feedback for hash-reference escaping (#176)
- fix: prevent #N auto-reference conversion in GitHub comments (#175)
- fix: complete SENSITIVE_ENV_KEYS to cover all runtime env vars (#172)
- fix: complete SENSITIVE_ENV_KEYS set to cover all runtime API keys (#171)
- fix(multi-review): widen opencode server-start timeout to 30s (env configurable) (#185)

## [3.3.1] - 2026-06-03

### Fixed
- fix: add DO NOT use bash to all reviewer prompts (#168)

## [3.3.0] - 2026-06-03

### Added
- feat: add XIAOMI_API_KEY support across all actions (#165)
- docs: add recommended models section to setup-ci skill (#163)

## [3.2.0] - 2026-06-02

### Added
- feat: add MINIMAX_API_KEY support across all actions (#155)

## [3.1.1] - 2026-05-30

### Changed
- refactor(multi-review): improve platform.ts code quality (#148)

### Fixed
- fix(multi-review): address PR #148 review feedback (#149)
- fix(multi-review): add REST API fallback for comment posting on self-hosted runners (#147)

## [3.1.0] - 2026-05-30

### Added
- feat(multi-review): deny bash and edit in SDK config
- feat: fully deny bash in review actions for security

### Changed
- chore: remove useless smoke-test workflow (#139)

### Fixed
- fix(multi-review): fallback to GitHub REST API when gh CLI unavailable (#137)
- fix: use OPENCODE_CONFIG_CONTENT env var instead of writing opencode.json

## [3.0.1] - 2026-05-30

### Added
- feat(multi-review): add reasoning-effort and enable-thinking inputs (#127)

### Changed
- docs: add v3.0.0 release notes (#128)
- docs(setup-ci): add multi-review action and bump to v3
- chore: remove redundant setup-ci.skill zip
- chore: add new spec

### Fixed
- fix: align examples to @v3 and tighten feature-missing permissions
- fix: use sun-praise owner and local action refs
- refactor: address review follow-up from PR #119
- ci: bump feature-missing workflow to v3

## [3.0.0] - 2026-05-27

### Added
- feat(architect-review): add architecture-level PR review action (#64)
- feat(multi-review): add multi-agent parallel code review action (#81)
- feat(multi-review): add collapsible reviewer details to coordinator comment
- feat(multi-review): add global session cleanup as safety net (#115)
- feat: add Gitea CI compatibility via platform abstraction layer (#119)
- feat: rewrite multi-review using OpenCode SDK (#103)

### Changed
- refactor(multi-review): replace hand-written YAML parser with js-yaml (#111)
- chore: change default thinking-intensity from max to high (#121)
- docs: add multi-review to README (#109)
- docs(setup-ci): add architect-review and multi-review to skill (#91)
- docs(skills): add missing `permission` input and fix comment-command label (#95)
- chore: remove multi-review action (#101)
- chore: ignore serena file
- chore: add opencode spec
- Update setup-ci skill: add architect-review and multi-review (#88)

### Fixed
- fix(github-run-opencode): configure git identity before opencode runs
- fix: surface opencode errors to CI and catch model-not-found in fallback (#100)
- fix: deny bare git commands in read-only action permission config (#79)
- fix(multi-review): ensure sessions are cleaned up on error paths (#114)
- fix(multi-review): fix CI crashes and clean comment output (#86)
- fix(multi-review): improve comment noise filtering (#87)
- fix(multi-review): isolate reviewers in git worktrees (#90)
- fix: remove unused configPath parameter from loadReviewers() (#113)
- fix: align multi-review README example model provider name with code default (#112)
- ci: test multi-review workflow (#107)
- ci: add multi-review workflow (#84)

## [2.2.0] - 2026-05-18

### Added
- feat: add setup-ci skill for configuring opencode-actions workflows (#70)
- feat: auto-delete error comments posted by opencode to PRs after failed runs (#77)

### Changed
- fix: enforce read-only mode via opencode permission config (#72)
- docs: add npx skills add command to README (#71)
- chore: add os spec

## [2.1.1] - 2026-05-13

### Fixed
- fix(spec-coverage): explicitly forbid git commit/push in prompt

## [2.1.0] - 2026-05-13

### Added
- feat: add spec-coverage action for cross-referencing spec tasks against PR implementation

### Fixed
- fix(spec-coverage): add extra-env input and README documentation
- fix(spec-coverage): treat missing spec files as CRITICAL gap, not graceful exit
- fix(spec-coverage): remove contradictory NO_SPEC_FOUND verdict
- fix(spec-coverage): smart spec-need detection and remove gh CLI dependency
- fix(spec-coverage): simplify spec-need detection to semantic judgment

### Changed
- chore: ignore local settings

## [2.0.5] - 2026-05-07

### Added
- feat(review): add extra-env input for custom environment variable passthrough

## [2.0.4] - 2026-05-07

### Fixed
- fix(feature-missing): prevent stale analysis on new commits via prompt + version resolution + cache key prefix

### Changed
- chore: ignore worktree folder

## [2.0.3] - 2026-05-03

### Fixed
- fix(setup-opencode): restore default-version to opencode minimum version

### Changed
- docs: add bump version note about default-version file
- chore: add agents.md

## [2.0.2] - 2025-05-03

### Fixed
- feature-missing: prevent contradictory verdict when no gaps found

## [2.0.1] - 2025-05-02

### Changed
- chore: bump minimum supported OpenCode version to 1.14.30

### Added
- feat: support reasoning-effort and enable-thinking configuration

### Fixed
- fix: update action refs from v1 to v2

## [2.0.0] - 2025-05-01

### Added
- feat: add feature-missing action for spec coverage audit
- feat: add deepseek-api-key input for deepseek v4 support

### Changed
- refactor: rewrite run-github-opencode in Python3
- test: unify entire test suite as Python3 unittest

### Fixed
- fix: address review feedback - unify cache key, clarify prompt, minimize permissions
- fix: use neutral cache key prefix to avoid ambiguity
- fix: correct description to reflect pre-merge usage
- fix: address PR #36 and PR #10 review feedback

## [1.4.0] - 2025-04-30

### Added
- feat: add feature-missing action for spec coverage audit
- feat: add deepseek-api-key input for deepseek v4 support

### Fixed
- fix: use neutral cache key prefix to avoid ambiguity
- fix: address review feedback - unify cache key, clarify prompt, minimize permissions
- fix: correct description to reflect pre-merge usage
- fix: strip whitespace and validate default-version format
- fix: support 'none' sentinel and add file existence check
- fix: unify default version into single file and fix smoke test

### Changed
- chore: bump minimum opencode version to 1.14.20

## [1.3.0] - 2025-04-29

### Fixed
- fix: remove --foreground from timeout to preserve SIGTERM guarantee
- fix: add configurable github run timeout
- fix: remove hardcoded review prompt from github-run-opencode
- fix: correct spurious quotes in test command substitutions
- fix: prefer MODEL_NAME for default review model

## [1.2.0] - 2025-04-28

### Added
- feat: add minimum version check with auto-reinstall
- feat: dogfood review action in repo workflow

### Fixed
- fix: isolate test env vars by passing via env instead of export
- fix: prevent OPENCODE_INSTALL_ATTEMPTS=0 leak from case_five to case_six
- fix: make review prompts verify current head
- fix: harden opencode version gate checks
- fix: reset install attempts before case_six and handle prerelease semver

## [1.1.3] - 2025-04-27

### Fixed
- fix: export OPENCODE_API_KEY instead of OPENCODE_GO_API_KEY

## [1.1.2] - 2025-04-26

### Fixed
- fix: inject opencode-go API key into auth store before running

## [1.1.1] - 2025-04-25

### Fixed
- fix: remove validate job (shellcheck + local tests)
- fix: remove --retry-all-errors flag unsupported by older curl

## [1.1.0] - 2025-04-24

### Added
- feat: support OpenCode Go API keys

### Changed
- chore: upgrade GitHub Actions versions

## [1.0.0] - 2025-04-23

### Added
- feat: add reusable OpenCode GitHub actions
- feat: add one-step github run action
- feat: simplify common action usage

### Fixed
- fix: quote run-opencode test command paths
- fix: satisfy shellcheck in setup tests
