# Commerce alignment — active checkpoint

Updated: 2026-09-09. This is the **only active commerce checkpoint**. [History](COMMERCE_ALIGNMENT_EXECUTION_HISTORY_20260909.md) contains completed evidence and superseded instructions; consult it only for a specific missing fact. Do not read it as another task list.

## Current task and authority

**CA-5.9 — Full Scheduled customer journey** is the sole active implementation slice. Source: [COMMERCE_ALIGNMENT_E2E_PLAN.md](../../product/COMMERCE_ALIGNMENT_E2E_PLAN.md), **Phase 5 — Scheduled operations**, section G and the Scheduled portion of final acceptance. Follow [AGENTS.md](../../../AGENTS.md) and [continuation boundaries](../COMMERCE_ALIGNMENT_CONTINUATION_PLAN.md).

Acceptance: from the clean designated local stack plus auth/IAM fixtures, configure prerequisites through actual commands; use real customer checkout, test-provider confirmation, a paid addition and eligible cancellation; reach the actual cutoff; purchase exactly the remaining paid demand; receive cycle goods and pack through Web/Core. No SQL fabricates Quote, payment, Order, demand, purchase, receiving or packing state. Preserve Instant stock, exact replay and earlier race/rollback obligations. Named addition choices must be usable by customers. Test-provider evidence never establishes actual provider acceptance. Delivery execution remains Phase 6/final acceptance.

All nine owner product decisions and transfer controls are approved. PRODUCT and the guidance audit record their exact meaning; do not reopen them, expand scope or infer policy from memory. The protected discussion stays unchanged.

Owner correction, 2026-09-09: execution was too repetitive and checkpoint history obscured the current task. Batch coherent edits and inspect request/response contracts before costly browser runs. Use focused checks during iteration and the required aggregate at the coherent gate. Avoid unchanged status polling and repeated broad reads. Keep this record concise; replace current state instead of appending competing next actions.

## Git, preservation and processes

- Branch `main`; last verified pushed commit `19f409a1`, `fix(procurement): resolve supplier issues after cancellation` (`75e2105b..19f409a1`). CA-5.9 is locally verified and ready for its reviewed commit/push; actual provider acceptance remains open.
- Leave `.codex/config.toml` locally deleted and outside commits. Leave untracked `docs/product/SIMPLIFICATION_DISCUSSION.md` intact/outside commits; recorded SHA256 `0021CDF5935E3B90D2C23EAA5EBA56DA7419EE7CD2E8FA479990E03BC64B792F`.
- Preserve unrelated `.claude`, `.superpowers/sdd` and `docs/superpowers/{plans,prompts,reports,specs}` deletions. READMEs and `apps/web/tests/counted-stock.spec.ts` have shown modified status without a Git content diff; exclude them. `IMPLEMENTATION_STATUS.md` has pre-existing invalid UTF-8; untouched.
- Only disposable DB: `apps/core/.wrangler/e2e-commerce-alignment-20260907`. No other local/shared/retained/remote reset. Explicit UTF-8 writes; no subagents; no deployment, real provider transaction, outbound message or inferred business values.
- Never overlap Core suites and managed browser stacks. Keep application source fixed during browser acceptance. Browser attempt five exited successfully (session 12084 exit 0). No Core/browser overlap. Only the stale Web-unit expectation, generated-declaration formatting and documentation changed afterward; application source is unchanged. Aggregate session 84645 exited 0; no managed browser or Core suite remains active for this slice.

## Implemented draft and unfinished files

CA-5.9 adds a Customer-owned, bounded named addition search using the Order's saved location/currency and current positive exact-location prices. The existing addition write still owns final eligibility and pricing. Web validates responses, shows names and separate totals, and retains the same body/key after uncertain draft or payment replies. No migration or new business write.

Test infrastructure adds an opt-in local ingress forwarding Web requests and Core's existing verified mock webhook. A Core E2E-only entrypoint invokes the real registered minute/15-minute scheduler jobs at wall-clock time. Production entrypoints remain unchanged. The provider-hosted page is the only response fake; signed events and durable Order reactions use actual Core. Existing baseline catalog data is reused; setup changes use commands.

Intended application/contract files:

- `apps/core/src/orders/application/list-order-addition-options.ts` (new), `order-amendment.integration.test.ts`.
- `apps/core/src/entrypoint/orders-rpc.ts`, `apps/core/src/index.ts`.
- `packages/contracts/src/orders.ts`, `packages/contracts/src/core-service.ts`.
- `apps/web/app/api/commerce/orders/[order-id]/amendments/route.ts`.
- `apps/web/components/storefront/orders/amendment-flow.tsx` and its existing `.test.tsx`.
- `docs/architecture/API_CONTRACTS.md` (owning read/recovery semantics updated).

