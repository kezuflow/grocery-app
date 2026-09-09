# Commerce alignment — active checkpoint

Updated: 2026-09-09. This is the **only active commerce checkpoint**. [History](COMMERCE_ALIGNMENT_EXECUTION_HISTORY_20260909.md) contains completed evidence and superseded instructions; consult it only for a specific missing fact. Do not read it as another task list.

## Current task and authority

**CA-7 — Complete journeys and activation evidence** is the sole active implementation task. Source: [COMMERCE_ALIGNMENT_E2E_PLAN.md](../../product/COMMERCE_ALIGNMENT_E2E_PLAN.md), **Phase 7 — Complete journeys and activation evidence**, sections E/F/I and approved PRODUCT GD-D19. The customer report and Admin Problems flow is locally accepted; next cohesive scope is approved notifications (GD-D19). CA-6 local delivery milestones are verified below; actual provider acceptance and earlier gaps remain open. Follow [AGENTS.md](../../../AGENTS.md) and [continuation boundaries](../COMMERCE_ALIGNMENT_CONTINUATION_PLAN.md).

Current acceptance: courier/manual pickup, completion and failure persist one customer notification intent per attempt/event in the same guarded transaction, even when events arrive before the scheduler runs. Duplicates/replay create no extra intent; omitted required persistence rolls back application while retained provider evidence remains recoverable. Existing Queue retries and unknown-send handling remain unchanged. Customer delivery notices and scoped staff/dashboard Problems notices remain distinct obligations; the protected GD-D19 table routes new problem requests to administrators. Problems flow is committed/pushed as 78685870 with local acceptance; actual provider/outbound acceptance is separate.
All nine owner product decisions and transfer controls are approved. PRODUCT and the guidance audit record their exact meaning; do not reopen them, expand scope or infer policy from memory. The protected discussion stays unchanged.

Owner correction, 2026-09-09: execution was too repetitive and checkpoint history obscured the current task. Batch coherent edits and inspect request/response contracts before costly browser runs. Use focused checks during iteration and the required aggregate at the coherent gate. Avoid unchanged status polling and repeated broad reads. Keep this record concise; replace current state instead of appending competing next actions.

## Git, preservation and processes

- Branch `main`; observed HEAD `78685870`. CA-7 Problems is committed/pushed. Current notification draft: notifications/application/delivery-notifications.ts, project-domain-notifications.ts and delivery/application/{apply-provider-observation,manage-manual-delivery}.ts; focused validation and connected browser passed as recorded below. Preserve all unrelated/protected changes outside commits.
- Leave `.codex/config.toml` locally deleted and outside commits. Leave untracked `docs/product/SIMPLIFICATION_DISCUSSION.md` intact/outside commits; recorded SHA256 `0021CDF5935E3B90D2C23EAA5EBA56DA7419EE7CD2E8FA479990E03BC64B792F`.
- Preserve unrelated `.claude`, `.superpowers/sdd` and `docs/superpowers/{plans,prompts,reports,specs}` deletions. READMEs and `apps/web/tests/counted-stock.spec.ts` have shown modified status without a Git content diff; exclude them. `IMPLEMENTATION_STATUS.md` has pre-existing invalid UTF-8; untouched.
- Only disposable DB: `apps/core/.wrangler/e2e-commerce-alignment-20260907`. No other local/shared/retained/remote reset. Explicit UTF-8 writes; no subagents; no deployment, real provider transaction, outbound message or inferred business values.
- Never overlap Core suites and managed browser stacks. Keep application source fixed during browser acceptance. Current process state is recorded with validation below; never overlap its Core gate with a managed browser stack.

## Current implementation and acceptance

Problems is committed/pushed as **78685870**: optional item selection, three Admin states, contact details, guarded handling and frozen replay. Local aggregate **1631 Core/196 files, 402 Web/101, 68 contracts/19** plus final focused checks and **2 desktop/mobile browser journeys** passed. Exact files/commands, corrected locator failure and screenshots are preserved in the existing history. Problem/dashboard notifications remain a separate GD-D19 obligation.

**CA-7 / GD-D19 delivery notification draft on 78685870:** shared delivery-notification statements persist one attempt/event intent inside both provider-observation and manual-delivery batches. The existing projector recognizes EN_ROUTE and shares stable attempt keys, retaining legacy-key deduplication. No schema, transport, new channel or operator procedure. Missing recipient retains failed intent; actual sends remain separate. Files also include Lalamove and manual integration tests, the shared signed-delivery browser helper, API_CONTRACTS and this checkpoint.

Validation: `pnpm --filter @freshmarkets/core exec vitest run --config vitest.config.ts src/delivery/http/lalamove-webhook.integration.test.ts src/delivery/http/grab-express-webhook.integration.test.ts src/admin/application/delivery-provider-operations.integration.test.ts src/notifications/application/notification-outbox.integration.test.ts src/notifications/application/notification-queue.integration.test.ts` passed **67/5**, session 49269 exit 0, ca7-delivery-notifications-core.log. Proves omitted-intent rollback/provider inbox recovery, rapid pickup/completion before projection, duplicate intent/send protection, manual custody rollback/replay, existing send lease/unknown-outcome/retry safeguards. Workspace types/lint/architecture and changed-source formatting pass. Browser **93807 exit 0, four desktop/mobile journeys passed in 8.0 minutes**, ca7-delivery-notifications-browser.log: same managed environment/DB as above, `pnpm --filter @freshmarkets/web exec playwright test tests/instant-auto-booking.spec.ts tests/scheduled-customer-journey.spec.ts --retries=0 --max-failures=1`. The shared helper asserts both pending outbox intents after real paid/prepared signed completion in both modes. No Core suite overlapped; source stayed fixed. Final Core deployment dry run passed, ca7-delivery-notifications-core-build.log; format/naming checks passed. Final Lalamove suite including recipient-unavailable regression passed 13/1, session 88869 exit 0, ca7-delivery-notifications-recipient.log; application source unchanged and final Core types pass. No process remains.

