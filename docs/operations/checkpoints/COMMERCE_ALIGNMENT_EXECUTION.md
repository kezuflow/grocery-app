# Commerce alignment execution

Updated: 2026-09-08 20:55 UTC / 2026-09-09 Asia/Manila.
Status: implementation active. CA-3.1 committed/pushed as `27889d4`; CA-3.2a locally verified; CA-3.2b evidence audit next. No whole phase or provider acceptance is claimed.

## Scope and resume source

Complete all remaining workflows in [COMMERCE_ALIGNMENT_E2E_PLAN.md](../../product/COMMERCE_ALIGNMENT_E2E_PLAN.md), in dependency order. Follow [continuation plan](../COMMERCE_ALIGNMENT_CONTINUATION_PLAN.md) and [AGENTS.md](../../../AGENTS.md). Current owner instructions and canonical policy prevail over historical records. No whole commerce phase or real provider acceptance is claimed.

Previous checkpoint content is preserved byte-for-byte in [execution history](COMMERCE_ALIGNMENT_EXECUTION_HISTORY_20260909.md). Its old pauses and next actions are superseded by this current-state record. Read targeted historical sections only when needed.

## Observed workspace and preservation

- Branch: `main`. Last confirmed pushed implementation HEAD: `27889d4`, `feat(promotions): publish managed campaign images`. CA-3.2a is the only intended uncommitted application slice at this milestone. Initial resume HEAD was `0b55737`; its partial media scaffold was preserved and completed.
- User-owned modified `.codex/config.toml` and untracked `docs/product/SIMPLIFICATION_DISCUSSION.md`: leave untouched, do not stage, do not adopt the discussion as scope.
- `docs/product/IMPLEMENTATION_STATUS.md`: pre-existing invalid UTF-8 elsewhere; append bytes only if needed.
- Only disposable database state: `apps/core/.wrangler/e2e-commerce-alignment-20260907`. No retained/shared/remote database was reset or upgraded. Migration 0086 was applied only to isolated test databases and the designated disposable browser state.
- Prior application checks/stacks finished; no running application test process is recorded. Recheck processes before testing. Never overlap Core suites and managed browser stacks; keep source fixed during browser acceptance.
- No actual PayMongo/Lalamove/OAuth/email acceptance, real provider action or deployment was performed. No subagents are authorized.

## Active slice: CA-3.2b promotion authoring-to-quote browser acceptance

Owning phase: `docs/product/COMMERCE_ALIGNMENT_E2E_PLAN.md`, Phase 3 — Catalog, images, promotions and pricing; section B and promotion application in F, within parent CA-3.2.

Implementation/evidence audit: next. Observable acceptance: an Admin-authored/activated campaign reaches a customer cart and real Core Quote through Web, displaying Core's discount/total and preserving eligibility/stacking. Test-only provider adapters are local evidence, not provider sandbox acceptance. Reuse existing workflows; repair only reproduced gaps. Keep remaining catalog/category/Global-price/local-activation/phase-gate obligations under parent CA-3.2.

Reconciliation: `customer-checkout-promotions.spec.ts` uses browser response mocks and proves presentation only. Existing `instant-quote.integration.test.ts` already contains `uses a saved Admin audience when producing a real Instant quote` through Admin RPC -> real createCheckoutQuote, with seeded basket/readiness and test provider. Preserve this evidence; the missing layer is browser-to-real-Core acceptance, not another promotion evaluator. Immediate next action: inspect existing customer address/cart, location readiness and cycle test setup to compose one real Web journey; map any missing prerequisites to their owning phase. No CA-3.2b source edits yet.

## Completed in this continuation: CA-3.2a

Product missing-object retry and abandoned confirmed-object cleanup repaired in `product-media-recovery.ts`; no schema/RPC/UI change or new abstraction. Stable immutable object keys and create-only R2 conditions protect retries; confirmed unattached uploads expire internally after 24 hours. Canonical Architecture recovery description updated.

- Reproduction: `pnpm --filter @freshmarkets/core exec vitest run --config vitest.config.ts src/admin/application/product-media-recovery.integration.test.ts`: 2 failed/13 passed (missing-object retry and authority-revoked cleanup).
- After repair: `pnpm --filter @freshmarkets/core exec vitest run --config vitest.config.ts src/admin/application/product-media-recovery.integration.test.ts src/admin/application/promotion-media.integration.test.ts`: 27 passed/2 files. `pnpm typecheck` and `pnpm lint` passed.
- `$env:E2E_START_STACK='1'; $env:E2E_STATE_NAME='e2e-commerce-alignment-20260907'; pnpm --filter @freshmarkets/web exec playwright test tests/product-media-recovery.spec.ts --retries=0`: 2 passed in 2.0 minutes (desktop/mobile native upload lost-response replay, price/local activation, cart/public image, removal and stale ETag rejection), including managed build and disposable migration setup. Screenshots copied under `C:/Users/reggi/.codex/visualizations/2026/09/08/01a082ba-d1a3-7ce3-985b-99ed446e7347/commerce-product-recovery`.
- Tested working tree: based on `27889d4`, only recovery implementation/test plus canonical Architecture/checkpoint changes. Source remained fixed during browser tests and no Core suite overlapped. No test stack remains running. Final naming/format/diff review and commit/push are next for this slice.

