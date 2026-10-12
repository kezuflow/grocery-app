# FreshMarkets Agent Instructions

## Authority and reading route

Follow the current owner request. Read this router, the active checkpoint, and only the guide/reference sections needed for the affected behavior. Do not restart completed work from an old report or load all archived plans by default.

The active guidance has five owners:

| Guide | Owns |
| --- | --- |
| [AGENTS.md](AGENTS.md) | Task execution, authority and reading route. |
| [PRODUCT.md](docs/product/PRODUCT.md) | Business meaning, approved decisions, exclusions and unresolved policy details. |
| [ARCHITECTURE.md](docs/architecture/ARCHITECTURE.md) | Web/Core and Mobile API architecture, context ownership, trust boundaries and runtime integrations. |
| [ENGINEERING.md](docs/architecture/ENGINEERING.md) | Coding, transactions/recovery, security, schema lifecycle, naming, verification and Git. |
| [DESIGN.md](docs/design/DESIGN.md) | Admin and marketplace presentation, components, accessibility and reference use. |

Focused technical specifications remain authoritative for their subjects: [API_CONTRACTS.md](docs/architecture/API_CONTRACTS.md) for Web/Core/provider semantics, [STATE_MACHINES.md](docs/architecture/STATE_MACHINES.md) for transitions, and [DATA_MODEL.md](docs/architecture/DATA_MODEL.md) for persisted facts and integrity. Read the affected sections when changing those boundaries; shared contracts never import storage types. Operational runbooks are used for the particular environment/provider operation, not as a second product policy.

