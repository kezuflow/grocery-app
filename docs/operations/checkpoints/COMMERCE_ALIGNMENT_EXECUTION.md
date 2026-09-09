# Commerce alignment — active checkpoint

Updated: 2026-09-09. This is the **only active commerce checkpoint**. [History](COMMERCE_ALIGNMENT_EXECUTION_HISTORY_20260909.md) contains completed evidence and superseded instructions; consult it only for a specific missing fact. Do not read it as another task list.

## Current task and authority

**CA-6 — Delivery and customer alignment** is the sole active implementation task. Source: [COMMERCE_ALIGNMENT_E2E_PLAN.md](../../product/COMMERCE_ALIGNMENT_E2E_PLAN.md), **Phase 6 — Delivery and customer alignment**, sections E/F/H, its policy-enforcement acceptance additions and the corresponding approved Product decisions. Follow [AGENTS.md](../../../AGENTS.md) and [continuation boundaries](../COMMERCE_ALIGNMENT_CONTINUATION_PLAN.md).

Acceptance: coordinated preparation locks Instant cancellation; checked items plus final packing automatically request the selected available courier for Instant; Scheduled future booking uses received/checked goods and credible readiness. Provider search/assignment/pickup remain independent of packing; handover requires packed goods. Scheduled-only manual assignment/handover/completion/failure must be authorized, versioned, replay-safe and mutually exclusive with active/unknown external attempts. Preserve accepted charges, record actual cost honestly, enforce full-order/addition weight at most 20,000 g without packaging inputs, and remove retired active membership/service-fee behavior while retaining required history. Prove direct-RPC rejection, no partial effects, concurrent/replayed/unknown outcomes and reachable Web journeys. Actual provider acceptance and activation are separate external gates.
All nine owner product decisions and transfer controls are approved. PRODUCT and the guidance audit record their exact meaning; do not reopen them, expand scope or infer policy from memory. The protected discussion stays unchanged.

Owner correction, 2026-09-09: execution was too repetitive and checkpoint history obscured the current task. Batch coherent edits and inspect request/response contracts before costly browser runs. Use focused checks during iteration and the required aggregate at the coherent gate. Avoid unchanged status polling and repeated broad reads. Keep this record concise; replace current state instead of appending competing next actions.

## Git, preservation and processes

- Branch `main`; CA-5.9 committed/pushed as `9138860b`, `feat(orders): complete scheduled addition journey` (`19f409a1..9138860b`). CA-6 application edits are uncommitted and not accepted. The existing checkpoint/history rollover and CA-6 specification changes remain uncommitted; include intended documentation with the next verified slice.
- Leave `.codex/config.toml` locally deleted and outside commits. Leave untracked `docs/product/SIMPLIFICATION_DISCUSSION.md` intact/outside commits; recorded SHA256 `0021CDF5935E3B90D2C23EAA5EBA56DA7419EE7CD2E8FA479990E03BC64B792F`.
- Preserve unrelated `.claude`, `.superpowers/sdd` and `docs/superpowers/{plans,prompts,reports,specs}` deletions. READMEs and `apps/web/tests/counted-stock.spec.ts` have shown modified status without a Git content diff; exclude them. `IMPLEMENTATION_STATUS.md` has pre-existing invalid UTF-8; untouched.
- Only disposable DB: `apps/core/.wrangler/e2e-commerce-alignment-20260907`. No other local/shared/retained/remote reset. Explicit UTF-8 writes; no subagents; no deployment, real provider transaction, outbound message or inferred business values.
- Never overlap Core suites and managed browser stacks. Keep application source fixed during browser acceptance. CA-5.9 browser session 12084 and aggregate session 84645 both exited 0; no task-owned verification remains active.

## Reconciled implementation and verification

