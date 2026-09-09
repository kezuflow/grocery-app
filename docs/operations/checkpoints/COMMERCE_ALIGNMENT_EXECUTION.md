# Commerce alignment — active checkpoint

Updated: 2026-09-09. This is the **only active commerce checkpoint**. [History](COMMERCE_ALIGNMENT_EXECUTION_HISTORY_20260909.md) contains completed evidence and superseded instructions; consult it only for a specific missing fact. Do not read it as another task list.

## Current task and authority

**CA-6 — Delivery and customer alignment** is the sole active implementation task. Source: [COMMERCE_ALIGNMENT_E2E_PLAN.md](../../product/COMMERCE_ALIGNMENT_E2E_PLAN.md), **Phase 6 — Delivery and customer alignment**, sections E/F/H, its policy-enforcement acceptance additions and the corresponding approved Product decisions. Follow [AGENTS.md](../../../AGENTS.md) and [continuation boundaries](../COMMERCE_ALIGNMENT_CONTINUATION_PLAN.md).

Acceptance: coordinated preparation locks Instant cancellation; checked items plus final packing automatically request the selected available courier for Instant; Scheduled future booking uses received/checked goods and credible readiness. Provider search/assignment/pickup remain independent of packing; handover requires packed goods. Scheduled-only manual assignment/handover/completion/failure must be authorized, versioned, replay-safe and mutually exclusive with active/unknown external attempts. Preserve accepted charges, record actual cost honestly, enforce full-order/addition weight at most 20,000 g without packaging inputs, and remove retired active membership/service-fee behavior while retaining required history. Prove direct-RPC rejection, no partial effects, concurrent/replayed/unknown outcomes and reachable Web journeys. Actual provider acceptance and activation are separate external gates.
All nine owner product decisions and transfer controls are approved. PRODUCT and the guidance audit record their exact meaning; do not reopen them, expand scope or infer policy from memory. The protected discussion stays unchanged.

Owner correction, 2026-09-09: execution was too repetitive and checkpoint history obscured the current task. Batch coherent edits and inspect request/response contracts before costly browser runs. Use focused checks during iteration and the required aggregate at the coherent gate. Avoid unchanged status polling and repeated broad reads. Keep this record concise; replace current state instead of appending competing next actions.

## Git, preservation and processes

- Branch `main`; latest verified push `9138860b..bd4acef5`, `feat(delivery): book Instant orders when packing starts`. The first-booking milestone is committed and locally verified. CA-6 remains active. The manual-delivery draft listed below is uncommitted; preserve all unrelated changes below.
- Leave `.codex/config.toml` locally deleted and outside commits. Leave untracked `docs/product/SIMPLIFICATION_DISCUSSION.md` intact/outside commits; recorded SHA256 `0021CDF5935E3B90D2C23EAA5EBA56DA7419EE7CD2E8FA479990E03BC64B792F`.
- Preserve unrelated `.claude`, `.superpowers/sdd` and `docs/superpowers/{plans,prompts,reports,specs}` deletions. READMEs and `apps/web/tests/counted-stock.spec.ts` have shown modified status without a Git content diff; exclude them. `IMPLEMENTATION_STATUS.md` has pre-existing invalid UTF-8; untouched.
- Only disposable DB: `apps/core/.wrangler/e2e-commerce-alignment-20260907`. No other local/shared/retained/remote reset. Explicit UTF-8 writes; no subagents; no deployment, real provider transaction, outbound message or inferred business values.
- Never overlap Core suites and managed browser stacks. Keep application source fixed during browser acceptance. Current process state is recorded with validation below; never overlap its Core gate with a managed browser stack.

## Reconciled implementation and verification

CA-5.9 is complete locally at `9138860b`; its exact evidence is in history under **CA-5.9 final local acceptance — 9138860b**. Do not restart it. CA-6 first-booking milestone is complete locally and pushed as `bd4acef5`: automatic Instant booking after checking/final packing, durable retry before submission, one-attempt protection, current permission/readiness admission, and atomic provider identity/inbox/audit/receipt. ALLOCATING displays Finding rider without fabricated assignment. No schema change or actual provider acceptance.

Final first-booking validation on `9138860b` plus the committed application source: `pnpm check` passed (session 34363 exit 0), **1586 Core / 194 files, 403 Web / 101, 68 contracts / 19**, shared/harness/migrations/static checks and both builds; log `ca6-booking-check.log`. `pnpm --filter @freshmarkets/web check:vinext` passed, 15 supported/0 issues. Final focused command `pnpm --filter @freshmarkets/core exec vitest run --config vitest.config.ts src/admin/application/delivery-provider-operations.integration.test.ts src/delivery/application/request-provider-delivery.integration.test.ts` passed 19/2, `ca6-atomic-booking.log`, including lost audit/evidence rollback, unknown outcomes, revoked access and concurrent replay.