The protected [Simplification Discussion](docs/product/SIMPLIFICATION_DISCUSSION.md) is the owner's record of agreed product decisions. PRODUCT maps its approved changes and subsequent owner supplements against the technical baseline. Preserve the distinction between agreement, authorization to implement, and actual acceptance. Apply the owner's explicit follow-up approvals recorded in PRODUCT; other proposals and unprovided operational values are not approved rules. Source records, supersessions and preserved requirements are indexed in [Product source provenance](docs/product/PRODUCT.md#source-provenance); archives, old phase reports, READMEs, migration history and redirect stubs do not add active authority.

## Start, execute and recover

1. Resolve the requested outcome, active checkpoint **path and phase title**, stable task ID and observable acceptance criteria. Inspect branch/HEAD, status, tracked/untracked changes and the actual caller-to-write path before editing. Compare the checkpoint with code and evidence; preserve unrelated and unfinished work.
2. For commerce continuation, use [the active checkpoint](docs/operations/checkpoints/COMMERCE_ALIGNMENT_EXECUTION.md), [commerce acceptance coverage](docs/architecture/ENGINEERING.md#commerce-acceptance-coverage) and the affected owning specifications. Retired plans remain commit-pinned provenance, never another current execution route. Earlier acceptance gaps remain open even when a later slice passes. One implementation slice is active; continue authorized slices in dependency order without routine approval pauses. Scoped subagents and independent review are authorized under the pstack workflow. Isolate concurrent writers and preserve one acceptance owner.
3. Complete the smallest cohesive change across the required Core/contracts/storage/Web boundaries. Justify abstractions and operator steps against concrete requirements. Follow UI -> application command/query -> domain policy -> repository/integration. Core owns all business writes and current authorization/scope; Web renders typed decisions. Do not create another business authority or an operational recovery panel for ordinary CRUD.
4. Revalidate mutable prerequisites and the complete transaction, including distinct per-effect identities, ledger/audit/outbox and immutable success receipt. A zero-row D1 update does not abort a batch. Rejected commands leave no partial business effects or success result. Provider timeouts are unknown outcomes; durable intent, deduplication and bounded recovery remain internal safeguards.
5. Select checks by risk in ENGINEERING. Phase completion requires the aggregate plus relevant executed Worker/D1/browser/provider acceptance. Do not weaken checks, swallow errors, introduce fake success, or claim application behavior from documentation, mocks or discovery. A passing local fake is not actual provider acceptance.
6. Review each diff, stage only verified intended work, commit on a `codex/` branch, push that branch and open a ready PR. Follow the matched pstack PR or stack playbook and obtain independent review before reporting readiness. Merge or direct-main delivery requires explicit owner authorization. Prefer a suitable current checkout; use worktrees to isolate concurrent or unrelated work. Commit/push/PR authority does not authorize deployment, real provider transactions, outbound messages or destructive data operations.

Use current session model/settings choices, including for subagents and reviewers. Do not change personal settings. Resolve ordinary implementation choices independently; identify material business-policy or external-input blockers while continuing independent authorized work.

## Project skills

Owner request, 2026-10-11: use [Poteto mode](.agents/skills/poteto-mode/SKILL.md) as the default workflow for repository tasks that require investigation, implementation, review or verification. Read its matched playbook and the routed skills needed for the task. Keep completed work and the active checkpoint in view. Casual conversation does not require a playbook.

The installed pstack collection includes its supporting principles and verification skill generators. Use the existing [ENGINEERING verification requirements](docs/architecture/ENGINEERING.md#choose-checks-by-risk), repository commands and browser harness as the project verification source. Skill installation is not evidence that an application or provider check passed. Generate a project verification skill only when the requested work needs one; verify its instructions against the actual app before claiming completion.

Owner correction, 2026-10-12: pstack PR delivery is the default for all repository work, with subagents and independent review enabled. This supersedes the direct-main and no-delegation rules. Apply the matched upstream workflows within this router's authority, keeping current session models/settings rather than upstream model defaults. Run repository verification gates as well as the playbook's evidence checks. Scheduled audits require an owner scheduling request. Deployment, provider transactions, outbound messages and destructive operations retain their existing authorization boundaries. Read only this workspace's session history if a routed skill needs it.

Use [verify-freshmarkets](.agents/skills/verify-freshmarkets/SKILL.md) for repeatable local Web/Core user journeys and retained proof. Its native gate remains unavailable until the Expo foundation extends and proves it. The [mobile PR plan](docs/operations/MOBILE_PR_PLAN.md) defines future implementation work; a planning PR does not start that queue.

Use [good-css](.agents/skills/good-css/SKILL.md) for relevant CSS and Tailwind work, reading only the affected references. [DESIGN](docs/design/DESIGN.md#design-skills) owns its use alongside the Admin shadcn skill and the approved visual standards. Installation sources and pinned revisions are recorded in [skill sources](.agents/skills/SOURCES.md).

## Admin-only shadcn skill

Use the project-local `shadcn-admin` skill for Admin dashboard presentation work in `apps/web/app/admin` and `apps/web/components/admin`. For new or touched Admin components, use the upstream shadcn defaults for the configured Radix/new-york setup as the visual and component baseline; do not copy the existing FreshMarkets customizations as the default. Preserve required behavior. Run shadcn discovery and component commands from `apps/web`, where `components.json` lives. Inspect their intended file changes before accepting them: shared `apps/web/components/ui` primitives and `apps/web/app/globals.css` can affect both Admin and Storefront. Keep Admin-only styling beneath `.fm-admin` and verify Storefront remains unchanged. Do not use this skill to redesign or generate Storefront pages or to change Storefront tokens, layout, or behavior.

Owner follow-up, 2026-09-27: the owner explicitly authorizes an Admin-wide stock shadcn visual reset across `apps/web/app/admin` and `apps/web/components/admin`. Apply stock shadcn fonts, typography, spacing utilities, colors, radii, surfaces, component sizes and states wherever the primitives fit. This supersedes the earlier limit against a bulk migration for this Admin-only reset. Preserve routes, navigation structure, data, actions, permissions, workflows, and business logic. Do not change Storefront or authentication UI, behavior, or tokens.

## Checkpoint and completion evidence

Update the one active checkpoint after meaningful milestones, failures and owner corrections, and before handoff. Replace stale current-state/next-action text; preserve useful old evidence with commit-pinned Git references. Record:

- request, active ID, exact checkpoint path/phase and acceptance owner and acceptance criteria;
- observed branch/HEAD, relevant partial files and preservation/environment boundaries;
- implemented behavior separately from local, browser and actual provider acceptance;
- exact verification commands/results and tested revision or working-tree scope;
- unresolved obligations/blockers and one concrete next action.

Never store credentials, bearer URLs, customer contacts/addresses or raw provider payloads in checkpoints or logs. Use the redacting telemetry boundary. A checkpoint preserves evidence and work, not new authority. At completion report changes, actual checks/limits, completed task IDs and remaining work at a named counting level. Update the owning specifications when an approved rule or interface changes; do not maintain duplicate policy in historical plans.
