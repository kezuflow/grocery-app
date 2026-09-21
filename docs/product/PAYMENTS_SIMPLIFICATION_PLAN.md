# Payments Simplification Execution Plan

Prepared 21 September 2026 for **Sol 5.6, Medium reasoning**. Parent task:
`PAYMENTS-SIMPLIFY-1`. The owner subsequently authorized PS-01 through PS-06, which are implemented
and locally verified as recorded in the active checkpoint. This remains distinct from deployment,
retained production-data review and actual-provider acceptance.

This continues [COMMERCE_ALIGNMENT_E2E_PLAN.md](COMMERCE_ALIGNMENT_E2E_PLAN.md), **Phase 7 — Complete
journeys and activation evidence**. Follow [AGENTS.md](../../AGENTS.md), the active checkpoint and the
affected authoritative specifications. Do not use subagents, create a new task, change model settings,
deploy, execute real payments/refunds, or mutate production data from this document alone.

## 1. Outcome and locked decisions

Payments answers two questions: **what money did we receive/refund, and what real problem needs us?**
The local payment identity is still required to match provider confirmation to accepted checkout
terms and to apply Order/stock/refund effects exactly once. PayMongo's dashboard does not replace
those application responsibilities. Ordinary attempts must stop becoming staff work.

The following decisions include the owner's corrections after the initial conversational plan:

1. One Payments workspace, with **Payments** and **Needs attention** views. Payments is the default.
2. Payments lists captured payments, including partially/fully refunded ones. Ordinary unpaid,
   failed-without-capture and expired attempts are absent. **Do not implement an All attempts filter.**
3. Needs attention contains actual unresolved money/commitment problems, grouped by payment. An
   expired attempt is not a problem solely because time passed or the customer never paid.
4. Relevant diagnostics remain in a collapsed Technical details section. No separate reconciliation
   destination, overview dashboard, workload graph or generic recovery console.
5. Verified resolution automatically removes an issue from staff work. No manual Close case or
   acknowledgment chore. Choosing to refund still requires the existing staff decision.
6. Keep the current **one-hour FreshMarkets payment continuation** and **up-to-30-minute QR code**.
   Existing in-window QR replacement remains. The owner asked whether the window was 24 hours; that
   was corrected, not authorization to change it. Add no duration setting.
7. Window expiry does not cancel the PayMongo intent or prove permanent nonpayment. Never force a
   canonical terminal state from a timer. Later valid payment confirmation must still be processed.
8. Preserve the required local evidence. No new deletion/retention period, data purge, schema reset,
   new provider integration, PayMongo-dashboard sync/import, or automatic refund policy in this slice.

### What PROCESSING means

`REQUIRES_ACTION` means the customer still needs to complete a payment step. `PROCESSING` means there
is no further customer action currently required and payment confirmation is pending; it is not
proof of success or failure. PayMongo's adapter maps its processing/pending observations to this
state, and the canonical transition path can pass through it when applying a successful observation.
The intermediate transition does not require a separate screen or manual step.

Retain that internal distinction to avoid false success/failure and duplicate payment attempts.
Do not add a Processing tab, staff queue, action badge or requirement to advance it manually. Where
the existing customer payment flow actually exposes this state, use "Confirming payment"; do not
add a new customer screen. Healthy processing stays automatic. Only exhausted or otherwise
unrecoverable confirmation becomes a specific Needs attention issue. Order confirmation after
captured payment is a different process and must not downgrade the financial status.

### Observable behavior

| Facts | Payments view | Needs attention | Mutating controls |
| --- | --- | --- | --- |
| Unpaid, usable continuation | Absent | Absent | None |
| Continuation expired; provider confirms awaiting customer payment after expiry | Absent | Absent | None |
| Definite failed/expired financial outcome; no captured funds or unfinished effects | Absent | Absent | None |
| Ordinary payment processing; bounded recovery still running | Absent | Absent | None |
| Captured payment, completed Order/addition | Paid row | Absent | Refund only if currently eligible |
| Captured payment with normal refund processing | Paid row with refund progress | Absent | No manual recheck while automatic recovery is available |
| Partially/fully refunded payment, required effects completed | Retained row | Absent | Remaining eligible refund only |
| Unknown outcome after recovery exhaustion, or outcome cannot safely be recovered | Absent unless captured | One item | Eligible status check; otherwise explanation |
| Verified contradictory identity/amount/currency or an unmatched financial event | Captured row if applicable | One investigation item | Only existing evidence-supported recovery |
| Money received but Order/addition recovery exhausted | Retained row | One item | Existing eligible Order/addition retry or refund |
| Refund recovery or its required downstream effects exhausted | Retained row if captured | One item | Existing eligible refund recheck |

