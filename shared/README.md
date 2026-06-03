# shared/

Cross-action shared data files. Each subdirectory holds a specific category.

## prompts/

Plain-text prompt snippets used by multiple actions (e.g. `multi-review`, `github-run-opencode`).

Each file contains the prompt text without surrounding whitespace. Files are the canonical reference for consistency tests — both TypeScript and Python inline copies must match.