CA-5.9 is complete locally: named Customer-owned addition choices, safe saved-request retries, actual checkout/test-provider commitment/addition/cancellation through purchasing/receiving/packing. No migration. Final `pnpm check` passed: Core 1579 tests/194 files, Web 403/101, contracts 68/19, shared suites, harness, migrations, static checks and both builds. `pnpm --filter @freshmarkets/web check:vinext`: 15 supported/0 issues. Managed desktop/mobile test: 2 passed, including duplicate signed mock events, lost-reply replay, canceled-demand exclusion and unchanged physical stock. These are local fake-provider results, not actual PayMongo/Lalamove acceptance. Exact commands, source scope, failures resolved and evidence filenames are in the existing history's **CA-5.9 final local acceptance — 9138860b** section.

CA-6 draft now separates the existing booking construction into Delivery's `book-order-delivery.ts`, reused by staff authorization and `book-automatic-instant-deliveries.ts`. Instant readiness is checked before admission and at the dispatch insert. Both fulfillment RPCs await automatic booking after packing starts; the minute scheduler retries eligible work left before submission. Packing/job facts are the durable first-booking intent; no new table/operator step. Existing submitted/unknown/closed attempts are never automatically replaced. Only currently authorized Lalamove is accepted by this automatic path. Web explains automatic booking instead of showing the first-booking button for Instant.

Create responses now save provider identity and a normalized inbox observation in one guarded D1 batch, then use the same projection as refresh/webhooks. ALLOCATING leaves the job unassigned; premature pickup is retained for reconciliation, never fabricated packing. A missing evidence insert rolls back local identity and prevents blind resubmission.

Uncommitted application files: `apps/core/src/delivery/application/{request-provider-delivery.ts,request-provider-delivery.integration.test.ts,book-order-delivery.ts,book-automatic-instant-deliveries.ts}`; `apps/core/src/admin/application/delivery-provider-operations{,.integration.test}.ts`; `apps/core/src/{index.ts,entrypoint/operations-rpc.ts}`; `apps/core/src/scheduling/{types.ts,job-registry.ts,run-scheduled-jobs.ts,jobs/instant-delivery-booking.ts}`; `apps/web/components/admin/delivery/external-delivery-queue.tsx`. No migration or contract change yet. Existing checkpoint/history rollover remains uncommitted; unrelated changes stay excluded.

Verification on `9138860b` plus this draft: `pnpm typecheck`, `pnpm lint`, `pnpm architecture:check`, `pnpm naming:check` passed. Focused command `pnpm --filter @freshmarkets/core exec vitest run --config vitest.config.ts src/delivery/application/request-provider-delivery.integration.test.ts src/admin/application/delivery-provider-operations.integration.test.ts src/scheduling/run-scheduled-jobs.integration.test.ts` passed **24 tests / 3 files**, session 92745 exit 0, `ca6-booking-focused.log`. Initial failures were corrected test assumptions: Instant fixture used Scheduled dates; create evidence adds an inbox/version step; the shared booking now supplies its observation clock. `pnpm --filter @freshmarkets/web test` passed **403 / 101**, `ca6-web-tests.log`. All logs use the CA-5.9 evidence root. No CA-6 aggregate or actual provider acceptance yet.

The read contract now includes nullable `externalDispatch.providerStatus`, mapped through `list-delivery-dispatch.ts` / `operations-reads.ts` to show Finding rider. These two files, `packages/contracts/src/admin-operations.ts`, `docs/architecture/API_CONTRACTS.md`, and new `apps/web/tests/instant-auto-booking.spec.ts` are also intended uncommitted files. This extends the file list above. No schema change.

Browser evidence: session 87472 and final pre-atomic-tail session 23947 both exited 0, **2 desktop/mobile journeys passed / 2.1 minutes** each. Command: `E2E_START_STACK=1 E2E_PROVIDER_GATEWAY=1 E2E_STATE_NAME=e2e-commerce-alignment-20260907 pnpm --filter @freshmarkets/web exec playwright test tests/instant-auto-booking.spec.ts --retries=0 --max-failures=1`; logs `ca6-instant-browser.log` / `ca6-instant-browser-final.log`. Screenshots inspected: desktop shows Finding rider; mobile uses the existing horizontally scrollable table. No actual provider acceptance.

