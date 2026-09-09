# FreshMarkets Agent Instructions

## Authority and reading route

Follow the current owner request. Read this router, the active checkpoint, and only the guide/reference sections needed for the affected behavior. Do not restart completed work from an old report or load all archived plans by default.

The active guidance has five owners:

| Guide | Owns |
| --- | --- |
| [AGENTS.md](AGENTS.md) | Task execution, authority and reading route. |
| [PRODUCT.md](docs/product/PRODUCT.md) | Business meaning, approved decisions, exclusions and unresolved policy details. |
| [ARCHITECTURE.md](docs/architecture/ARCHITECTURE.md) | Two-Worker architecture, context ownership, trust boundaries and runtime integrations. |
| [ENGINEERING.md](docs/architecture/ENGINEERING.md) | Coding, transactions/recovery, security, schema lifecycle, naming, verification and Git. |
| [DESIGN.md](docs/design/DESIGN.md) | Admin and marketplace presentation, components, accessibility and reference use. |

Focused technical specifications remain authoritative for their subjects: [API_CONTRACTS.md](docs/architecture/API_CONTRACTS.md) for Web/Core/provider semantics, [STATE_MACHINES.md](docs/architecture/STATE_MACHINES.md) for transitions, and [DATA_MODEL.md](docs/architecture/DATA_MODEL.md) for persisted facts and integrity. Read the affected sections when changing those boundaries; shared contracts never import storage types. Operational runbooks are used for the particular environment/provider operation, not as a second product policy.

The protected [Simplification Discussion](docs/product/SIMPLIFICATION_DISCUSSION.md) is the owner's record of agreed product decisions. PRODUCT maps its approved changes and subsequent owner supplements against the technical baseline. Preserve the distinction between agreement, authorization to implement, and actual acceptance. Apply the owner's explicit follow-up approvals recorded in PRODUCT; other proposals and unprovided operational values are not approved rules. Source records, supersessions and preserved requirements are indexed in [the guidance audit](docs/operations/GUIDANCE_REBUILD_AUDIT.md); archives, old phase reports, READMEs, migration history and redirect stubs do not add active authority.

## Start, execute and recover

1. Resolve the requested outcome, active plan **path and phase title**, stable task ID and observable acceptance criteria. Inspect branch/HEAD, status, tracked/untracked changes and the actual caller-to-write path before editing. Compare the checkpoint with code and evidence; preserve unrelated and unfinished work.
2. For commerce continuation, use [COMMERCE_ALIGNMENT_E2E_PLAN.md](docs/product/COMMERCE_ALIGNMENT_E2E_PLAN.md), [the continuation boundaries](docs/operations/COMMERCE_ALIGNMENT_CONTINUATION_PLAN.md) and [the active checkpoint](docs/operations/checkpoints/COMMERCE_ALIGNMENT_EXECUTION.md). Earlier acceptance gaps remain open even when a later slice passes. One implementation slice is active; continue authorized slices in dependency order without routine approval pauses. Do not use subagents for this task.
3. Complete the smallest cohesive change across the required Core/contracts/storage/Web boundaries. Justify abstractions and operator steps against concrete requirements. Follow UI -> application command/query -> domain policy -> repository/integration. Core owns all business writes and current authorization/scope; Web renders typed decisions. Do not create another business authority or an operational recovery panel for ordinary CRUD.
4. Revalidate mutable prerequisites and the complete transaction, including distinct per-effect identities, ledger/audit/outbox and immutable success receipt. A zero-row D1 update does not abort a batch. Rejected commands leave no partial business effects or success result. Provider timeouts are unknown outcomes; durable intent, deduplication and bounded recovery remain internal safeguards.
5. Select checks by risk in ENGINEERING. Phase completion requires the aggregate plus relevant executed Worker/D1/browser/provider acceptance. Do not weaken checks, swallow errors, introduce fake success, or claim application behavior from documentation, mocks or discovery. A passing local fake is not actual provider acceptance.
6. Review each diff, stage only verified intended work, commit directly to `main`, and run `git push origin main`. No feature branches/PRs unless explicitly requested; worktrees only protect local state. Commit/push authority does not authorize deployment, real provider transactions, outbound messages or destructive data operations.

Use current session model/settings choices. Do not change personal settings or delegate without explicit authorization. Resolve ordinary implementation choices independently; identify material business-policy or external-input blockers while continuing independent authorized work.

## Checkpoint and completion evidence

Update the one active checkpoint after meaningful milestones, failures and owner corrections, and before handoff. Replace stale current-state/next-action text; preserve useful old evidence in history. Record:

- request, active ID, exact plan path/phase and acceptance criteria;
- observed branch/HEAD, relevant partial files and preservation/environment boundaries;
- implemented behavior separately from local, browser and actual provider acceptance;
- exact verification commands/results and tested revision or working-tree scope;
- unresolved obligations/blockers and one concrete next action.

Never store credentials, bearer URLs, customer contacts/addresses or raw provider payloads in checkpoints or logs. Use the redacting telemetry boundary. A checkpoint preserves evidence and work, not new authority. At completion report changes, actual checks/limits, completed task IDs and remaining work at a named counting level. Update the owning specifications when an approved rule or interface changes; do not maintain duplicate policy in historical plans.
