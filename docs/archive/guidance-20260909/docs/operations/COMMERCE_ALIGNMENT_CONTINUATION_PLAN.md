# Commerce alignment continuation plan

Created 2026-09-09 (Asia/Manila). This is an execution aid for the owner's authorized completion work. It does not change product policy, phase acceptance, or deployment authorization.

## Sources and ownership

- Business and engineering authority: [AGENTS.md](../../AGENTS.md) and the canonical documents and guides it routes to. Current explicit owner instructions prevail over older records.
- Authorized scope and acceptance: [COMMERCE_ALIGNMENT_E2E_PLAN.md](../product/COMMERCE_ALIGNMENT_E2E_PLAN.md), including sections A-I, the audit defects, the phase acceptance table, and final journeys. Always identify this path and the phase title; other plans reuse phase numbers.
- Current execution state: [COMMERCE_ALIGNMENT_EXECUTION.md](checkpoints/COMMERCE_ALIGNMENT_EXECUTION.md). This is the only mutable task ledger and current next-action record for this work.
- Previous evidence: [archived checkpoint](checkpoints/COMMERCE_ALIGNMENT_EXECUTION_HISTORY_20260909.md). Search a relevant heading or commit only when evidence is needed. Its old pauses, next actions, missing-feature claims and HEAD values are historical.
- Execution method: [AGENT_WORKFLOW.md](../architecture/AGENT_WORKFLOW.md); verification: [TESTING.md](../architecture/TESTING.md); commit destination: [TRUNK.md](../../TRUNK.md).

Keep business rules in their canonical owners, progress in the active checkpoint, and detailed old evidence in history. Do not duplicate a changing task status in this plan or treat a checkpoint as authority to change policy.

## Resume procedure

1. Read the current user request, AGENTS, this plan and the active checkpoint. Follow the engineering guides and load the relevant canonical sections for the active phase. Do not load the entire history by default.
2. Inspect branch, HEAD, recent relevant commits, `git status --short`, and the affected tracked/untracked files. Compare them with the checkpoint. Preserve another task's changes; never use a clean-tree assumption or stage everything.
3. Resolve discrepancies from actual code, diffs and relevant evidence. An old report saying a command is absent is a reason to inspect its current call path, not to implement it again. Record newly observed state before proceeding.
4. Identify one active slice by stable ID, full phase title and observable outcome. State the immediate action briefly. Continue already authorized work without a routine approval pause.
5. On the first implementation resume after this plan, reconcile the current slice and register any overlooked prerequisite gaps from sections A-I and the audit-defect list. This is a focused coverage check, not a restart of all completed phases. Repair blocking prerequisites before dependent work; keep other acceptance gaps assigned to their owning phase.

## Scope and task ledger

The remaining major sequence is: finish Phase 3; Phase 4 warehouse distribution; Phase 5 Scheduled operations; Phase 6 delivery/customer alignment; Phase 7 complete journeys/activation evidence. Phases 0-2 retain explicit acceptance obligations and are not automatically complete because later work exists.

Use stable IDs prefixed `CA-` in the checkpoint. Keep the existing IDs when work resumes. Split a phase into concrete slices when its actual call paths and dependencies are known; record the parent ID and acceptance coverage when splitting. Do not manufacture a fixed total of small tasks before that inspection.

Each active slice records:

- Phase path/title and the exact source heading or acceptance criterion it satisfies.
- Observable customer/operator outcome, owning modules, dependencies and affected write/read path.
- Required schema/RPC/UI work, mutable command guards, external recovery and verification where relevant.
- Implementation status: `pending`, `in progress`, or `implemented`.
- Acceptance status: `not verified`, `partially verified`, `verified`, or `blocked externally`.
- Evidence: command, result, tested commit or explicitly described working-tree scope, and log/artifact location.
- Remaining work and one concrete next action.

Only one overlapping implementation slice is active at a time. Independent authorized work may proceed when an external prerequisite blocks another item, but the blocked item remains visible. There is no authorization for subagents in this task.

Report counts at a named level: remaining major phases, open slices, or acceptance obligations. Never equate test counts, commits, scaffolding or a phase number with a percentage complete. A split changes the slice count, not the authorized scope; explain that change.

## Execution and completion gates

