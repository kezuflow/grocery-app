# Commerce alignment — active checkpoint

Updated: 2026-09-10. This is the **only active commerce checkpoint**. [History](COMMERCE_ALIGNMENT_EXECUTION_HISTORY_20260909.md) contains completed evidence and superseded instructions; consult it only for a specific missing fact. Do not read it as another task list.

## Current task and authority

**CA-7.7 — Saved-address create/edit transaction and exact-retry safeguards** is the sole active implementation task. Source: [COMMERCE_ALIGNMENT_E2E_PLAN.md](../../product/COMMERCE_ALIGNMENT_E2E_PLAN.md), **Phase 7 — Complete journeys and activation evidence**, section E and ENGINEERING transaction requirements.

Acceptance: create/edit rechecks current customer/principal and reviewed address version after permanent-provider latency, then atomically commits the address, required audit and immutable command receipt. Rejected writes leave no partial address/audit/success. A stable key replays the original result before another provider lookup and cannot be reused with another body. Web retains its exact unconfirmed body/key; retry does not create another address or alter newer edits. No history/paid snapshots are rewritten. Verify Worker/D1 races/effect suppression/replay and real desktop/mobile address flows. Account recovery/closure, obsolete membership browser coverage and earlier phase/provider acceptance remain open.
All nine owner product decisions and transfer controls are approved. PRODUCT and the guidance audit record their exact meaning; do not reopen them, expand scope or infer policy from memory. The protected discussion stays unchanged.

Owner correction, 2026-09-09: execution was too repetitive and checkpoint history obscured the current task. Batch coherent edits and inspect request/response contracts before costly browser runs. Use focused checks during iteration and the required aggregate at the coherent gate. Avoid unchanged status polling and repeated broad reads. Keep this record concise; replace current state instead of appending competing next actions.

## Git, preservation and processes

- Branch `main`; observed HEAD and origin/main `99e97b96`, CA-7.6 committed/pushed. CA-7.7 starts from this revision. Preserve all excluded owner changes.
- Leave `.codex/config.toml` locally deleted and outside commits. Leave untracked `docs/product/SIMPLIFICATION_DISCUSSION.md` intact/outside commits; recorded SHA256 `0021CDF5935E3B90D2C23EAA5EBA56DA7419EE7CD2E8FA479990E03BC64B792F`.
- Preserve unrelated `.claude`, `.superpowers/sdd` and `docs/superpowers/{plans,prompts,reports,specs}` deletions. READMEs and `apps/web/tests/counted-stock.spec.ts` have shown modified status without a Git content diff; exclude them. `IMPLEMENTATION_STATUS.md` has pre-existing invalid UTF-8; untouched.
- Only disposable DB: `apps/core/.wrangler/e2e-commerce-alignment-20260907`. No other local/shared/retained/remote reset. Explicit UTF-8 writes; no subagents; no deployment, real provider transaction, outbound message or inferred business values.
- Never overlap Core suites and managed browser stacks. Keep application source fixed during browser acceptance. Current process state is recorded with validation below; never overlap its Core gate with a managed browser stack.

## Current implementation and acceptance

CA-7.1 is locally accepted and pushed as e54d0cb3. CA-7.2 is locally accepted and pushed as 43f7a7e6: Product/option names in both existing Cart projections and actual current-price Buy again with existing-quantity preservation and immutable paid Order. Focused Core 8/2, Web typecheck, diff check and desktop/mobile local-provider journeys 2/2 passed. Exact commands, failed assumption, tested scope and screenshots are in the existing history. No provider/deployment acceptance.

CA-7.3 is committed/pushed as 701b587d. Complete aggregate components passed (Core 1650/198, Web 408/102, contracts 68/19, shared/static/schema/harness and both builds), followed by six local browser journeys across both widths. Exact commands, interrupted runs, final reruns and screenshots are recorded in the CA-7.3 entry of the existing history. Actual provider/deployment acceptance remains open.

CA-7.4 is committed/pushed as c435d720. Complete aggregate (1660 Core/198, 408 Web/102, 68 contracts/19 and all other components), final focused Core 64/3, and four desktop/mobile Instant/Scheduled journeys passed. Exact commands/scope/failures/screenshots are in its existing history entry. No process remains. CA-7.5 committed/pushed as 9decade6. Core 74/5, final Web 35/4, contracts 68/19, types, required runtime/static checks, both builds, vinext and both first-visit/confirmation/carryover browser journeys passed. Exact evidence and test-harness corrections are in the CA-7.5 history entry. No process remains. CA-7.6 committed/pushed as 99e97b96. Migration checks, Core 133/4 plus final permission 112/2, Web 25/3, contracts 68/19, types/static/runtime checks, both builds and two real account/address browser journeys passed. Final verification scope is recorded in its history entry. No process remains. CA-7.7 is locally verified on the working tree based on 99e97b96; commit/push follows.

