#!/usr/bin/env bash

set -euo pipefail

bash tests/setup-opencode.sh
bash tests/run-opencode.sh
bash tests/github-run-opencode.sh
python3 tests/review-action.py
bash tests/dogfood-review-workflow.sh
