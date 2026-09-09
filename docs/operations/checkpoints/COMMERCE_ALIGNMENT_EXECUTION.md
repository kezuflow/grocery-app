# Commerce alignment — active checkpoint

Updated: 2026-09-09. This is the **only active commerce checkpoint**. [History](COMMERCE_ALIGNMENT_EXECUTION_HISTORY_20260909.md) contains completed evidence and superseded instructions; consult it only for a specific missing fact. Do not read it as another task list.

## Current task and authority

**CA-3.3 — GD-D05 five-image Product flow** is the sole active implementation task. Source: [COMMERCE_ALIGNMENT_E2E_PLAN.md](../../product/COMMERCE_ALIGNMENT_E2E_PLAN.md), **Phase 3 — Catalog, images, promotions and pricing**, and PRODUCT GD-D05. This newly approved follow-up preserves completed CA-3.1/3.2 evidence. CA-7 dashboard notifications are locally verified and committed/pushed as 64c2e66d; Phase 7 and earlier acceptance gaps remain open.

Acceptance: Core limits each Product to five active images, replacement keeps the previous photo until the new image is safely attached, Add/Edit Product supports preview/add/replace/remove/main/order, and customer detail/quick view shows the available gallery. Preserve upload replay, publication checks, atomic audit/receipt and internal cleanup. Verify rejection/races/replacement recovery and a connected desktop/mobile image journey.

All nine owner product decisions and transfer controls are approved. PRODUCT and the guidance audit record their exact meaning; do not reopen them, expand scope or infer policy from memory. The protected discussion stays unchanged.

Owner correction, 2026-09-09: execution was too repetitive and checkpoint history obscured the current task. Batch coherent edits and inspect request/response contracts before costly browser runs. Use focused checks during iteration and the required aggregate at the coherent gate. Avoid unchanged status polling and repeated broad reads. Keep this record concise; replace current state instead of appending competing next actions.

## Git, preservation and processes

- Branch `main`; observed HEAD `64c2e66d`, dashboard notifications committed/pushed. CA-3.3 draft spans Core product-media commands/RPC, catalog detail read, shared contracts, Product Add/Edit/detail image components, upload HTTP adapter, customer gallery and media tests. Preserve all unrelated/protected changes.
- Leave `.codex/config.toml` locally deleted and outside commits. Leave untracked `docs/product/SIMPLIFICATION_DISCUSSION.md` intact/outside commits; recorded SHA256 `0021CDF5935E3B90D2C23EAA5EBA56DA7419EE7CD2E8FA479990E03BC64B792F`.
- Preserve unrelated `.claude`, `.superpowers/sdd` and `docs/superpowers/{plans,prompts,reports,specs}` deletions. READMEs and `apps/web/tests/counted-stock.spec.ts` have shown modified status without a Git content diff; exclude them. `IMPLEMENTATION_STATUS.md` has pre-existing invalid UTF-8; untouched.
- Only disposable DB: `apps/core/.wrangler/e2e-commerce-alignment-20260907`. No other local/shared/retained/remote reset. Explicit UTF-8 writes; no subagents; no deployment, real provider transaction, outbound message or inferred business values.
- Never overlap Core suites and managed browser stacks. Keep application source fixed during browser acceptance. Current process state is recorded with validation below; never overlap its Core gate with a managed browser stack.

## Current implementation and acceptance

**CA-3.3 verified scope on 64c2e66d:** shared max-five bound, optional replacement on the existing upload intent, atomic old-image deactivation/new attachment/cleanup/audit/receipt, shared Add/Edit image controls and detail/quick-view gallery. No schema migration or new recovery surface. New components are shared by the two existing admin and two customer surfaces.

Validation on 64c2e66d plus the listed CA-3.3 draft: `pnpm check` session 67087 exit 0, ca33-check.log, **1635 Core/196 files, 402 Web/101, 68 contracts/19**, shared/harness/migration/static gates and both builds passed. Final review preserved NOT_FOUND before capacity validation and the unsaved Product-details version across image refreshes. Final `pnpm --filter @freshmarkets/core exec vitest run --config vitest.config.ts src/admin/application/product-media-recovery.integration.test.ts src/catalog/service.integration.test.ts` passed **31/2**, session 31958 exit 0, ca33-final-core.log. Includes cleanup-effect suppression rollback and competing fifth-slot writes, exact replacement replay, storage uncertainty and publication checks. Final workspace types/lint/changed-source formatting pass.

Initial media failures are resolved: RPC validator initially stripped replacement identity; shared fixtures accumulated images; cleanup sweep counted another retained scenario. The RPC field is preserved, scenarios clear prior fixture images through normal removal commands, and cleanup asserts the target identity. No application success was faked. Browser `E2E_START_STACK=1 E2E_PROVIDER_GATEWAY=1 E2E_STATE_NAME=e2e-commerce-alignment-20260907 pnpm --filter @freshmarkets/web exec playwright test tests/product-media-recovery.spec.ts --retries=0 --max-failures=1` passed in session 69925 (exit 0, two desktop/mobile journeys, 2.7 minutes), ca33-media-browser.log. Final test-only extension waits for all refreshed admin previews and exercises quick view: session 34208 exit 0, two desktop/mobile journeys in 2.6 minutes, ca33-media-browser-final.log. Source stayed fixed during both runs; no Core suite overlapped. Final screenshots inspected/copied as ca33-{published-product-image,product-image-controls,quick-view-gallery}-{1440,390}.png in the evidence root. A final UI-only mutual-disable guard prevents other Product commands interrupting a pending image intent; workspace types/lint/format/architecture passed afterward. No process remains. Browser covers Add Product previews/limit, saved five-image capacity, lost response replay, Edit replacement/main/order/removal and customer gallery/publication. No provider acceptance claimed.
Problems (78685870), transactional delivery notifications (a567adfd), dashboard notifications (64c2e66d) and previous CA-6 local journey evidence are in the existing history. These milestones do not close actual provider or remaining Phase 7 acceptance.