CA-7.7 implemented and locally verified: 41 Core tests/4 files, 26 Web/3, 68 contracts/19, type/static/runtime checks, both builds and desktop/mobile actual address create/edit lost-response replay (2/2) passed. No schema change. Every required address/audit/receipt effect rolls back together; disabled-access and newer-edit races are covered. Web retains the exact unconfirmed command. Exact commands and working-tree scope are in its history entry. No process remains; actual provider acceptance is unchanged.

Earlier obligations preserved: actual permanent-geocoding account/storage acceptance and the eligibility of retained pre-fix provider-derived records remain external; no existing saved records were rewritten. CA-7.6 delivered name/account phone/default address/deactivation; address create/edit safeguards remain CA-7.7. Account recovery/closure and customer-launch/storefront/Admin mocks with retired membership/default-location expectations still need acceptance. Earlier phase/provider obligations remain below.
## Remaining-task ledger

Counting level: **two major phase blocks (6–7)** remain, plus earlier acceptance and approved product-change obligations. Slice counts/test totals are not completion percentages. Every applicable plan criterion in A–I, audit defects and final journeys must remain assigned; this table is not a claim that each has already been audited.

| ID | State and remaining obligation |
| --- | --- |
| CA-0-2 | Earlier partial acceptance: canonical/retained-baseline reconciliation; no-SQL location/address/serviceability/pickup/cycle setup, onboarding/scoped access and financial recovery. Reuse proven code; recover only specifically missing evidence. |
| CA-7.7 | Active: saved-address create/edit current-access, atomic audit/receipt and exact retry. |
| CA-6 | Local delivery milestones verified; actual provider/aggregate-coverage reconciliation remains open: preparation-stage booking, provider-state reconciliation, Scheduled-only manual fallback, packed handover, customer promises, active membership/service-fee removal across UI/Core/jobs with required history retained. Sections E/F/H. |
| CA-7 | Local milestones accepted; approved Problems flow locally accepted. Final customer/operator/setup-to-delivery, manual fallback, failure/recovery, permission and provider acceptance; notifications, support, refunds, reorder and readiness. Sections E/F/I and final journeys. |
| Approved follow-ups | Guidance audit's approved-change table remains open where not explicitly verified: guest cart/customer/address (GD-D01/D21); courier choice/automatic booking/full-order grams/disabled payment methods (D03/D10); five-image gallery (D05, locally accepted CA-3.3); product-sale stacking/percentage/fixed-unit/overlap/allowance/cancellation (D06–07, locally accepted CA-3.4); no general cart minimum (D08); Problems and approved reports (D11/D13); weekly progress (D14); normal Scheduled-to-Instant changeover (D15); actual counts/receiving (D17–18). Existing CA-4/5 evidence closes only its demonstrated portions. |

Exact approved changes: [GUIDANCE_REBUILD_AUDIT.md](../GUIDANCE_REBUILD_AUDIT.md#approved-changes-still-requiring-acceptance). No extra feature is authorized by an old implementation or archived proposal.

## Completed slices — do not restart

Detailed commands, tested revisions, failures subsequently resolved and evidence limits are preserved in the existing history file. These are implementation/local acceptance claims, not actual provider or release acceptance.

| IDs | Result / commit |
| --- | --- |
| CA-7.6 | Account name/phone/default address/removal locally accepted at 99e97b96. Schema/133 Core/25 Web/68 contracts, final 112 Core, runtime checks/builds and both browser widths; older create/edit gap assigned CA-7.7. |
| CA-7.5 | Permanent browsing confirmation locally accepted at 9decade6; Core 74/5, Web 35/4, contracts 68/19, runtime checks/builds/vinext and both browser widths. Closes local CA-7.3 retention gap; actual provider acceptance remains open. |
| CA-7.4 | Paid-Cart lifecycle locally accepted at c435d720; aggregate, 64/3 focused Core and four browser journeys passed. |
| CA-7.3 | First-visit location/guest carryover locally verified at 701b587d; aggregate and six browser journeys passed. Provider-result retention implementation corrected and locally accepted in CA-7.5; actual provider acceptance remains open. |
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

**One next action:** commit/push verified CA-7.7, then reconcile customer recovery/closure and obsolete journey expectations against the approved account flow. Earlier obligations remain assigned.
