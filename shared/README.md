# shared/

Cross-action shared data files. Each subdirectory holds a specific category.

## prompts/

Plain-text prompt snippets used by multiple actions (e.g. `multi-review`, `github-run-opencode`).

Each file contains the prompt text without surrounding whitespace. These are the **single source of truth** — both TS (`multi-review/src/reviewers.ts` via `actionPath/../shared/prompts/`) and Python (`run-github-opencode.py` via `Path(__file__).parent.parent/shared/prompts/`) load from here at runtime. The path layout relies on the action checkout including the repository root (which is true for both `uses: ./multi-review` and `uses: org/repo/multi-review@vN` on GitHub Actions).

If you add a new prompt file, update `tests/test_all.py` accordingly and run the Python test suite to verify consistency.
