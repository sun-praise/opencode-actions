# shared/

Cross-action shared data files. Each subdirectory holds a specific category.

## prompts/

Plain-text prompt snippets used by multiple actions (e.g. `multi-review`, `github-run-opencode`).

Each file contains the prompt text without surrounding whitespace. These are the **single source of truth** — both TS (`multi-review/src/reviewers.ts` via `actionPath/../shared/prompts/`) and Python (`run-github-opencode.py` via `Path(__file__).parent.parent/shared/prompts/`) load from here at runtime. The path layout relies on the action checkout including the repository root (which is true for both `uses: ./multi-review` and `uses: org/repo/multi-review@vN` on GitHub Actions).

If you add a new prompt file, update `tests/test_all.py` accordingly and run the Python test suite to verify consistency.

## cleanup-db.sh

A standalone shell script that checks the size of `~/.local/share/opencode/opencode.db` and deletes it if it exceeds a configurable threshold (default 50MB). Called from `github-run-opencode/action.yml` before the opencode run step. Controlled by the `cleanup-db` action input.

Environment variables:
- `OPENCODE_DB_PATH` — path to the database file (default: `~/.local/share/opencode/opencode.db`); validated to reject system directories (`/etc`, `/usr`, etc.)
- `OPENCODE_DB_MAX_SIZE_MB` — max allowed size in MB before cleanup (default: `50`); `0` or negative disables cleanup

## resolve-db-path.sh

Shared helper that resolves `OPENCODE_DB_PATH` to an absolute path and validates it's not pointing into system directories. Sourced by `cleanup-db.sh`. The same path resolution logic is used inline in `run-opencode.sh` for migration recovery.
