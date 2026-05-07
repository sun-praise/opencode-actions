# Changelog

All notable changes to this project will be documented in this file.

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