Intended test/config files:

- `apps/web/tests/scheduled-customer-journey.spec.ts` (new).
- `apps/web/tests/provider-gateway.ts`, `wrangler.provider-gateway.jsonc`, `provider-gateway-env.d.ts` (new; bindings generated by Wrangler).
- `apps/web/playwright.config.ts`.
- `apps/core/tests/browser-entrypoint.ts` (new), `apps/core/wrangler.e2e.jsonc`, `apps/core/tsconfig.json`.
- This checkpoint and its existing history file (owner-requested consolidation; prior bytes preserved in history).

Review corrections implemented: terminal payment failure is distinct from pending confirmation; malformed actions remain unknown, not processing. Renamed the expired-price test to match its actual evidence. Browser coverage now includes cross-customer RPC rejection, unchanged physical stock, desktop/mobile captures and a ten-second action timeout. The third run returned correct named options, but the test used an exact label-text selector that included option text; it now uses the verified accessible combobox role/name. These changes remain within CA-5.9.

## Current verification evidence

Scope: `19f409a1` plus CA-5.9 files above. Evidence root: `C:/Users/reggi/.codex/visualizations/2026/09/08/01a082ba-d1a3-7ce3-985b-99ed446e7347`.

- `pnpm typecheck`: passed after including the Core E2E entrypoint. Its first included check exposed the production-generated ENVIRONMENT union; runtime string comparison retains the test-only guard. `pnpm lint`, `pnpm architecture:check`, `pnpm naming:check`: passed. `git diff --check`: passed before later documentation edits; rerun at final review.
- `pnpm --filter @freshmarkets/core exec vitest run --config vitest.config.ts src/orders/application/order-amendment.integration.test.ts src/entrypoint/core-service-conformance.test.ts`: **16 tests / 2 files passed**, `scheduled-addition-options-focused.log`. Real Worker/D1 checks include ownership, availability, expired price, stock-independent suggestions, bounded search and existing amendment financial guards. These do not establish browser/provider acceptance.
- Browser command for all attempts: `E2E_START_STACK=1 E2E_PROVIDER_GATEWAY=1 E2E_STATE_NAME=e2e-commerce-alignment-20260907 pnpm --filter @freshmarkets/web exec playwright test tests/scheduled-customer-journey.spec.ts --retries=0` (set variables with PowerShell `$env:`).
- First attempt: **failed**, session 5137 exit 1, `scheduled-customer-journey-first.log`; verified payment event but test omitted the real payment-reaction scheduler before asserting an Order. Trace copied to `scheduled-journey-first/`. Fixed the test's missing scheduler step.
- Second attempt: **failed**, session 88130 exit 1, `scheduled-customer-journey-second.log`; original Order commitment succeeded, but test expected `orderId` where the list contract returns `id`. Corrected against the actual contract.
- Third attempt: **failed**, session 37004 exit 1, `scheduled-customer-journey-third.log`: correct GET options (HTTP 200) and an accessible named combobox were present; the wrong label selector waited the five-minute overall timeout. Inspected the trace response and accessibility snapshot; corrected the selector and bounded action waits. Subsequent typecheck/lint and the same focused Core command passed **16/2** (`scheduled-addition-options-focused-final.log`, session 75435). Fourth attempt (session 21111 exit 1, scheduled-customer-journey-fourth.log) stopped in 9.1 seconds at a test parser rejecting the cancellation status null while the request was still in flight; one test failed, mobile did not run. Named selection, original/addition commitments and both lost-reply retries had succeeded. Corrected the parser to the actual nullable contract and receiving assertion to its actual ungrouped numeric rendering. Managed migrations now use the same already-pinned Wrangler as fixture SQL and the runtime, with explicit E2E config/state; the previous startup spent most time in the newer migration CLI. This is a local test startup change, not a migration or deployment. Next command retains --max-failures=1.
- Formatter is `pnpm exec oxfmt --write <intended files>`. An earlier `prettier` attempt failed because it is not installed; no need to retry or install it. One patch mismatch was corrected without partial edits.
- Fifth browser attempt: **2 passed / 6.2 minutes**, session 12084 exit 0, `scheduled-customer-journey-fifth.log`; individual journeys 2.1/2.2 minutes include the real cutoff. Full command is the browser command above plus `--max-failures=1`. Desktop/mobile named-picker screenshots inspected; four captures copied to `scheduled-customer-journey/`. Original/addition commitment, signed-event deduplication, exact saved draft/payment retries, cross-customer rejection, accepted-cancellation exclusion, 1,500 g purchase/receipt/packing and unchanged physical stock passed. Actual provider acceptance remains open. The pinned migration command passed; no startup speedup is claimed from this run alone.
- Focused Web command `pnpm --filter @freshmarkets/web exec vitest run components/storefront/orders/amendment-flow.test.tsx test/app/orders "test/app/api/commerce/orders/[order-id]/amendments/route.test.ts"` initially had **1 failed / 7 passed**, `scheduled-addition-web.log`: old static test expected the removed SKU field. Updated it to the approved named search. `pnpm format:check` found only generated gateway-declaration whitespace; formatted after browser exit.
- Checkpoint consolidation: reduced 105,936 bytes to about 13 KB, retained all 23 CA IDs, validated links and protected Discussion hash, and verified the prior checkpoint bytes plus existing history prefix exactly. No new checkpoint file. Final aggregate passed; commit/push are next.

