# Commerce alignment — active checkpoint

Updated: 2026-09-10. This is the **only active commerce checkpoint**. [History](COMMERCE_ALIGNMENT_EXECUTION_HISTORY_20260909.md) contains completed evidence and superseded instructions; consult it only for a specific missing fact. Do not read it as another task list.

## Current task and authority

**CA-7.3 — First-visit location and guest Cart carryover** is the sole active implementation task. Source: [COMMERCE_ALIGNMENT_E2E_PLAN.md](../../product/COMMERCE_ALIGNMENT_E2E_PLAN.md), **Phase 7 — Complete journeys and activation evidence**, and PRODUCT customer journey requirements. CA-7.1 is locally accepted and committed/pushed as e54d0cb3; CA-3.4 was committed/pushed as 9dd13ed1. Earlier acceptance and actual provider obligations remain open.

Acceptance: first visit offers address/pin selection with optional device location and skip for general browsing; no invented default site or local prices/cart before selection. Carry resolved location through home/search/Product/Cart using current Core serviceability. Preserve guest items through sign-in, existing Cart and response-loss/replay cases with honest unavailable-item handling. Preserve paid snapshots and verify both widths through the real Web/Core path. Paid-checkout Cart lifecycle remains an explicit related gap, with intervening edits protected.

All nine owner product decisions and transfer controls are approved. PRODUCT and the guidance audit record their exact meaning; do not reopen them, expand scope or infer policy from memory. The protected discussion stays unchanged.

Owner correction, 2026-09-09: execution was too repetitive and checkpoint history obscured the current task. Batch coherent edits and inspect request/response contracts before costly browser runs. Use focused checks during iteration and the required aggregate at the coherent gate. Avoid unchanged status polling and repeated broad reads. Keep this record concise; replace current state instead of appending competing next actions.

## Git, preservation and processes

- Branch `main`; observed HEAD and origin/main `43f7a7e6`, CA-7.2 committed/pushed. No unfinished application files remain from CA-7.1. CA-7.3 starts from this revision; preserve all excluded owner changes. Preserve all unrelated/protected changes.
- Leave `.codex/config.toml` locally deleted and outside commits. Leave untracked `docs/product/SIMPLIFICATION_DISCUSSION.md` intact/outside commits; recorded SHA256 `0021CDF5935E3B90D2C23EAA5EBA56DA7419EE7CD2E8FA479990E03BC64B792F`.
- Preserve unrelated `.claude`, `.superpowers/sdd` and `docs/superpowers/{plans,prompts,reports,specs}` deletions. READMEs and `apps/web/tests/counted-stock.spec.ts` have shown modified status without a Git content diff; exclude them. `IMPLEMENTATION_STATUS.md` has pre-existing invalid UTF-8; untouched.
- Only disposable DB: `apps/core/.wrangler/e2e-commerce-alignment-20260907`. No other local/shared/retained/remote reset. Explicit UTF-8 writes; no subagents; no deployment, real provider transaction, outbound message or inferred business values.
- Never overlap Core suites and managed browser stacks. Keep application source fixed during browser acceptance. Current process state is recorded with validation below; never overlap its Core gate with a managed browser stack.

## Current implementation and acceptance

CA-7.1 is locally accepted and pushed as e54d0cb3. CA-7.2 is locally accepted and pushed as 43f7a7e6: Product/option names in both existing Cart projections and actual current-price Buy again with existing-quantity preservation and immutable paid Order. Focused Core 8/2, Web typecheck, diff check and desktop/mobile local-provider journeys 2/2 passed. Exact commands, failed assumption, tested scope and screenshots are in the existing history. No provider/deployment acceptance.

CA-7.3 is implemented and locally accepted, pending commit/push. Explicit coordinate selection replaces default-site Cart creation and catalog prices. First-visit skip/remembered location and atomic guest carryover work through real Web/Core commands; existing quantities, current prices, known unavailable items and exact response-loss replay are preserved. Cart summaries hide unknown prices. No migration was needed; owning API/data specifications are updated.

Verified working-tree scope since 43f7a7e6: Core catalog/geography/Cart applications, validation/RPC entrypoints and affected integration fixtures; checkout/common/core-service/geography contracts; Web catalog routes/home, Cart location/merge routes, browsing-location/read-browsing-location/load-cart-for-location helpers and tests, cart-client/tests, Cart page, address dialog, Product price/catalog presentation, checkout auth dialog and OrderSummary; admin-authenticated fixture and first-visit-cart browser journey; owning specifications, this checkpoint and existing history. These intended files remain uncommitted; protected/unrelated changes above stay excluded.