## Completed in this continuation: CA-3.1

Campaign media is reachable through ordinary Global Admin controls and anonymous storefront rendering. Added migration 0086 attachment/upload/cleanup storage, typed contracts and validators, seven Core RPC methods, guarded upload/update/remove commands, Admin/public reads, scheduled internal observation/cleanup, same-origin media adapters, image editor and Core-fed home campaign rail. Images have independent versions; financial definitions/history stay unchanged. Home membership strip and bundled membership campaign removal is partial CA-6 retirement; wider membership work remains open.

Local evidence against the intended working tree based on `0b55737` (these are actual commands, not discovery):

- `pnpm --filter @freshmarkets/core exec vitest run --config vitest.config.ts src/admin/application/promotion-media.integration.test.ts src/entrypoint/core-service-conformance.test.ts`: 15 passed/2 files (12 media, 3 conformance), including opening/end boundary, original replay, unknown/failed R2 writes, authority loss, cleanup retry and attachment races/rollback.
- `pnpm --filter @freshmarkets/web test`: 403 passed/101 files; `pnpm --filter @freshmarkets/contracts test`: 68 passed/19 files. After final layout changes, `pnpm --filter @freshmarkets/web exec vitest run --config vitest.config.ts components/storefront/marketplace/promo-banners.test.tsx test/app/api/admin/published-promotion-media.test.ts`: 4 passed/2 files.
- `$env:E2E_START_STACK='1'; $env:E2E_STATE_NAME='e2e-commerce-alignment-20260907'; pnpm --filter @freshmarkets/web exec playwright test tests/promotion-media.spec.ts tests/admin-promotions.spec.ts --retries=0`: 11 passed in 2.7 minutes, including desktop/mobile Admin upload/replace/remove and anonymous publication/deactivation; managed build and migration setup passed. Earlier media-only run: 2 passed; layout review then moved the editor out of Audience and replaced the transparent fixture with visible existing artwork. Final screenshots inspected and copied to `C:/Users/reggi/.codex/visualizations/2026/09/08/01a082ba-d1a3-7ce3-985b-99ed446e7347/commerce-campaign-media`.
- `pnpm migration:check` passed, including the added populated 0085-to-0086 all-row/row-identity preservation probe. `pnpm harness:test`: 26 passed.
- `pnpm typecheck`, `pnpm lint`, `pnpm architecture:check`, `pnpm readiness:check`, `pnpm naming:check`, `pnpm format:check`, `git diff --check`, Core `build` (dry run), Web `check:vinext` passed. Last full aggregate remains the inherited f6f8c88-era check; no whole Phase 3 completion is claimed.
- Corrected test fixture initially caused 7 campaign tests to fail on lowercase codes; subsequent runs passed. Initial Windows-default decoding of the home page failed before writing that file; explicit UTF-8 retry succeeded. Final format check caught three new media routes; directory-level formatting corrected them and the recheck passed. None of these failures remains active.

No application suite/browser stack is running at this milestone. Only the designated disposable E2E state received migration 0086; no retained/shared/remote DB or deployment was changed. Protected files remain outside the intended commit. All CA-3.1 implementation files are ready to stage together; no adjacent commerce partial edits remain outside that slice. Git confirmed CA-3.1 commit `27889d4` and successful `git push origin main` (`0b55737..27889d4`).

## Open task and acceptance ledger

Five major phase blocks remain (Phases 3-7), plus earlier-phase acceptance obligations. The rows below are tracking units, not a complete count of small implementation tasks. Split future phase rows into stable child IDs after inspecting their actual call paths; retain the parent and all source-plan criteria.

| ID | Source and coverage | Implementation / acceptance | Exit or next decomposition |
| --- | --- | --- | --- |
| CA-0-2 | Phases 0-2; sections A, E, F, relevant audit defects | Substantial existing work / partial evidence | Reconcile canonical and retained-baseline decisions; verify no-SQL site/address/serviceability/pickup/cycle setup, onboarding/scoped access and financial recovery. Register concrete missing evidence; fix any prerequisite before dependent work. Real account/provider inputs remain explicit. |
| CA-3.1 | Phase 3, section B: campaign media | Implemented / locally verified | Evidence above; no real provider/deployment acceptance implied. |
| CA-3.2a | Child of CA-3.2, section B: product upload recovery | Implemented / locally verified | Evidence above; pending final commit/push. |
| CA-3.2b | Child of CA-3.2, sections B/F: authored promotion to real Quote | Active / browser acceptance missing | Existing Core journey is implemented; browser test currently mocks Core responses. |
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