A captured payment whose Order is still being retried remains visible in Payments with a plain
"Order confirmation processing" explanation. It becomes staff work when that recovery is exhausted
or cannot safely continue. Never hide captured money because there is no Order yet.

## 2. Ground truth and reading map

Reviewed `main` at `dcd708f78f39a24993aa8316d87cb6670203fd86`. Recheck HEAD/status before implementation.
Six visible attempts and eight open cases were observed in the authenticated production browser.
That observation does not prove those attempts are unpaid, test-mode, safe to delete, or resolved.
Provider outcome was not independently verified. The existing unrelated `.claude/skills` deletions
must remain untouched.

Read the following entry points as each sequence reaches them; do not load all historical plans.
Paths below are relative to the repository root.

| Concern | Starting points and confirmed defect |
| --- | --- |
| Raw finance projections | `apps/core/src/admin/application/finance-reads.ts`: list exposes every intent; overview counts `REQUIRES_ACTION`; detail computes refundable balance before checking captured state; payment/refund rechecks are offered during ordinary pending work |
| Shared API | `packages/contracts/src/admin-finance.ts`, `packages/contracts/src/admin-overview.ts`, `packages/contracts/src/core-service.ts`; trace each changed method through Core entrypoint and Web route consumers |
| Main Admin overview/navigation | `apps/core/src/admin/application/admin-overview.ts`, `apps/core/src/admin/application/get-admin-context.ts` |
| Window lifetime | `apps/core/src/payments/infrastructure/providers/paymongo-payment-provider.ts` (`PROVIDER_ACTION_TTL_MS`); `apps/web/components/payments/paymongo-payment.tsx` (`QR_PH_EXPIRY_SECONDS`) |
| Expiry and lookup | `apps/core/src/payments/application/expire-provider-actions.ts`, `reconcile-stuck-payments.ts`, `reconcile-payment.ts`, `recheck-staff-payment.ts`; expiry currently changes the continuation only, and five unresolved/nonterminal lookups become a case |
| Evidence and resolution | `apps/core/src/payments/infrastructure/d1/payment-repository.ts`, `reconciliation-resolution.ts`; application `resolve-reconciliation-case.ts`, `prepare-refunded-commitment-resolution.ts`; current lookup-unavailable and exhaustion paths create separate case records |
| Owning cleanup | `apps/core/src/orders/application/complete-refunded-commitment.ts`, `resolve-committed-finance-exceptions.ts`; retain their exact subject/Order/refund/entitlement safeguards |
| Refund/event/reaction recovery | Payments application `reconcile-refunds.ts`, `recheck-staff-refund.ts`, `read-provider-event-recovery.ts`, `read-payment-reaction-recovery.ts`, and corresponding retry commands |
| Scheduling | `apps/core/src/scheduling/jobs/payments-reconciliation-redrive.ts`, `payments-reaction-redrive.ts`, `refund-reconciliation.ts`, and `job-registry.ts` |
| Existing UI | `apps/web/app/admin/payments/`, `apps/web/components/admin/payment-navigation.tsx`, `payment-overview-view.tsx`, `payment-recovery.tsx`, `refund-recovery.tsx`, `payment-reaction-recovery.tsx`, `provider-event-recovery.tsx` |
| Reuse for composition | `apps/web/components/admin/admin-master-detail-workspace.tsx`, `admin-data-table.tsx`, `admin-controls.tsx`, `admin-page-state.tsx`, and existing Products/Orders master-detail callers |

