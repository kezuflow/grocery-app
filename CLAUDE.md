# FreshMarkets Agent Working Guide

Read [AGENTS.md](AGENTS.md) first. It routes the repository's architecture, business, design, and engineering rules. This file is a tool-specific entry point, not a second policy authority or a model-specific coding style.

Apply [AGENT_WORKFLOW.md](docs/architecture/AGENT_WORKFLOW.md) for execution and recovery. Its workflow is shared across hosts; Codex model settings do not select a Claude model or require delegation.

## Before editing

1. Read [coding standards](docs/architecture/CODING_STANDARDS.md), [testing guidance](docs/architecture/TESTING.md), and the canonical documents relevant to the task through AGENTS.md.
2. Inspect the actual implementation, manifests, tests, and working-tree changes. Dated reports and implementation status are evidence to verify, not guarantees of correctness.
3. Follow the owner's current instructions. Preserve unrelated work and avoid expanding the task into another business plan, feature phase, or dependency upgrade.

## Engineering defaults

Use clear TypeScript, narrow validated contracts, Core-owned commands, capability/scope enforcement, atomic database effects, idempotent external operations, and meaningful failure-path tests. Prefer maintainable direct code over speculative abstraction. Never weaken checks or introduce fake success to make a task appear complete.

FreshMarkets is pre-launch. Schema/interface redesign and migration rebasing are permitted when useful, with consumers/tooling/tests updated together and disposable versus retained environments identified. Do not preserve obsolete schema solely for historical compatibility. Follow the lifecycle policy in CODING_STANDARDS.md.

## Review tooling

The [architecture reviewer](.claude/agents/architecture-reviewer.md) and [phase-review skill](.claude/skills/phase-review/SKILL.md) are optional tools when the requested work calls for them and the host supports them. They are not required for every edit, do not replace direct validation, and do not authorize additional agents or implementation beyond the task.

Reviews distinguish business intent, implementation defects, documentation drift, and technical debt. Cite concrete evidence and test the failure path where appropriate. Do not make a review-only task mutate application state.

## Completion

Use [TESTING.md](docs/architecture/TESTING.md) to select checks. Run the full aggregate gate at implementation-phase completion and the relevant browser/provider checks it does not include. For Markdown-only work, check documentation integrity and conventions. Follow [TRUNK.md](TRUNK.md) for Git workflow, and report exactly what was changed and verified.