- Final gate: `pnpm check` **passed**, session 84645 exit 0, `scheduled-customer-journey-check.log`. Core **1579 tests / 194 files**, Web **403 / 101**, contracts **68 / 19**, shared suites, harness, migrations, format/conventions/architecture/readiness/lint/types and both builds passed. `pnpm --filter @freshmarkets/web check:vinext` passed **15 supported / 0 issues**, `scheduled-customer-journey-vinext.log`. `git diff --check` passed after final source review. No migration, deployment or actual provider acceptance is claimed.

## Remaining-task ledger

Counting level: **two major phase blocks (6–7)** remain, plus earlier acceptance and approved product-change obligations. Slice counts/test totals are not completion percentages. Every applicable plan criterion in A–I, audit defects and final journeys must remain assigned; this table is not a claim that each has already been audited.

| ID | State and remaining obligation |
| --- | --- |
| CA-0-2 | Earlier partial acceptance: canonical/retained-baseline reconciliation; no-SQL location/address/serviceability/pickup/cycle setup, onboarding/scoped access and financial recovery. Reuse proven code; recover only specifically missing evidence. |
| CA-5.9 | Locally accepted; reviewed commit/push remains the immediate task. |
| CA-5 | Section G local acceptance satisfied by CA-5.1–5.9: connected customer journey plus prior exact-demand/race, destination purchase, receiving/counting/discrepancy, packing and surplus evidence. Provider/delivery and newer approved product obligations remain assigned below. |
| CA-6 | Partial implementation: preparation-stage booking, provider-state reconciliation, Scheduled-only manual fallback, packed handover, customer promises, active membership/service-fee removal across UI/Core/jobs with required history retained. Sections E/F/H. |
| CA-7 | Final customer/operator/setup-to-delivery, manual fallback, failure/recovery, permission and provider acceptance; notifications, support, refunds, reorder and readiness. Sections E/F/I and final journeys. |
| Approved follow-ups | Guidance audit's approved-change table remains open where not explicitly verified: guest cart/customer/address (GD-D01/D21); courier choice/automatic booking/full-order grams/disabled payment methods (D03/D10); five-image gallery (D05); product-sale stacking/percentage/fixed-unit/overlap/allowance/cancellation (D06–07); no general cart minimum (D08); Problems and approved reports (D11/D13); weekly progress (D14); normal Scheduled-to-Instant changeover (D15); actual counts/receiving (D17–18). Existing CA-4/5 evidence closes only its demonstrated portions. |

Exact approved changes: [GUIDANCE_REBUILD_AUDIT.md](../GUIDANCE_REBUILD_AUDIT.md#approved-changes-still-requiring-acceptance). No extra feature is authorized by an old implementation or archived proposal.

## Completed slices — do not restart

Detailed commands, tested revisions, failures subsequently resolved and evidence limits are preserved in the existing history file. These are implementation/local acceptance claims, not actual provider or release acceptance.

| IDs | Result / commit |
| --- | --- |
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

**One next action:** stage only the reviewed CA-5.9 files and this checkpoint/history consolidation, commit and push `main`. Then activate CA-6 — Phase 6 — Delivery and customer alignment, beginning with the existing fulfillment-to-booking path (`advance-fulfillment.ts`, `delivery-provider-operations.ts`, `request-provider-delivery.ts` and the Web booking control). Reuse existing delivery safeguards and prove readiness, automatic Instant booking, independent provider state and Scheduled fallback against section H. Do not rerun the accepted CA-5.9 application unchanged.