The technical specifications to update are API_CONTRACTS (Admin Orders and Payments / Payment lookup
recovery), STATE_MACHINES (Payment Attempt / Refund), and DATA_MODEL (Payments and Refunds). PRODUCT
and DESIGN record approved behavior; this file supplies execution order and acceptance.

## 3. Implementation sequences

Implement **PS-01 through PS-06 sequentially** after implementation is requested. One sequence is
active at a time. For each, inspect its callers, change the smallest cohesive boundary, run the named
focused checks, review the diff, and update the active checkpoint. Do not stop for routine approval
between authorized sequences. Never count a UI-only fix as completing recovery behavior.

### PS-01 — Classify customer waiting correctly and finish expired unpaid lookups

**Deliverable:** normal customer waiting never exhausts into staff work; verified nonpayment after
the window finishes recovery without making late payment confirmation illegal.

- Extend the internal lookup result to distinguish a verified awaiting-customer observation,
  processing observation, terminal observation, lookup unavailable/missing reference, identity or
  amount/currency mismatch, and failed/conflicted local application. Do not infer this distinction
  from a UI label or collapse all successful nonterminal reads into an error.
- Retain the existing initial 15-minute stuck threshold, five-attempt recovery bound, leases,
  backoff and batch limit. For a valid awaiting-customer result before continuation expiry, finish
  the current claim successfully and schedule the next lookup at that persisted deadline. Reset
  the current failure budget for this known waiting state; record no pending-as-error diagnostic.
  Do not repeatedly poll healthy waiting at the normal failure backoff.
- At/after expiry, perform an authoritative read-only lookup. A request begun before the deadline
  cannot establish post-deadline nonpayment. Validate the exact provider/reference, amount and
  currency and apply the observation through the existing path.
- If it still reports awaiting customer payment, no continuation is usable, and no conflicting
  financial/Order/refund/event work exists, mark its lookup `COMPLETED`, clear the lease/error, and
  retain a safe audited conclusion `PAYMENT.UNPAID_WINDOW_CONFIRMED`. Leave canonical intent/attempt
  status unchanged. Use the existing lookup/action/audit tables; add no new status machine or table.
- Guard the completion and audit in one transaction against changed Payment version/status, attempt
  identity, continuation/deadline, recovery lease/version, and outstanding observations/effects.
  A concurrent paid event wins normal processing or causes this completion to retry; it must never
  be overwritten. Evidence for later automatic closure is the matching completed lookup and audited
  post-window conclusion, not `REQUIRES_ACTION`, age, or an empty provider response alone.
- Missing provider records, missing continuation/reference, unsupported lookup and network/auth
  failures never count as nonpayment. Continue the bounded recovery or expose the real unavailable
  outcome when recovery cannot proceed. A `PROCESSING` result retains the existing bounded path.
- A valid late payment event must still apply the normal guarded Payment -> Order/addition reaction.
  If operational commitment cannot complete, retain the captured money and expose its actual issue.
  Do not release stock/entitlements, recreate payment, or initiate a refund from expiry alone.

**Acceptance:** focused Worker/D1 tests prove one scheduled final check for healthy waiting, zero
false escalation, exact deadline behavior, terminal/unknown distinction, concurrent success safety,
and rollback if completion/audit fails. Preserve the interrupted-fifth-lease test: a process death
must not silently obtain unlimited provider calls.

### PS-02 — Automatically resolve completed issues and remove duplicate recovery chores

**Deliverable:** one actual issue can have retained evidence without multiple staff tasks; verified
completion needs no human acknowledgment.

- Refactor a small application-owned completion operation from the existing resolution code.
  Keep an explicitly authenticated wrapper for any still-consumed staff command; the scheduler uses
  a system actor with `actorUserId: null`, not an invented staff user or a capability bypass.
- Reuse the current completed-resolution predicates for captured, refunded, failed and expired
  outcomes. Compose owning Order/finance-exception cleanup where required. For a fully refunded
  never-committed checkout/addition, execute the existing guarded refunded-commitment cleanup before
  closing its case. Widen the actor type only at these necessary internal audit/cleanup boundaries;
  retain staff authorization at every externally reachable command.