Final first-booking browser command: `E2E_START_STACK=1 E2E_PROVIDER_GATEWAY=1 E2E_STATE_NAME=e2e-commerce-alignment-20260907 pnpm --filter @freshmarkets/web exec playwright test tests/instant-auto-booking.spec.ts --retries=0 --max-failures=1`. **2 passed / 2.1 minutes**, session 46217 exit 0, `ca6-instant-browser-atomic.log`, same application source as aggregate. Desktop/mobile screenshots inspected; mobile retains the horizontally scrollable queue. Evidence root: `C:/Users/reggi/.codex/visualizations/2026/09/08/01a082ba-d1a3-7ce3-985b-99ed446e7347`. Local fake-provider acceptance only.

Verified CA-6 manual-delivery milestone, based on `bd4acef5`, ready to commit: Scheduled manual ASSIGN/HAND_OVER/COMPLETE/FAIL command and domain policy, shared contract/RPC, typed queue decisions and ordinary Web controls. Existing attempt storage is reused; unknown cost keeps the financial evidence null, known terminal cost records charge/currency/variance. Job/stop, custody/Order progress, audit and frozen receipt share one guarded batch. Older fulfillment handover/completion is excluded during active manual custody. Failure records FAILED without fabricating return, retry, delivery or refund success; further recovery remains open.

Intended milestone files (reviewed, pending commit): `apps/core/src/delivery/{domain/manual-delivery.ts,application/manage-manual-delivery.ts,application/list-delivery-dispatch.ts}`, `apps/core/src/admin/application/{operations-reads.ts,delivery-provider-operations.integration.test.ts}`, `apps/core/src/{index.ts,entrypoint/core-service-conformance.test.ts,operations/application/advance-fulfillment.ts,fulfillment/application/list-fulfillment-queue.ts}`, `packages/contracts/src/{admin-operations.ts,admin-operations.test.ts,core-service.ts}`, `apps/web/app/api/admin/manual-deliveries/route.ts`, `apps/web/components/admin/delivery/{manual-delivery-controls.tsx,external-delivery-queue.tsx}`. The existing `apps/web/tests/scheduled-customer-journey.spec.ts` now covers manual assignment before packing, handover, completion and same-body/key replay after a lost reply. API_CONTRACTS, STATE_MACHINES and DATA_MODEL are updated. Browser execution remains pending. Manual behavior has local acceptance below; no actual provider acceptance or deployment is claimed.

Manual draft validation: `pnpm check` **passed**, session 68554 exit 0, log `ca6-manual-check.log`: **1595 Core / 194 files, 403 Web / 101, 68 contracts / 19**, shared/harness/migrations/static checks and both builds. During the aggregate, final review added an atomic known-cost charge guard, clarified the Delivery queue heading, and extended two test assertions. Current `pnpm typecheck`, `pnpm format:check`, `pnpm lint` then passed. Follow-up `pnpm --filter @freshmarkets/core exec vitest run --config vitest.config.ts src/admin/application/delivery-provider-operations.integration.test.ts src/operations/application/advance-fulfillment.integration.test.ts` passed **19 tests / 1 matched file**, exit 0, `ca6-manual-final-core.log`; the second requested path did not match a file, so this is only the delivery-provider operations test result. The full gate already covered existing fulfillment suites. Initial financial-evidence trigger failure was fixed by keeping unknown evidence all-null; a later rollback assertion was corrected to count only its exact command key.

Managed browser command `E2E_START_STACK=1 E2E_PROVIDER_GATEWAY=1 E2E_STATE_NAME=e2e-commerce-alignment-20260907 pnpm --filter @freshmarkets/web exec playwright test tests/scheduled-customer-journey.spec.ts --retries=0 --max-failures=1` **passed 2 desktop/mobile journeys / 6.5 minutes**, session 54140 exit 0, `ca6-manual-browser.log`. Application source remained fixed during the run. Both prove actual local paid checkout/addition/cancellation/receiving/packing/manual assignment/handover/completion and same-body/key recovery from a lost completion reply. Provider evidence is fake/local only. Protected Discussion SHA256 still matches.

Screenshot review corrected the misleading Not booked label for manual attempts and replaced a mobile capture that missed the controls. Final command above with `--grep '390px'` **passed 1 journey / 4.1 minutes**, session 38521 exit 0, `ca6-manual-mobile-final.log`. The inspected final mobile full-page screenshot shows the manual custody state and usable completion/failure controls in the existing horizontally scrolling queue. Copied screenshots are under `ca6-manual-delivery/` in the evidence root; desktop capture predates the label-only correction. Application source stayed fixed during each browser run. Web typecheck and vinext (15 supported/0 issues) passed after the wording correction.

Final boundary review added the standard authenticated-request envelope validation to the new Service Binding method. `pnpm --filter @freshmarkets/core exec vitest run --config vitest.config.ts src/entrypoint/core-service-conformance.test.ts` passed **4 tests / 1 file**, including malformed-envelope rejection, followed by Core typecheck and `git diff --check`. This envelope guard is the only application change after final mobile acceptance; valid manual command logic is unchanged. No verification process remains active. The milestone is ready for its reviewed commit/push. Scheduled received-goods booking readiness and all other CA-6 obligations remain open.
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

**One next action:** commit/push the verified manual-delivery milestone, then implement Scheduled received/checked-goods booking readiness under the same CA-6 ID. Preserve earlier acceptance gaps and every other ledger obligation.
