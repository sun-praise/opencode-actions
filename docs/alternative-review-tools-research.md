# Open-Source AI Code Review Tools Research

> Research conducted 2026-06-24 to evaluate whether existing open-source projects can replace opencode-actions' multi-agent parallel review capability.

## TL;DR

No open-source project matches opencode-actions' multi-agent parallel review architecture. The unique value — multiple specialized reviewers (quality, security, performance, architecture, etc.) running concurrently with a coordinator synthesizing findings — has no equivalent in the open-source ecosystem.

## Evaluated Projects

### Tier 1: Self-Hosted AI Review (Most Relevant)

| Project | Stars | License | Multi-Agent | Self-Hosted | Webhook/CI |
|---|---|---|---|---|---|
| [Kodus AI](https://github.com/kodustech/kodus-ai) | 1.2k | AGPLv3 | ❌ Single agent | ✅ Docker Compose | ✅ GitHub/GitLab/Bitbucket |
| [PR-Agent (Qodo)](https://github.com/The-PR-Agent/pr-agent) | ~11k | Apache 2.0 | ❌ Single agent | ✅ Ollama | ✅ GitHub/GitLab |
| [Tabby](https://github.com/TabbyML/tabby) | 33k | Apache 2.0 | ❌ Completion-focused | ✅ Self-contained | ❌ Not review-first |

### Tier 2: GitHub Actions (Simple Single-Agent)

| Project | Stars | Last Updated | Notes |
|---|---|---|---|
| [villesau/ai-codereviewer](https://github.com/villesau/ai-codereviewer) | ~1k | Dec 2023 | Stale, model deprecated |
| [cirolini/genai-code-review](https://github.com/cirolini/genai-code-review) | 366 | May 2024 | Near-stale |
| [snarktank/ai-pr-review](https://github.com/snarktank/ai-pr-review) | 57 | Active | Claude-only, early stage |
| [augmentcode/review-pr](https://github.com/augmentcode/review-pr) | 39 | Nov 2025 | Requires Augment API (closed-source) |

### Tier 3: Rule-Based (Non-LLM)

| Project | Stars | Notes |
|---|---|---|
| SonarQube Community | ~10.3k | 21 languages, rule-based, no LLM |
| Semgrep | N/A | Custom rules, security-focused |
| CodeQL | N/A | Requires GitHub Advanced Security for private repos |

### Tier 4: SaaS (Not Open-Source)

| Project | Pricing | Notes |
|---|---|---|
| CodeRabbit | $12/user/month | No open-source self-hosted option |
| Augment Cosmos | Enterprise | Closed-source |

## Key Findings

### What opencode-actions does that others don't

1. **Multi-agent parallel review**: Spawns N specialized reviewer sessions (quality, security, performance, architecture, regression-test, feature-missing, test-value, spec-coverage) concurrently via OpenCode SDK
2. **Coordinator synthesis**: A coordinator session reads all reviewer outputs and produces a deduplicated, synthesized comment
3. **Model flexibility**: Works with any model supported by OpenCode (DeepSeek, GLM, Claude, GPT, local via LiteLLM)
4. **Zero infrastructure**: Runs entirely within GitHub Actions — no web service to maintain
5. **Customizable personas**: Built-in reviewer personas with extensible configuration

### What alternatives offer

- **Kodus AI**: Best alternative for single-agent review with learning/memory, but requires maintaining a Docker Compose service and lacks multi-agent parallelism
- **PR-Agent**: Most popular open-source option, but legacy project with known configuration bugs (#2098, #2083) blocking local model deployment
- **CodeRabbit**: Best overall product, but closed-source SaaS

### Kodus AI Community Edition Limitations

| Feature | Community (Free) | Teams ($10/dev/month) |
|---|---|---|
| Kody Rules (custom rules) | Up to 10 | Unlimited |
| Active plugins | Up to 3 | Unlimited |
| Priority queue for Kody Agents | ❌ | ✅ |
| Engineering Metrics | ❌ | ✅ |

## Conclusion

opencode-actions' multi-agent parallel review architecture is unique in the open-source ecosystem. The project should be maintained rather than replaced. No existing alternative provides:
- Parallel specialized reviewer personas
- Coordinator synthesis of multi-agent findings
- Zero-infrastructure GitHub Actions deployment
- Full model flexibility via OpenCode SDK

## Recommendation

Continue maintaining opencode-actions. The multi-agent parallel review capability is a genuine differentiator with no open-source equivalent.