- Add a narrowly scoped completion route for the PS-01 audited unpaid-window conclusion. It may
  close only matching routine lookup-unavailable/exhaustion cases whose uncertainty that exact
  observation resolves. It must not close arbitrary AMBIGUOUS_OUTCOME, mismatched-money, unmatched
  event, refund or reaction cases just because one lookup returned awaiting customer payment.
- Use the existing reconciliation scheduled job to process a bounded batch of eligible open cases
  after lookup work. Drain eligible cases oldest-first with stable IDs; do not let ineligible old
  cases permanently block later eligible ones. No writes from GET/read projections.
- Required cleanup, conditional case update, distinct per-case audit and immutable completion receipt
  must commit together. Use a stable identity derived from case ID and expected version. Duplicate
  sweeps replay safely; stale versions, new work, failed audit or ignored dependent writes roll back.
- Ordinary lookup failures stay in lookup recovery metadata until exhausted. Use the existing
  deterministic `payment-lookup:<intentId>` case for that escalation. Immediate contradictory
  financial evidence keeps its existing case path. Do not build a generic case-merging framework.
- Preserve historical case rows. Close only evidence-eligible ones and group the remaining ones in
  reads. Historical exhausted rows with an expired continuation and only
  `PAYMENT_STILL_PENDING` as the last error may enter one new bounded verification window, identified
  by a stable audit/idempotency marker. Do not reset every exhausted unknown outcome on every sweep.
  Historical provider-unavailable/missing-reference cases remain real issues unless verified.

**Acceptance:** auto-close captured-and-committed, fully refunded-without-commitment, and PS-01 normal
expiry fixtures; retain contradictory/unmapped/unfinished work; test replay, multiple case audits,
case reopening/version races, cleanup failure and late success. Existing manual-resolution tests
must become automatic-completion tests where their product behavior has been superseded.

### PS-03 — Supply one Core-owned Payments and attention projection

**Deliverable:** typed reads and command guards match the product table, before the UI consumes them.

- Change `listAdminPayments` to list only `SUCCEEDED`, `PARTIALLY_REFUNDED` and `REFUNDED` intents.
  Preserve all three in the default view. Status filtering uses a closed allow-list; arbitrary raw
  status strings are rejected. Apply predicates before cursor pagination; default/max limits remain
  50/100. Keep existing newest-created ordering and label that date honestly as Date created.
- Add a grouped `listAdminPaymentAttention` read and retire the raw case-list UI contract once its
  consumers are replaced. Return one row for each affected payment and one row for each unlinked
  provider-event identity; if no event identity exists, retain a separate case identity. Never merge
  unrelated unmatched events merely because their category/provider is the same.
- An attention row contains a stable key, nullable payment identity/customer/amount/currency, readable
  problem summary, underlying bounded case/action references, earliest open date, and Core-derived
  legal recovery actions. Unknown amount/customer stays unavailable, not zero or fabricated.
- Group and filter in Core before pagination. Use oldest-open ordering for attention, with the
  stable group key as a tiebreaker. Its total counts groups, not raw cases. Shared predicates must
  cover unresolved outcomes, exhausted event/reaction/refund work, and immediate contradictory
  evidence; do not equate an OPEN case or a refund request with current staff work.
- Retrying an already escalated issue keeps its row visible with "Checking automatically" and no
  duplicate action until its evidence is resolved. Ordinary initial background processing creates no
  staff item. This distinguishes an existing unresolved issue from healthy new processing.
- Use this exact attention count for the Needs attention tab and the main Admin overview. Replace
  `ACTION_REQUIRED_PAYMENTS` with a payment-attention metric and link it to the new view. Remove the
  obsolete Payment overview DTO/query/API after checking all consumers, instead of maintaining a
  second metric owner. Reports/Analytics retain their existing money-report definitions.
- Extend payment detail with typed display status and business links. Resolve Order through the
  current checkout reaction/legacy linked Order or the amendment's owning Order; never guess an
  Order ID from a quote ID. Preserve canonical state for diagnostics. Ordinary deep-linked waiting
  records display Awaiting payment or Payment window expired, and are read-only; unresolved outcomes
  explicitly say Payment outcome unknown.