1. Trace the actual Web -> typed contract -> Core command/query -> storage/provider path before editing. Establish required effects and failure behavior using the routed engineering guidance.
2. Complete a coherent slice through its applicable boundaries. Keep ordinary CRUD and internal safeguards consistent with approved design rules. A schema, helper or RPC stub alone does not complete a workflow.
3. Run focused verification during iteration. At phase completion, run the aggregate gate and relevant Worker/D1, browser, schema and provider acceptance required by TESTING and the source plan. Record actual execution, not test discovery. Prior checks apply only to their recorded revision and scope.
4. Review the final diff and required acceptance criteria. Mark a slice verified only when its required evidence exists. Keep local fakes, actual provider sandbox acceptance and deployment readiness separate. Unavailable external acceptance remains open.
5. Update the checkpoint and any changed canonical contract/policy documentation before handoff. Commit only the coherent verified slice and its documentation directly to `main`, then `git push origin main`. Do not include another task's changes or unfinished adjacent code. Record commit/push results factually; a future checkpoint may name the commit that contained its predecessor without creating a commit just to update its own hash.
6. Continue the next authorized slice in dependency order. A milestone does not require a new chat or owner confirmation. Stop for a user pause, a genuine unresolved business decision, or an external dependency that prevents further useful authorized work.

## Checkpoint and interruption discipline

Update the active checkpoint after each verified milestone, a significant failure or scope correction, and before a deliberate handoff. Save meaningful partial progress during long work rather than waiting for context exhaustion. On an abrupt interruption, inspect Git and current processes first on resume; a checkpoint may lag the files.

Keep the active checkpoint short enough to read in one focused pass. Replace its current-state sections instead of continually prepending old next actions. Move superseded detailed evidence into a dated historical record when useful, preserving evidence references. Never delete unresolved work to shorten the file.

The checkpoint must include current request/status, observed branch and implementation commit, protected files, active slice, incomplete file inventory, completed evidence, open task/acceptance ledger, known failures/external inputs, process/environment state and the next action. Record exact commands for new verification. If inherited history omits a command, label that limitation; do not invent one or retroactively certify it.

New owner corrections must be reflected in the current checkpoint and, where they change business policy, the owning canonical documents before dependent implementation. Explain material policy gaps to the owner. Historical discussion files do not silently become approved scope.

## Preservation and environment boundaries

- Leave `.codex/config.toml` and `docs/product/SIMPLIFICATION_DISCUSSION.md` untouched and outside commits. The latter belongs to separate work and is not an instruction source for this task.
- Preserve unfinished commerce files and inspect them before editing. Do not reset or discard them to simplify a resume.
- `docs/product/IMPLEMENTATION_STATUS.md` has pre-existing encoding damage. Append bytes only if an update is needed; never rewrite the file during this task.
- Only `apps/core/.wrangler/e2e-commerce-alignment-20260907` is identified as disposable. Preserve other local, retained, shared and remote data; follow the canonical schema lifecycle policy.
- Do not overlap Core suites with managed browser stacks or edit source during browser verification. Record active process/session information at handoff when known; verify stale process claims on resume.
- Implementation and push authorization do not establish authorization for unrelated deployments, real payments/refunds/bookings, outbound messages, or destructive environment operations. Use existing authorization where supplied and keep external prerequisites explicit.

## Reusable continuation prompt

```text
Continue FreshMarkets in E:\GithubProjects\freshmarkets. Complete the remaining authorized work in docs/product/COMMERCE_ALIGNMENT_E2E_PLAN.md in dependency order.

Follow AGENTS.md and docs/operations/COMMERCE_ALIGNMENT_CONTINUATION_PLAN.md. Read docs/operations/checkpoints/COMMERCE_ALIGNMENT_EXECUTION.md for the current task ledger, partial edits, evidence and next action. Reconcile that checkpoint with actual Git state and code before editing. Read relevant canonical documents through AGENTS.md; search archived history only for specific missing evidence.

Maintain one active implementation slice with a stable task ID, phase path/title and observable acceptance criteria. Preserve completed work, record newly found gaps under their owning phase, and keep earlier acceptance obligations visible. Distinguish implemented, locally verified, provider accepted and externally blocked work. Update the current checkpoint after meaningful milestones/failures and before handoff; do not accumulate contradictory old next actions or rely on conversation memory.

Leave .codex/config.toml and docs/product/SIMPLIFICATION_DISCUSSION.md untouched and outside commits. Preserve other unrelated changes and unfinished commerce work. Follow the saved database, process and encoding boundaries. Do not use subagents.

Implement and verify coherent slices across the required Core/contracts/storage/Web boundaries. Run checks appropriate to the change and required phase acceptance; record exact commands, results and tested revision/scope. Review each diff, commit only the verified slice directly to main, and push origin main. Continue through authorized slices without routine approval pauses. Flag genuine business-policy or external-input blockers while continuing independent authorized work. Do not invent provider acceptance or deployment authorization.

Start by reporting the reconciled active task and immediate next action, then do the work. At handoff, report completed task IDs, validation, open work at a clearly named counting level, and the checkpoint path.
```
