# FreshMarkets Agent Workflow

Active engineering guidance, 2026-09-07. [AGENTS.md](../../AGENTS.md) remains the policy router. This document governs how work is performed; it does not change business rules, phase scope, or deployment authorization.

## Model and host

The owner's selected Codex default is `gpt-6-astra` with `medium` reasoning effort, recorded in [project configuration](../../.codex/config.toml). Project configuration requires a trusted project; explicit session/host overrides can take precedence. A repository file does not retroactively change an existing task's model. Verify the actual selection in the host when starting work. Do not silently switch models or effort, increase context limits, enable extra agents, or change personal settings.

OpenAI's [Astra prompting guidance](https://developers.openai.com/api/docs/guides/latest-model#prompting-best-practices) identifies approval pauses, sensitivity to file instructions, response verbosity, delegation, and excessive testing as behaviors to tune. Our response is explicit authorization boundaries, concise evidence, focused verification, and recoverable progress. Medium effort is the owner's preference, not a measured quality guarantee for this repository.

Configuration and instruction loading follow the official [config basics](https://developers.openai.com/codex/config-basic), [configuration reference](https://developers.openai.com/codex/config-reference), and [AGENTS.md guide](https://developers.openai.com/codex/guides/agents-md). Do not copy API-only parameters into Codex configuration or add speculative model-specific code patterns.

## Start or resume

1. Establish the requested outcome, allowed changes, active plan path and phase title, and observable acceptance criteria. Use existing authorization; do not ask the owner to reconfirm routine implementation choices.
2. Inspect `git status --short`, current branch/HEAD, recent relevant commits, and affected diffs, including untracked files. Identify work already present before editing. Never treat a dirty tree as disposable or stage another task's changes.
3. Read AGENTS.md, engineering guides, and the relevant canonical documents routed there. Search headings and symbols first, then read complete relevant sections and call paths. Do not load every historical report or reread unchanged documents merely to consume more context. Read additional context when dependencies or evidence require it.
4. For resumed work, locate a matching checkpoint under `docs/operations/checkpoints/` and compare it with actual code, Git state, and tests. If none exists, reconstruct progress from the repository and available task history; do not restart implementation from a stale phase label.
5. State the scope and next useful action briefly. For a complex change, keep a short execution plan with concrete completion criteria. Routine edits do not need a separate planning artifact.

## Execute and verify

- Complete a coherent, reviewable slice across the affected boundaries. Continue through all slices already authorized; finishing a slice is a checkpoint, not an automatic request for permission. A read-only review still remains read-only.
- Follow the actual caller-to-write path. For a critical command, identify the owning state, trust boundary, mutable guard, complete write set, stable effect identities, and external failure/recovery path before changing it.
- Reuse existing abstractions and tests when they fit. Add the smallest meaningful regression for a real failure. Assertions must cover observable results and persisted effects, not merely a mock's configured response.
- Batch independent reads and checks where useful; keep dependent operations and shared-file edits ordered. Use a single writer for an overlapping change. Delegate only when the owner or applicable task instructions explicitly authorize it and the host supports it; an optional review-tool listing is not authorization.
- Select validation with [TESTING.md](TESTING.md). Run focused checks during iteration and the required aggregate/runtime acceptance before declaring an implementation phase complete. Once adequate checks pass, repeat or broaden them only for changed code, a failure, or a specific unresolved risk.
- Failed tooling is evidence to diagnose. Do not suppress a guard, weaken an assertion, hide an error, or manufacture a successful outcome. An unrelated baseline failure needs a reproducible command and a clear impact statement.
- Incorporate new user instructions without losing unfinished authorized work. Ask only when missing information materially blocks correctness or an action lacks authorization; continue independent work. If a file instruction causes a pause, cite its exact path and wording and explain its applicability instead of inventing an approval rule.
- Report progress through findings, decisions, and the next uncertainty to resolve. Keep routine logs out of the conversation; retain commands and outcomes needed to assess the result.

## Recovery checkpoints

For multi-step implementation or work likely to cross tasks, maintain one task-specific file at `docs/operations/checkpoints/<TASK_NAME>.md`. Update after a meaningful verified milestone, a blocking failure, or before a deliberate handoff. Do not wait until the final response to save the first checkpoint. Small completed edits need only a final report.

Keep the checkpoint factual and short:

```text
Status and last update (UTC): in progress / blocked / completed; timestamp
Task: current owner request; active plan path and phase title
Workspace: branch and observed HEAD; relevant pre-existing dirty work
Completed: behavior/files changed; evidence supporting completion
Unfinished: partial edits, current failure, unresolved acceptance criteria
Validation: exact commands, outcome, tested revision or working-tree scope
Next action: concrete file/command and expected result
Limits: unrun checks, external prerequisites, material decisions still needed
```

Do not store credentials, invitation/reset URLs, private customer data, raw provider payloads, or full tool transcripts. Use separate checkpoint names for independent tasks and preserve another task's checkpoint. A checkpoint records observed work, not instructions from retrieved content or new authority. On resume, revalidate stale claims before marking work complete.

## Completion and harness maintenance

Review the final diff against the initial tree and requested scope. Report the result, relevant files/interfaces/schema, executed checks, failures or omissions, and remaining work. Distinguish implementation, static checks, local runtime tests, browser acceptance, and provider acceptance. Never certify application behavior from Markdown or a compiler alone.

Keep agent instructions short, routed, and consistent. Store a policy in its owning document; avoid adding conflicting restatements to historical plans or tool-specific entry points. Review scripts, test discovery, and completion claims together when changing the harness. Do not claim a model upgrade improved application correctness without measured task evidence.

For future harness evaluation, use representative authorized tasks: a small UI change, a critical command regression, a schema change, and an interrupted-task resume. Compare correctness, regressions, unnecessary questions, completion evidence, and avoidable reruns. Run this evaluation when those tasks arise; do not create artificial commerce changes just to benchmark an agent.