- Compute refundable balance as zero unless the canonical state is currently refundable. Continue
  subtracting successful and reserved refunds from captured funds; do not reduce reservations merely
  because a provider response is missing. Existing cancellation ownership and provider-evidence gates
  still govern REQUEST_REFUND.
- Tighten payment/refund recheck reads AND writes: require a real exhausted/stopped recovery, a usable
  provider/reference or exact existing recovery path, current authority, and no active claim. Keep
  terminal refunds eligible only when required local projection recovery actually remains. A status
  of REQUESTED/PROCESSING by itself is not manual-recheck eligibility.
- Preserve exact successful command replay before new eligibility rejection, after authentication
  and authorization. An unknown-response saved command can recover its original receipt even after
  the resource is no longer actionable. Keep original reason/body/version/key; no replacement charge.
- Reuse current provider-event and payment-reaction retry commands with their existing evidence and
  refund-exposure guards. Expose only one control for the same recovery target across grouped cases.

**Contract footprint:** update `AdminPaymentSummary`, `AdminPaymentDetail`, payment-list status
validation, the grouped attention DTO/request/page, the Admin overview metric and service manifest.
Provide GET `/api/admin/payments/attention`; use existing payment detail and recovery/refund POST
routes. Keep recovery versions/IDs in typed command context, never editable form fields. No
configurable action framework, new package, persisted UI status, or payment search product.

**Acceptance:** query membership, honest balances, grouped totals/cursors, unlinked events, actual
action availability, denied Global/location access, and all command races/replays are tested in
Core/contracts. No frontend filtering of an already paginated raw-intent response.

### PS-04 — Build the compact Payments workspace

**Deliverable:** the full usable UI with paid records and genuine attention, using existing components.

- One sidebar destination labelled Payments; no child destinations. Header: Payments. Under it, two
  accessible tabs: Payments and Needs attention, with a nonzero attention count only on the latter.
  Do not add summary metric cards, charts, explanatory dashboard panels or All attempts.
- Payments table columns: Customer, Order, Status, Amount, Refunded, Date created. Use readable
  customer name/email according to existing authorized data; render Deleted customer for a retired
  identity instead of a tombstone email. Linked Order number is a real navigation link. Keep a
  keyboard-focusable View payment control; row selection opens the same pane. Nested links keep
  their own behavior. Omit internal purpose enums and an Actions column of repetitive Open links.
- Toolbar: labelled status selector (All payments, Paid, Partially refunded, Refunded) and Refresh.
  Use existing cursor pagination. No bulk actions or new search/date-filter scope. Empty states:
  "No payments received yet", "No payments match this filter", and "No payments need attention".
- Needs attention shows one compact row per Core group: customer/payment or Unmatched payment,
  specific problem, amount when known, and opened date. Selecting it opens the relevant payment or
  unmatched-issue pane. A genuinely unresolved issue with no legal command shows the concrete reason
  and available evidence, without a disabled Review resolution button.
- Reuse `AdminMasterDetailWorkspace`: full available canvas, persistent selected row, resizable
  desktop pane and mobile overlay. Reuse its existing motion, reduced-motion and focus conventions;
  no new animation dependency or custom layout system.
- Payment pane: readable identity/status; amount received, refunded and pending refunds where
  applicable; linked Order; relevant payment/refund progress; and eligible primary action. Show the
  remaining refundable amount only with the refund action. Do not label an unpaid amount as received.
- Refund opens a focused amount/reason flow with existing confirmation and exact-retry behavior.
  Status checks/recovery similarly collect a reason only when that existing reviewed action requires
  one; reveal the field after choosing the action. No always-open recovery form.
- Group attempts, provider event/reaction history, full internal IDs/versions, case history and audit
  under collapsed Technical details. Do not render empty subsections. Keep business issue summaries
  outside that disclosure. No raw provider payloads, bearer continuation URLs or tokens.