### Previous verified CA-6 milestones

Return inspection is committed/pushed as **18fc6fa1**. It records customer agreement and separate inspection evidence, restores packed/ready custody atomically, and allows only the inspected attempt to authorize redelivery. It never restocks, repeats packing consumption, refunds or adds charges. Earlier attempts and original commercial promises remain retained.

**Completed CA-6 local milestone: connected courier completion in both modes**, on 18fc6fa1. Production application remains unchanged. The test entrypoint calls the production signature/inbox/application handler with synthetic credentials; the local gateway forwards only the known callback path. Shared test verification exercises invalid-signature rejection, assignment, pickup, completion, exact duplicates, customer status and completed-order removal from the active queue. Scheduled retains its separate future booking, cancellation/manual fallback, return inspection/redelivery and lost-completion-reply checks.

Acceptance: both actual local paid/prepared journeys reach courier completion through signed callbacks; invalid/duplicate callbacks cannot mutate business state incorrectly; customer views reflect pickup/delivery. This closes local connected evidence only, not actual Lalamove/PayMongo account acceptance or deployment.

Verified acceptance milestone files (commit subject: test(delivery): verify signed completion in both commerce modes): apps/core/tests/browser-entrypoint.ts; apps/web/tests/{provider-gateway.ts,instant-auto-booking.spec.ts,scheduled-customer-journey.spec.ts,signed-delivery-events.ts}; the existing checkpoint/history. No other application, contract or storage change in this acceptance scope.

Evidence root: `C:/Users/reggi/.codex/visualizations/2026/09/08/01a082ba-d1a3-7ce3-985b-99ed446e7347`.

- Return aggregate `pnpm check`: **1629 Core/196 files, 402 Web/101, 68 contracts/19**, shared/harness/migration/static gates and both builds passed; session 92194 exit 0, ca6-return-check-verified.log. Tested 37c7fe46 plus the return scope committed as 18fc6fa1. The earlier seven obsolete-membership test failures and their verified fixes remain in history.
- Return combined browser: **4 desktop/mobile journeys / 7.2 minutes**, 62642 exit 0, ca6-return-browser-verified.log. Exact command below. Test-only stock response normalization fixed the earlier failed assertion; the application was unchanged. Final return screenshots inspected/copied as ca6-final-return-inspection-{1440,390}.png. Mobile uses the existing horizontally scrollable queue.
- Signed Instant browser: **2 desktop/mobile journeys / 2.3 minutes**, 89402 exit 0, ca6-signed-delivery-browser-verified.log. The first run (76586 exit 1) reached completion but incorrectly searched the active queue for the delivered job; corrected to assert customer detail and queue removal. No application fix was needed. Final screenshots inspected.
- Draft checks: Web/Core typechecks, formatting, lint, architecture, and harness **26/26** passed. The final shared helper and Scheduled extension passed Web types/lint/format and architecture; diffs reviewed.
- **Final combined browser: 4 desktop/mobile journeys / 6.9 minutes, session 4230 exit 0**, ca6-both-modes-delivered-browser.log. Tested 18fc6fa1 plus the listed test-only scope. No process remains. Both-mode delivered screenshots inspected/copied as ca6-final-instant-delivered-{1440,390}.png and ca6-final-scheduled-courier-delivered-{1440,390}.png. Command: `E2E_START_STACK=1 E2E_PROVIDER_GATEWAY=1 E2E_STATE_NAME=e2e-commerce-alignment-20260907 pnpm --filter @freshmarkets/web exec playwright test tests/instant-auto-booking.spec.ts tests/scheduled-customer-journey.spec.ts --retries=0 --max-failures=1`. No overlapping Core suite; application/test source stays fixed during the run. Only the identified disposable database is recreated.

## Remaining-task ledger

Counting level: **two major phase blocks (6–7)** remain, plus earlier acceptance and approved product-change obligations. Slice counts/test totals are not completion percentages. Every applicable plan criterion in A–I, audit defects and final journeys must remain assigned; this table is not a claim that each has already been audited.

| ID | State and remaining obligation |
| --- | --- |
| CA-0-2 | Earlier partial acceptance: canonical/retained-baseline reconciliation; no-SQL location/address/serviceability/pickup/cycle setup, onboarding/scoped access and financial recovery. Reuse proven code; recover only specifically missing evidence. |
| CA-6 | Local delivery milestones verified; actual provider/aggregate-coverage reconciliation remains open: preparation-stage booking, provider-state reconciliation, Scheduled-only manual fallback, packed handover, customer promises, active membership/service-fee removal across UI/Core/jobs with required history retained. Sections E/F/H. |
| CA-7 | Active; approved Problems flow locally accepted. Final customer/operator/setup-to-delivery, manual fallback, failure/recovery, permission and provider acceptance; notifications, support, refunds, reorder and readiness. Sections E/F/I and final journeys. |
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

**One next action:** commit/push the verified delivery-notification scope; then implement scoped dashboard notices in the existing overview contract/read/page, with links into existing authorized order/operation/Problems/payment views. The existing header bell links to operational exceptions; it is not an approved event feed. Preserve Queue/attempt/unknown-outcome safeguards. No provider/account acceptance or outbound message is claimed.
