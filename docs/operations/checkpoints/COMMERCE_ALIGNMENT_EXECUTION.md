# Commerce alignment — active checkpoint

Updated: 2026-09-10. This is the **only active commerce checkpoint**. [History](COMMERCE_ALIGNMENT_EXECUTION_HISTORY_20260909.md) contains completed evidence and superseded instructions; consult it only for a specific missing fact. Do not read it as another task list.

## Current task and authority

**CA-7.2 — Customer Cart and reorder journeys** is the sole active implementation task. Source: [COMMERCE_ALIGNMENT_E2E_PLAN.md](../../product/COMMERCE_ALIGNMENT_E2E_PLAN.md), **Phase 7 — Complete journeys and activation evidence**, and PRODUCT customer journey requirements. CA-7.1 is locally accepted in this commit; CA-3.4 was committed/pushed as 9dd13ed1. Earlier acceptance and actual provider obligations remain open.

Acceptance: Cart and Buy again identify the Product and selling option. Reordering uses current price/availability, requires address and fulfillment review, preserves the paid Order, and remains ownership/version/idempotency guarded. Verify Core and real desktop/mobile customer journeys; retain other Phase 7 obligations.

All nine owner product decisions and transfer controls are approved. PRODUCT and the guidance audit record their exact meaning; do not reopen them, expand scope or infer policy from memory. The protected discussion stays unchanged.

Owner correction, 2026-09-09: execution was too repetitive and checkpoint history obscured the current task. Batch coherent edits and inspect request/response contracts before costly browser runs. Use focused checks during iteration and the required aggregate at the coherent gate. Avoid unchanged status polling and repeated broad reads. Keep this record concise; replace current state instead of appending competing next actions.

## Git, preservation and processes

- Branch `main`; observed HEAD and origin/main `9dd13ed17cb72498cd215e8a989cdbc5e286e230`, CA-3.4 committed/pushed. No unfinished application files remain from CA-3.4. CA-7.1 starts from this revision; preserve all excluded owner changes. Preserve all unrelated/protected changes.
- Leave `.codex/config.toml` locally deleted and outside commits. Leave untracked `docs/product/SIMPLIFICATION_DISCUSSION.md` intact/outside commits; recorded SHA256 `0021CDF5935E3B90D2C23EAA5EBA56DA7419EE7CD2E8FA479990E03BC64B792F`.
- Preserve unrelated `.claude`, `.superpowers/sdd` and `docs/superpowers/{plans,prompts,reports,specs}` deletions. READMEs and `apps/web/tests/counted-stock.spec.ts` have shown modified status without a Git content diff; exclude them. `IMPLEMENTATION_STATUS.md` has pre-existing invalid UTF-8; untouched.
- Only disposable DB: `apps/core/.wrangler/e2e-commerce-alignment-20260907`. No other local/shared/retained/remote reset. Explicit UTF-8 writes; no subagents; no deployment, real provider transaction, outbound message or inferred business values.
- Never overlap Core suites and managed browser stacks. Keep application source fixed during browser acceptance. Current process state is recorded with validation below; never overlap its Core gate with a managed browser stack.

## Current implementation and acceptance

CA-7.1 is locally accepted in this commit: 15 approved versioned reports across Core/storage/contracts/Web, first-success refund dates without invented backfill, historical financial facts/definitions retained, scoped Product selection and explicit timezone/currency. API/data specifications updated. The final signed local-provider journey confirms cancellation/refund replay and reconciles the report totals.

Validation on working tree based on 9dd13ed1: `pnpm check` passed (1644 Core / 197 files; 402 Web / 101; 68 contracts / 19; shared packages, migrations, static checks and both builds). A subsequent Global historical-money correction passed the four-file focused Core command (45 tests), whole-workspace typecheck and migration checks. Three Admin report browser tests passed; final actual local Worker/D1 desktop/mobile journeys passed 2/2 (session 18663). Final Web typecheck passed. Exact commands, failures, tested scope and log/screenshot paths are in the existing history's CA-7.1 section. No process is running. No actual provider or deployment acceptance.

CA-7.2 preflight found Cart and reorder projections in `apps/core/src/checkout/application/cart.ts` return only the option name. Existing Product joins support including the Product name without new contracts or storage. Existing Buy again already revalidates price/availability, requires address/fulfillment review and keeps historical Orders immutable. No CA-7.2 application edits yet. Next verify current-price reorder through the real customer UI and preserve existing controlled-skip/replay/ownership tests.

## Remaining-task ledger

Counting level: **two major phase blocks (6–7)** remain, plus earlier acceptance and approved product-change obligations. Slice counts/test totals are not completion percentages. Every applicable plan criterion in A–I, audit defects and final journeys must remain assigned; this table is not a claim that each has already been audited.

| ID | State and remaining obligation |
| --- | --- |
| CA-0-2 | Earlier partial acceptance: canonical/retained-baseline reconciliation; no-SQL location/address/serviceability/pickup/cycle setup, onboarding/scoped access and financial recovery. Reuse proven code; recover only specifically missing evidence. |
| CA-7.2 | Active: Cart Product names and current-price Buy again customer journey. |
| CA-6 | Local delivery milestones verified; actual provider/aggregate-coverage reconciliation remains open: preparation-stage booking, provider-state reconciliation, Scheduled-only manual fallback, packed handover, customer promises, active membership/service-fee removal across UI/Core/jobs with required history retained. Sections E/F/H. |
| CA-7 | Local milestones accepted; approved Problems flow locally accepted. Final customer/operator/setup-to-delivery, manual fallback, failure/recovery, permission and provider acceptance; notifications, support, refunds, reorder and readiness. Sections E/F/I and final journeys. |
| Approved follow-ups | Guidance audit's approved-change table remains open where not explicitly verified: guest cart/customer/address (GD-D01/D21); courier choice/automatic booking/full-order grams/disabled payment methods (D03/D10); five-image gallery (D05, locally accepted CA-3.3); product-sale stacking/percentage/fixed-unit/overlap/allowance/cancellation (D06–07, locally accepted CA-3.4); no general cart minimum (D08); Problems and approved reports (D11/D13); weekly progress (D14); normal Scheduled-to-Instant changeover (D15); actual counts/receiving (D17–18). Existing CA-4/5 evidence closes only its demonstrated portions. |

Exact approved changes: [GUIDANCE_REBUILD_AUDIT.md](../GUIDANCE_REBUILD_AUDIT.md#approved-changes-still-requiring-acceptance). No extra feature is authorized by an old implementation or archived proposal.

## Completed slices — do not restart

Detailed commands, tested revisions, failures subsequently resolved and evidence limits are preserved in the existing history file. These are implementation/local acceptance claims, not actual provider or release acceptance.

| IDs | Result / commit |
| --- | --- |
| CA-7.1 | Approved commerce reports locally accepted in this commit; aggregate plus final focused 45/4, three Admin browser tests and two real local desktop/mobile journeys. Exact evidence in history. |
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

**One next action:** commit/push the verified CA-7.1 files, then implement the two Cart name projections and verify Buy again at current prices as CA-7.2. Preserve earlier Phase 6–7/CA-0–2 gaps. No business decision currently blocks this work.