- A queued command means queued, never paid/refunded/completed. Reuse existing command-state handling,
  refresh accepted projections, and retain the original intent on lost/malformed responses. Prevent
  pane close, record/tab replacement or a conflicting new mutation while the saved command response
  is unresolved; preserve existing recovery across supported reload behavior.
- Use the established server initial-read pattern with a plain Core DTO and a client workspace for
  interaction. Browser API reads handle filter/page changes, selection and refresh. Ignore outdated
  requests on rapid selection/filter changes. Unauthorized/unavailable reads are not empty lists.

**URL contract:** `/admin/payments` is the default paid list; `?tab=attention` selects attention;
`status=paid|partially-refunded|refunded`, `cursor`, and `payment=<id>` preserve list/selection state.
For an unmatched issue, use `issue=<groupKey>` on the attention view. Payment and issue selections are
mutually exclusive. Browser back/forward restores the selection and filters. A retained deep link to
an ordinary unpaid attempt may open its read-only detail but never adds an unpaid collection view.

**Acceptance:** 1440px and 390px journeys verify both tabs, empty/error/loading states, focus and
keyboard selection, correct row/Order link behavior, responsive pane, stable filters/back navigation,
read-only old unpaid links, valid refund/retry flows, and loss of a command response.

### PS-05 — Remove the obsolete surfaces and reconcile guidance

- Redirect `/admin/payments/overview` and `/admin/payments/transactions` to `/admin/payments`;
  `/admin/payments/reconciliation` to `/admin/payments?tab=attention`; both historical payment detail
  URL shapes to `/admin/payments?payment=<id>`. Retain recognized paid-status filters where valid;
  unsupported old unpaid filters fall back to the paid list, never resurrect All attempts.
- Update navigation, overview links, Order/customer payment links and tests. Redirect page URLs for
  bookmarks; remove unused overview and raw-case-list APIs/types/components after all repository
  consumers move. Keep live recovery/refund commands and their relevant evidence; delete a manual
  case-close UI/API only after automatic completion handles its existing required cleanup paths.
- A small internal completion operation may replace the old staff resolver; do not retain an unused
  staff endpoint solely for compatibility. Preserve recorded immutable receipts and audit rows.
- Update API_CONTRACTS, STATE_MACHINES and DATA_MODEL for lookup completion, Core attention, automatic
  case resolution and the retained nonterminal late-payment behavior. Mark the PRODUCT/DESIGN
  supplement implemented only with evidence; it currently records approved intent.
- Search for remaining `Requires action`, `ACTION_REQUIRED_PAYMENTS`, raw payment enums, obsolete
  payment navigation and resolution buttons on Admin surfaces. Customer payment-action wording is
  separate and must not be globally removed. Preserve all unrelated finance/Order behavior.

**Acceptance:** no removed destination is still advertised; existing links work; there is one
attention definition; ordinary unpaid attempts cannot be rediscovered through a leftover Admin
collection endpoint; repository typechecks and boundary checks pass.

### PS-06 — Integrated acceptance and handoff

Run focused checks during each sequence; run the aggregate once after the final integrated change.
Do not overlap Core suites with the managed browser stack or edit source during browser acceptance.

Starting commands (from repository root; test paths after the package selector are package-relative):

```powershell
pnpm --filter @freshmarkets/core test src/payments/application/reconcile-stuck-payments.integration.test.ts src/payments/application/reconciliation.integration.test.ts src/payments/application/resolve-reconciliation-case.integration.test.ts src/admin/application/admin-finance.integration.test.ts
pnpm --filter @freshmarkets/core test src/payments/application/reconcile-refunds.integration.test.ts src/payments/application/refund.integration.test.ts src/payments/application/retry-payment-reaction.integration.test.ts src/payments/application/retry-provider-event.integration.test.ts src/scheduling/payments-redrive.integration.test.ts
pnpm --filter @freshmarkets/contracts test
pnpm --filter @freshmarkets/web test
pnpm typecheck
pnpm architecture:check
```

Add the new focused completion/attention test files to those runs. Update the existing browser
payment/refund/reconciliation suites to the new product behavior; preserve their failure/race intent.
Create `apps/web/tests/payments-simplification.spec.ts` for the combined visible workflow. Run it with
the existing payment-lookup, refund-recovery, reaction-retry, reconciliation-resolution and
refunded-commitment-resolution journeys.

