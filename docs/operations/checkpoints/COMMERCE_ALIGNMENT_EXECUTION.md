# Commerce alignment execution

Updated: 2026-09-08 20:25 UTC / 2026-09-09 Asia/Manila.
Status: application implementation paused at owner interruption; continuation planning requested. This checkpoint does not itself resume application work. A subsequent continuation request resumes the authorized scope below.

## Scope and resume source

Complete all remaining workflows in [COMMERCE_ALIGNMENT_E2E_PLAN.md](../../product/COMMERCE_ALIGNMENT_E2E_PLAN.md), in dependency order. Follow [continuation plan](../COMMERCE_ALIGNMENT_CONTINUATION_PLAN.md) and [AGENTS.md](../../../AGENTS.md). Current owner instructions and canonical policy prevail over historical records. No whole commerce phase or real provider acceptance is claimed.

Previous checkpoint content is preserved byte-for-byte in [execution history](COMMERCE_ALIGNMENT_EXECUTION_HISTORY_20260909.md). Its old pauses and next actions are superseded by this current-state record. Read targeted historical sections only when needed.

## Observed workspace and preservation

- Branch: `main`. Last observed implementation HEAD and local `origin/main`: `012b5db0e6ca7355f821658c7308bf25eae59e6d`, `feat(promotions): author controlled campaign audiences`. This is the last pushed implementation slice; a later documentation commit may be the current HEAD. Inspect Git on resume.
- User-owned modified `.codex/config.toml` and untracked `docs/product/SIMPLIFICATION_DISCUSSION.md`: leave untouched, do not stage, do not adopt the discussion as scope.
- `docs/product/IMPLEMENTATION_STATUS.md`: pre-existing invalid UTF-8 elsewhere; append bytes only if needed.
- Only disposable database state: `apps/core/.wrangler/e2e-commerce-alignment-20260907`. No retained/shared/remote database was reset or upgraded. No migration 0086 was applied during this task.
- Prior application checks/stacks finished; no running application test process is recorded. Recheck processes before testing. Never overlap Core suites and managed browser stacks; keep source fixed during browser acceptance.
- No actual PayMongo/Lalamove/OAuth/email acceptance, real provider action or deployment was performed. No subagents are authorized.

## Active slice: CA-3.1 campaign media lifecycle and publication

Owning phase: `docs/product/COMMERCE_ALIGNMENT_E2E_PLAN.md`, Phase 3 - Catalog, images, promotions and pricing; section B and Phase 3 exit criteria.
Implementation: **in progress**. Acceptance: **not verified**. User-visible goal: Global staff uploads/previews/replaces/removes a campaign image through normal controls, and eligible-for-publication campaign content appears anonymously without a frontend rebuild. Checkout remains the authority for customer benefit eligibility.

Uncommitted implementation files already present before the planning request:

- `apps/core/migrations/0086_promotion_media.sql`: proposed media/upload/cleanup tables, not applied.
- `apps/core/src/admin/application/promotion-media-storage.ts`: initial durable upload, conditional R2 storage, unknown-outcome recovery and cleanup helpers.
- `apps/core/src/admin/application/promotion-media.ts`: initial upload/update/remove command implementation.
- `packages/contracts/src/promotion-media.ts` and export in `packages/contracts/src/index.ts`.
- `packages/validation/src/promotion-media.ts` and export in `packages/validation/src/index.ts`.

These are scaffolding, not a reachable feature. Only Core typechecking and formatting were reported before interruption; no Worker/browser/media migration acceptance exists for this slice. Do not claim older promotion tests cover these files.

Proposed implementation uses the existing PRODUCT_MEDIA R2 bucket with a promotions object namespace and independent media versions. This design needs review against canonical ownership and existing product-media patterns before it is accepted; campaign image changes must not rewrite financial benefit authority. Storage recovery stays internal, with ordinary operator CRUD.

Remaining slice work:

1. Review existing partial command/storage code against product-media ownership, full-transaction guards, stable retries, ambiguous R2/D1 outcomes and bounded cleanup. Resolve orphaned or abandoned upload paths, including authorization/owner-state changes during upload.
2. Complete purpose-built Admin/public read models and publication checks; wire service interface, RPC manifest/entry points, same-origin Web routes and internal cleanup scheduling.
3. Add normal campaign image controls and public campaign rendering with loading/error/empty/permission behavior. Recheck publication on content reads; customer-specific promotion eligibility still comes from checkout. Any membership UI removal touched here must be recorded against CA-6, whose wider retirement work remains open.
4. Complete canonical contract/data documentation and migration consistency as needed. Prove clean creation and the supported retained upgrade path without modifying retained environments.
5. Execute meaningful Worker/D1/R2 failure/replay/race/scope tests and actual Admin-to-anonymous-storefront browser upload/replace/remove/deactivate journeys. Verify applicable contracts/Web/types/lint/build/binding checks and review the final diff before commit.

Concrete next action on implementation resume: reconcile this inventory with current Git, review `promotion-media.ts` and `promotion-media-storage.ts` alongside existing product-media command/recovery/publication/cleanup modules, and identify the missing guards/wiring before changing code. Run the focused source-plan coverage check and register any blocking earlier-phase prerequisites; do not restart completed catalog work.

## Open task and acceptance ledger

Five major phase blocks remain (Phases 3-7), plus earlier-phase acceptance obligations. The rows below are tracking units, not a complete count of small implementation tasks. Split future phase rows into stable child IDs after inspecting their actual call paths; retain the parent and all source-plan criteria.

