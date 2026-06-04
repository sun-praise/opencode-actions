# Setup OpenCode

Part of [`sun-praise/opencode-actions`](https://github.com/sun-praise/opencode-actions) — installs and caches the OpenCode CLI on Linux runners and exports the binary path for downstream steps. Linux runners only.

## Quick start

```yaml
- name: Setup OpenCode
  uses: sun-praise/opencode-actions/setup-opencode@v3

- name: Run OpenCode
  run: opencode --version
  shell: bash
```

`opencode` is added to `PATH` automatically, so downstream `run:` steps and other actions can call it directly. If you need the absolute path, capture it from the `opencode-path` output.

## What it does

- Installs OpenCode via the official installer (`https://opencode.ai/install` by default; configurable via `install-url`)
- Restores a dedicated cache backed by `actions/cache`
- Exports `opencode` to `PATH` for the current job
- Default behaviour ignores unrelated `opencode` binaries already on `PATH`; set `allow-preinstalled: true` only if you explicitly trust the runner image
- Cache invalidation is controlled by `cache-key` (the internal cache key also hashes `install-url`, so changing the installer source does not silently reuse an older cache entry)

## Inputs

| Input | Default | Description |
| --- | --- | --- |
| `install-url` | `https://opencode.ai/install` | Installer URL used to bootstrap OpenCode |
| `install-dir` | computed | Directory where `opencode` will be installed |
| `xdg-cache-home` | computed | Dedicated XDG cache directory |
| `cache` | `true` | Enable `actions/cache` for install and cache directories |
| `cache-key` | `v1` | Cache key suffix used to invalidate installer caches |
| `install-attempts` | `3` | Total installer attempts |
| `allow-preinstalled` | `false` | Reuse an existing trusted `opencode` already on `PATH` |
| `version` | empty | Optional minimum-version hint recorded in logs |

## Outputs

| Output | Description |
| --- | --- |
| `opencode-path` | Resolved absolute path to `opencode` |
| `install-dir` | Resolved install directory |
| `xdg-cache-home` | Resolved XDG cache directory |
| `cache-hit` | Whether `actions/cache` restored a hit |
| `version` | `opencode --version` output |

## Limitations

- Linux only
- Cache is best-effort and does not pin an exact OpenCode version
- The installer is external; use `cache-key` to force a fresh install when needed

## Related actions in this monorepo

- [`run-opencode`](https://github.com/sun-praise/opencode-actions/tree/main/run-opencode) — generic `opencode` runner with retry logic
- [`github-run-opencode`](https://github.com/sun-praise/opencode-actions/tree/main/github-run-opencode) — one-step wrapper for `opencode github run`
- [`review`](https://github.com/sun-praise/opencode-actions/tree/main/review) — opinionated PR review wrapper
- [`multi-review`](https://github.com/sun-praise/opencode-actions/tree/main/multi-review) — multi-agent parallel review with coordinator synthesis
- [`architect-review`](https://github.com/sun-praise/opencode-actions/tree/main/architect-review) — architecture-focused review
- [`feature-missing`](https://github.com/sun-praise/opencode-actions/tree/main/feature-missing) — PR scope audit vs linked issue
- [`spec-coverage`](https://github.com/sun-praise/opencode-actions/tree/main/spec-coverage) — spec/task coverage audit

See the [root README](https://github.com/sun-praise/opencode-actions) for the full list of inputs and examples.

## License

Apache 2.0