Complete aggregate components passed: static/schema/harness/lint/types, shared suites, contracts 68/19, Web 408/102, Core 1650/198 and both builds. Two native Windows interruptions required the unchanged complete Core suite to run with `--maxWorkers=1 --reporter=verbose`; failures and exact commands are recorded in the CA-7.3 history entry. Six browser journeys passed across desktop/mobile first-visit/carryover, paid Instant and Scheduled checkout/addition/packing/courier/manual-delivery tests. A setup timeout and a native Wrangler helper crash were resolved through explicit targeted reruns; neither failed run was counted as acceptance. Final format check, Web typecheck and diff check passed. Tested scope is the CA-7.3 working tree based on 43f7a7e6. Four new screenshots were inspected. No project test process remains. No actual provider/deployment acceptance.

Related obligations preserved: paid commitment consumes the Quote but leaves the Cart active; CA-7.4 will complete an unchanged paid Cart while preserving intervening edits, paid snapshots and later Cart/reorder behavior. Customer-launch/storefront/Admin mocks with retired membership/default-location expectations still need alignment without restoring retired features. Earlier phase/provider obligations remain below.
## Remaining-task ledger

Counting level: **two major phase blocks (6–7)** remain, plus earlier acceptance and approved product-change obligations. Slice counts/test totals are not completion percentages. Every applicable plan criterion in A–I, audit defects and final journeys must remain assigned; this table is not a claim that each has already been audited.

| ID | State and remaining obligation |
| --- | --- |
| CA-0-2 | Earlier partial acceptance: canonical/retained-baseline reconciliation; no-SQL location/address/serviceability/pickup/cycle setup, onboarding/scoped access and financial recovery. Reuse proven code; recover only specifically missing evidence. |
| CA-7.3 | Local acceptance complete; commit/push pending. Paid-Cart lifecycle remains assigned to CA-7.4. |
| CA-6 | Local delivery milestones verified; actual provider/aggregate-coverage reconciliation remains open: preparation-stage booking, provider-state reconciliation, Scheduled-only manual fallback, packed handover, customer promises, active membership/service-fee removal across UI/Core/jobs with required history retained. Sections E/F/H. |
| CA-7 | Local milestones accepted; approved Problems flow locally accepted. Final customer/operator/setup-to-delivery, manual fallback, failure/recovery, permission and provider acceptance; notifications, support, refunds, reorder and readiness. Sections E/F/I and final journeys. |
| Approved follow-ups | Guidance audit's approved-change table remains open where not explicitly verified: guest cart/customer/address (GD-D01/D21); courier choice/automatic booking/full-order grams/disabled payment methods (D03/D10); five-image gallery (D05, locally accepted CA-3.3); product-sale stacking/percentage/fixed-unit/overlap/allowance/cancellation (D06–07, locally accepted CA-3.4); no general cart minimum (D08); Problems and approved reports (D11/D13); weekly progress (D14); normal Scheduled-to-Instant changeover (D15); actual counts/receiving (D17–18). Existing CA-4/5 evidence closes only its demonstrated portions. |

Exact approved changes: [GUIDANCE_REBUILD_AUDIT.md](../GUIDANCE_REBUILD_AUDIT.md#approved-changes-still-requiring-acceptance). No extra feature is authorized by an old implementation or archived proposal.

## Completed slices — do not restart

Detailed commands, tested revisions, failures subsequently resolved and evidence limits are preserved in the existing history file. These are implementation/local acceptance claims, not actual provider or release acceptance.

| IDs | Result / commit |
| --- | --- |
| CA-7.2 | Cart names/current-price Buy again locally accepted at 43f7a7e6; Core 8/2, Web typecheck and both real local browser widths passed. |
| CA-7.1 | Approved commerce reports locally accepted at e54d0cb3; aggregate plus final focused 45/4, three Admin browser tests and two real local desktop/mobile journeys. Exact evidence in history. |
| CA-3.4 | Selected-item sales/allowance/stacking locally accepted; 9dd13ed1. Aggregate 1639 Core/196, 402 Web/101, 68 contracts/19; final Core 71/4 and both desktop/mobile paid-sale cancellation journeys passed. |
| CA-3.3 | Five-image Add/Edit/replacement/gallery locally accepted; e3d4180a. Aggregate 1635 Core/196, 402 Web/101, 68 contracts/19; focused Core 31/2 and both desktop/mobile galleries passed. |
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

**One next action:** stage the reviewed CA-7.3 files, commit to main and push origin main; then activate CA-7.4 paid-Cart completion under the same Phase 7, preserving earlier acceptance obligations.