Use the existing managed browser harness only against an isolated local fixture. Its state preparer
may reset the named test state: confirm its resolved path before running it, and never point it at
ordinary local, staging or production state. Prefer the already designated disposable
`e2e-commerce-alignment-20260907` state after confirming no concurrent stack is using it. Do not reuse
the authenticated production browser as a financial test fixture. Example once that check passes:

```powershell
$env:E2E_START_STACK = '1'
$env:E2E_STATE_NAME = 'e2e-commerce-alignment-20260907'
pnpm --filter @freshmarkets/web test:e2e payments-simplification.spec.ts payment-lookup-recovery.spec.ts refund-recovery.spec.ts payment-reaction-retry.spec.ts reconciliation-resolution.spec.ts refunded-commitment-resolution.spec.ts
Remove-Item Env:E2E_START_STACK
Remove-Item Env:E2E_STATE_NAME
pnpm check
git diff --check
```

Restore any pre-existing environment values instead of deleting them if they were set before the run.
The provider-gateway opt-in, if required by an existing signed-event journey, remains local-only and
must use the harness's documented configuration. Do not substitute production provider traffic.

### Required integrated matrix

| Case | Required proof |
| --- | --- |
| Active waiting then expired unpaid | No staff work; final provider check concludes internally; canonical state remains compatible with later confirmation |
| One-hour boundary and QR renewal | Existing up-to-30-minute QR replacement works within the original one-hour continuation; no 24-hour change or automatic new payment |
| Late/duplicate paid event | Captured money remains visible; one Order/addition and one set of business effects; no second charge |
| Expired plus provider unavailable / missing reference | No fabricated failure/nonpayment; one genuine unresolved issue after bounded recovery |
| Copied/legacy records of unknown provider mode | Never infer mode or resolution from age/customer name; no production cleanup assertion without provider evidence |
| Eight raw cases for six payment identities | At most six linked attention rows; count/list agree, with separate unmatched-event groups where present |
| Resolved cases and refunded uncommitted work | All owning effects and audits complete before automatic closure; replay and multiple-case identities are safe |
| Ignored writes, stale versions and races | Rejection leaves no partial financial/business effects, false audit-success or success receipt |
| Unpaid refund math; captured budget | Zero unpaid refundable balance; reserved/successful refunds still constrain concurrent requests |
| Read-only staff and location scope | Core preserves Global finance authorization; denied access is honest and direct POSTs cannot bypass it |
| UI/deep links/response loss | Correct paid-only list and grouped attention at both widths; diagnostics collapsed; saved command retries identical request |

At completion, record exact commands/results and revision, browser acceptance and its fixture limits,
remaining actual-provider acceptance, and counts at the six-sequence level. Review and stage only
intended files, commit directly to `main`, run `git push origin main`, and update the checkpoint.
Do not call this production-accepted merely because local tests pass. Deployment, any retained-data
provider verification and live provider transactions remain separate authorized work.

## 4. Execution prompt

Use this only when the owner requests implementation with Sol 5.6 Medium:

> Implement `docs/product/PAYMENTS_SIMPLIFICATION_PLAN.md` as PAYMENTS-SIMPLIFY-1, continuing Commerce
> Alignment Phase 7 — Complete journeys and activation evidence. Read AGENTS.md and the latest active
> checkpoint first. Recheck branch/HEAD and preserve unrelated changes. Execute PS-01 through PS-06
> sequentially with no subagents and no routine approval pauses. The plan's latest rules override the
> earlier conversational All attempts proposal: only Payments and Needs attention, keep the one-hour
> window, and preserve delayed financial confirmation. Complete backend recovery, automatic case
> resolution, typed reads/command guards and the simplified UI together; do not stop at hiding rows.
> Run the specified focused and integrated checks, update the checkpoint and owning specifications,
> review/stage intended work, commit to main and push origin main. Do not deploy, purge data, change
> model/settings or perform real provider transactions. Report completed sequence IDs, actual test
> evidence and remaining acceptance obligations.