Final review hardened admission permission revalidation and pending-command recovery, then placed the owning command receipt/audit into the same guarded batch as provider identity/inbox evidence. No extra persistence table was added. Final focused command `pnpm --filter @freshmarkets/core exec vitest run --config vitest.config.ts src/admin/application/delivery-provider-operations.integration.test.ts src/delivery/application/request-provider-delivery.integration.test.ts` passed **19 tests / 2 files**, `ca6-atomic-booking.log`. Includes omitted-audit/evidence rollback, retained unknown outcome, revoked permission, interrupted PENDING submission and concurrent replay with one provider call/receipt/audit. The earlier broader affected command `pnpm --filter @freshmarkets/core exec vitest run --config vitest.config.ts src/delivery src/operations/application src/admin/application/delivery-provider-operations.integration.test.ts src/entrypoint/core-service-conformance.test.ts src/scheduling/run-scheduled-jobs.integration.test.ts` passed **78 / 15**, `ca6-affected-core.log`, before final receipt hardening. Contracts **68 / 19**, both builds, vinext **15 supported / 0 issues**, static checks and protected Discussion hash passed. New final source still requires aggregate/final browser result; no completion claim from older evidence.

Final aggregate: `pnpm check` **passed**, session 34363 exit 0, `ca6-booking-check.log`: **1586 Core tests / 194 files, 403 Web / 101, 68 contracts / 19**, shared/harness/migration/static checks and both builds. Scope is `9138860b` plus the complete first-booking draft, including atomic command receipt/audit. No application edits since this gate began.

Final managed browser **passed**, session 46217 exit 0, **2 journeys / 2.1 minutes**, same Instant command above, log `ca6-instant-browser-atomic.log`. Core suite exited before this browser stack; application source matches the passed aggregate. No verification process remains active. The reviewed 20-file first-booking milestone is ready to commit/push. This is a CA-6 milestone, not Phase 6 completion. For the next work, inspection confirmed manual fields already exist in `delivery_provider_dispatch` (method, reason/name/phone, handover/completion, actual cost); no new table is needed. Commands and UI remain absent. Scheduled readiness/manual safeguards still require implementation and acceptance.
## Remaining-task ledger

Counting level: **two major phase blocks (6–7)** remain, plus earlier acceptance and approved product-change obligations. Slice counts/test totals are not completion percentages. Every applicable plan criterion in A–I, audit defects and final journeys must remain assigned; this table is not a claim that each has already been audited.

| ID | State and remaining obligation |
| --- | --- |
| CA-0-2 | Earlier partial acceptance: canonical/retained-baseline reconciliation; no-SQL location/address/serviceability/pickup/cycle setup, onboarding/scoped access and financial recovery. Reuse proven code; recover only specifically missing evidence. |
| CA-6 | Active; partial implementation: preparation-stage booking, provider-state reconciliation, Scheduled-only manual fallback, packed handover, customer promises, active membership/service-fee removal across UI/Core/jobs with required history retained. Sections E/F/H. |
| CA-7 | Final customer/operator/setup-to-delivery, manual fallback, failure/recovery, permission and provider acceptance; notifications, support, refunds, reorder and readiness. Sections E/F/I and final journeys. |
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

## External blockers and next action

Actual provider/account activation and credentials, operational addresses/boundaries/hours/staffed promises, real catalog/prices, accounting/retention facts and any required real-provider/outbound authorization remain external inputs. Do not invent them; continue independent authorized implementation. Official accounting and irreversible anonymization remain policy-dependent. No active implementation is blocked merely by these release inputs.

**One next action:** commit/push the reviewed and verified first-booking milestone; then implement Scheduled received-goods readiness and the manual assignment/handover/completion/failure flow using the existing attempt table and scoped queue. Keep CA-6 active and preserve every remaining obligation above.