## Remaining-task ledger

Counting level: **two major phase blocks (6–7)** remain, plus earlier acceptance and approved product-change obligations. Slice counts/test totals are not completion percentages. Every applicable plan criterion in A–I, audit defects and final journeys must remain assigned; this table is not a claim that each has already been audited.

| ID | State and remaining obligation |
| --- | --- |
| CA-0-2 | Earlier partial acceptance: canonical/retained-baseline reconciliation; no-SQL location/address/serviceability/pickup/cycle setup, onboarding/scoped access and financial recovery. Reuse proven code; recover only specifically missing evidence. |
| CA-3.3 | Active GD-D05 follow-up under Phase 3: five-image Add/Edit/replacement/gallery locally verified; ready to commit. |
| CA-6 | Local delivery milestones verified; actual provider/aggregate-coverage reconciliation remains open: preparation-stage booking, provider-state reconciliation, Scheduled-only manual fallback, packed handover, customer promises, active membership/service-fee removal across UI/Core/jobs with required history retained. Sections E/F/H. |
| CA-7 | Local milestones accepted; approved Problems flow locally accepted. Final customer/operator/setup-to-delivery, manual fallback, failure/recovery, permission and provider acceptance; notifications, support, refunds, reorder and readiness. Sections E/F/I and final journeys. |
| Approved follow-ups | Guidance audit's approved-change table remains open where not explicitly verified: guest cart/customer/address (GD-D01/D21); courier choice/automatic booking/full-order grams/disabled payment methods (D03/D10); five-image gallery (D05); product-sale stacking/percentage/fixed-unit/overlap/allowance/cancellation (D06–07); no general cart minimum (D08); Problems and approved reports (D11/D13); weekly progress (D14); normal Scheduled-to-Instant changeover (D15); actual counts/receiving (D17–18). Existing CA-4/5 evidence closes only its demonstrated portions. |

Exact approved changes: [GUIDANCE_REBUILD_AUDIT.md](../GUIDANCE_REBUILD_AUDIT.md#approved-changes-still-requiring-acceptance). No extra feature is authorized by an old implementation or archived proposal.

## Completed slices — do not restart

Detailed commands, tested revisions, failures subsequently resolved and evidence limits are preserved in the existing history file. These are implementation/local acceptance claims, not actual provider or release acceptance.

| IDs | Result / commit |
| --- | --- |
| CA-5, CA-5.9 | Section G local acceptance completed through CA-5.1–5.9; final connected customer journey and aggregate pushed as `9138860b`. Provider/delivery and newer approved product obligations remain open above. |
| GD-1 | Guidance consolidation and approved decisions; pushed `83854bd`. |
| CA-3.1, CA-3.2, CA-3.2a, CA-3.2b, CA-3.2c, CA-3.2d | Phase 3 local gate completed; final aggregate and 28-browser matrix at `0d14da0`, evidence `ab276df`. Children include `60f348d`, `092a0ad`, `0d14da0`. New owner-approved product changes above remain separate obligations. |
| CA-4, CA-4.1, CA-4.2, CA-4.3 | Stock/transfers/discrepancies/counts locally verified; CA-4.2 `406a405`, CA-4.3 `010b8af2`. |
| CA-5.1 | Delivery-week workspace and exact purchase: `e6afa560`. |
| CA-5.2 | Shortage/replacement receiving: `2f11e609`. |
| CA-5.3 | Scheduled receipt weight and actual size counts: `61d1299b`. |
| CA-5.4 | Inspected surplus: `c0e7ed7c`. |
| CA-5.5 | Late-payment purchase readiness: `bad66079`. |
| CA-5.6 | Consolidated destination purchase totals: `49d75d3a`. |
| CA-5.7 | Shortage-linked Order review/cancellation: `75e2105b`. |
| CA-5.8 | Audited supplier-exception resolution after cancellation: `19f409a1`. Aggregate **1577 Core/194 files, 403 Web/101, 68 contracts/19**, shared/harness/migrations/static checks/both builds; 2 browser journeys; vinext 15 supported/0 issues. Original browser financial state was synthetic, so it does not close CA-5.9. |

Older implementation anchors `b8e32b2`, `f7f17dc`, `d14de2c`, `762a18e`, `f6f8c88`, `e50ef9a`, `012b5db` and their evidence remain in history. Their absence from active instructions is not permission to rebuild them.

## External blockers and one next action

Actual provider/account activation, factual pickup addresses/service boundaries/hours/staffed promises, catalog/prices, accounting facts and live-provider/outbound authorization remain release inputs. Existing local provider credentials are not authorization for real effects. Local implementation uses sample configuration. No current business decision blocks independent implementation. Official accounting and irreversible anonymization remain policy-dependent. Records are retained indefinitely; paid Instant items/quantities cannot change.

**One next action:** commit/push verified CA-3.3, then activate CA-3.4 under the same Phase 3 title for approved GD-D06–07 product sales and revised grocery-code stacking. Confirmed current gap: promotions/domain/checkout-promotion.ts evaluates whole-subtotal benefits; selected-item/quantity allowance behavior is absent. Trace checkout quote claims, paid Order redemption, stock depletion and cancellation release before editing. CA-7 support/refund/reorder/reports/readiness and earlier ledger obligations remain open. No current business decision blocks this work.