| ID | Source and coverage | Implementation / acceptance | Exit or next decomposition |
| --- | --- | --- | --- |
| CA-0-2 | Phases 0-2; sections A, E, F, relevant audit defects | Substantial existing work / partial evidence | Reconcile canonical and retained-baseline decisions; verify no-SQL site/address/serviceability/pickup/cycle setup, onboarding/scoped access and financial recovery. Register concrete missing evidence; fix any prerequisite before dependent work. Real account/provider inputs remain explicit. |
| CA-3.1 | Phase 3, section B: campaign media | In progress / not verified | Complete active slice above. |
| CA-3.2 | Phase 3, sections B-C and promotion application in F | Implemented portions / partially verified | Check complete catalog/category/variant/product-media/publication/Global-price/local-activation/promotion authoring-to-checkout acceptance. Reuse existing evidence by revision; close actual gaps and phase gates. |
| CA-4 | Phase 4, section D | Pending completion / not verified | Initial physical stock receipt, Global dispatch, tracked transit, destination-authorized accepted receipt, discrepancies/losses/returns, ledger conservation and races; reachable operator journey. Inspect existing code before decomposition. |
| CA-5 | Phase 5, section G | Existing primitives / not verified as a journey | Cutoff exact paid demand, paid additions, purchase confirmation, receiving and cycle allocation, shortage resolution, picking/packing, inspected surplus; separate from Instant inventory. |
| CA-6 | Phase 6, sections E/F/H | Partial existing behavior / not verified as a phase | Preparation-stage Lalamove booking/state reconciliation, Scheduled-only manual fallback, packed handover, customer promises, full active membership/service-fee alignment across UI/Core/jobs while preserving required history. |
| CA-7 | Phase 7, sections E/F/I and final acceptance section 6 | Pending completion / not verified | Both customer modes, operator setup-to-delivery, manual fallback, failure/recovery and permission journeys; notifications, support, refunds, reorder, provider sandbox and activation readiness. Account, business-policy and operational inputs tracked separately. |

Coverage rule: every applicable criterion in source-plan sections A-I, audit defects and final journeys must have an owning row/child and evidence or an explicit open gap before completion. The broad mapping above is not proof that a criterion was individually audited. Existing historical implementation is reused where sound; no earlier phase is silently accepted or dropped.

## Verified implementation anchors

These are inherited evidence summaries for the named slices. Detailed historical commands/logs remain in the archived checkpoint and referenced artifacts; missing command provenance must be recovered before relying on an acceptance claim. They are not checks executed during continuation planning.

| Commit | Verified scope and evidence limits |
| --- | --- |
| `b8e32b2` | Cancellation/paid acceptance and complete catalog/variant/price/local activation transactions. Aggregate then passed; focused real Worker/D1 and selected browser journeys. Full commerce/provider acceptance remained open. |
| `f7f17dc` | Guarded normal variant editing; 22 focused Core tests, 2 Web editor tests, desktop/mobile browser journeys. |
| `d14de2c` | Promotion create/edit/status/grant complete effects and original retries; 25 Core tests and 5 browser journeys, affected Web/contracts/static/build checks. |
| `762a18e` | Retired membership eligibility removed from active promotion evaluation; retained unsupported conditions fail closed, reachable no-subscription Instant quote; 52 focused tests. Wider membership UI/jobs remain unfinished. |
| `f6f8c88` | Five canonical promotion benefits, caps/limits, shared integer preview calculation and retained migration 0085. Last full `pnpm check`: Core 1433/187 files, Web 398/99, contracts 68/19, shared/harness/migrations/lint/types/builds passed. Subsequent focused benefit/browser checks are recorded in history. This aggregate predates later preview/audience/media changes. |
| `e50ef9a` | Named customer selection, customer-aware eligibility preview and guarded grants. 66 focused Core tests, Web 400/100, contracts 68/19, static checks/builds and 9 browser journeys. |
| `012b5db` | Five controlled audience types, Global read/write RPCs, normal draft editor, strict checkout parsing, atomic replacement/receipt and named references. 99 Core tests across 7 files, then 13 audience tests after added privacy/local-scope coverage; Web 400/100, contracts 68/19, static checks/builds/bindings and 9 zero-retry browser journeys. Counts overlap and must not be added. No schema change in this slice. |

Other already implemented setup/category/product/R2 and financial repairs are recorded in history; their absence from this compact table is not a request to rebuild them.

Evidence directory: `C:/Users/reggi/.codex/visualizations/2026/09/08/01a0822b-3c98-76a1-8c9e-a2d5e223a182`. Relevant log prefixes: `commerce-`, `catalog-variants-`, `variant-editor-`, `promotion-`, `promotion-benefits-`, `promotion-preview-`, `promotion-audience-`. Browser screenshots were inspected for the recorded slices. Local test-provider evidence is not provider sandbox acceptance.

## External inputs and handoff rules

Continuation-planning verification (documentation scope): `pnpm naming:check`, `pnpm harness:test` (26 passed), and `git diff --check` passed. Local links in this checkpoint and the continuation plan resolve. SHA-256 comparison confirms all nine pre-existing dirty files unchanged; the old checkpoint was archived byte-for-byte before replacement. No application suite was rerun for this documentation change. Commit/push status must be read from Git on resume.

Actual provider/account activation and credentials, operational addresses/service boundaries/hours/staffed promises, real catalog/prices, support/accounting/retention policy and any needed outbound/provider-operation authorization remain factual inputs, never invented values. Formal irreversible anonymization and official accounting remain policy-dependent under the source plan.

On resume and after each meaningful milestone, update this current record in place with the active ID, observed Git/files, exact new verification commands/results/revision, unresolved risks and next action. Preserve useful old evidence in history. Commit only intended verified work to main and push origin main; inspect actual push outcome. No broad application work was implemented or revalidated by creating the continuation plan.
