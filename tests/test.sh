#!/usr/bin/env bash

set -euo pipefail

bash tests/github-run-opencode.sh
bash tests/review-action.sh
bash tests/dogfood-review-workflow.sh
