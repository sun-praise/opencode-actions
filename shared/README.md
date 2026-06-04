# shared/

Cross-action shared data files. Each subdirectory holds a specific category.

## prompts/

Plain-text prompt snippets used by multiple actions (e.g. `multi-review`, `github-run-opencode`).

Each file contains the prompt text without surrounding whitespace. These are the single source of truth — both TS (`multi-review/prompts/`) and Python (`run-github-opencode.py` via `Path(__file__)`) load from here at runtime.
