# FreshMarkets — Fulfillment and Dispatch Alignment

Prepared: 22 September 2026
Suggested repository path: `docs/product/FULFILLMENT_DISPATCH_ALIGNMENT_PLAN.md`
Execution IDs: `FDP-0` through `FDP-6`
Source baseline: `kezuflow/grocery-app` at `3e928cea43f7e7ce505177a61036b7d56e4fc7bb`
Status: implementation plan; no implementation, test execution or deployment is claimed.

## 1. Owner decision and required outcome

The owner has explicitly confirmed that **Manual and Lalamove are normal delivery options for BOTH Instant and Scheduled orders. Authorized staff/admin choose either at dispatch, at their discretion. Manual is not a fallback that requires a failed Lalamove attempt.** Do not ask the owner to decide this again.

The requested ordinary journey is:

```text
Verified payment → committed order assigned to Central Cebu
→ visible in Central Cebu Orders + new-paid-order notification
→ staff opens the order and checks its items/goods
→ preparation and packing
→ Packed / Ready for pickup
→ Delivery / Ready to dispatch
→ staff chooses Request Lalamove OR Assign manual rider
→ rider confirmed → recorded handover → delivered
```

Central Cebu is the example location, not a hard-coded location ID. The same implementation must work for any authorized fulfillment location. One order moves between operational views; do not copy an order into new queue tables.

Instant and Scheduled share the operating experience. Preserve the differences in supply source, cutoff/cancellation rules, preparation timing and delivery commitment. A paid Scheduled order is visible immediately even when it is not yet actionable for preparation.

### Boundary of this plan

This is an execution plan, not another independent product-policy authority. Record the owner's correction in `PRODUCT.md`, and reconcile the affected state, API, data and design specifications as implementation proceeds. Preserve the protected discussion and historical evidence. Later explicit owner instructions supersede this plan.

If this file is being reviewed only, do not implement code. When the owner invokes implementation, follow the requested slice range and the repository's current execution/Git rules. This plan grants no authority to deploy, change production data, perform real courier/payment transactions or send outbound messages.

## 2. Non-negotiable invariants

1. **Payment authority:** only verified canonical payment evidence and the committed Payment-to-Order link establish a paid order. Browser success, notifications and status buttons cannot create that authority. Duplicate callbacks/reactions must not create duplicate orders or fulfillment effects.
2. **Scope:** staff access and every mutation are checked in Core for the actual owning location. Location operators do not gain global payment/refund/customer access merely to view or prepare an order. Never trust the location selector or a client-supplied location ID alone.
3. **Stock:** Instant uses its held/reserved physical goods. Scheduled uses exact paid demand and received cycle/location allocations. Do not net Scheduled demand against Instant stock, consume either source twice, or remove guards to make packing succeed.
4. **Preparation:** preserve the existing picking/packing state vocabulary where possible. Ordinary preparation commands end at `PACKED`. Do not introduce a second independently editable display status.
5. **Dispatch:** creating an internal `delivery_job` when payment commits is allowed and is not an external booking. New first dispatches require packed goods, eligible paid-order state, current scoped authority, no conflicting active/uncertain execution, and the existing valid delivery-time conditions. No automatic first Lalamove booking at payment, picking, packing start or packing completion.
6. **Choice:** both methods are first-class choices for both modes. Do not require a courier failure, exception escalation or discretionary approval for an ordinary manual assignment. Required identity/contact and automatic audit evidence are not optional safeguards.
7. **One execution owner:** concurrent Manual/Lalamove submissions must have one winner. An unknown provider outcome is not a failed booking. Do not permit method switching or replacement booking while the earlier external outcome/custody remains unresolved.
8. **Custody:** rider assignment is not handover, and handover is not delivery completion. Delivery-owned commands/verified provider observations coordinate Order, Fulfillment, Delivery and required notification/audit changes. A late event must not roll a terminal result backward.
9. **Money and promise:** preserve paid totals, addresses, item snapshots and customer commitments. Record actual execution method separately from the quoted courier. Do not invent a surcharge, delivery-fee refund or new refund policy when staff choose Manual. Do not show Lalamove tracking for a manual delivery.
10. **Recovery:** retain idempotency receipts, provider inbox/intent, attempt history, optimistic concurrency checks, ledger and audit evidence. A zero-row conditional D1 write must not leave partial success. Do not erase historical or in-flight work to implement a simpler new path.

These invariants apply to every slice. Scheduling and availability eligibility remain server decisions, never browser-only disabled buttons.

## 3. Reading route and execution discipline

Read `AGENTS.md`, the current entry in `docs/operations/checkpoints/COMMERCE_ALIGNMENT_EXECUTION.md`, this brief, and only the owning specification sections needed for the active slice. Follow the existing commerce continuation routing. Do not reload all archived plans or conduct another broad architecture audit.

Inspect branch, HEAD, staged/unstaged changes and untracked files before editing. The cited baseline is evidence, not an instruction to reset. If HEAD has advanced, inspect the relevant changes and preserve unrelated work. Confirm a suspected defect against current callers and tests before modifying it.

Use one active coding session/agent. Work in dependency order: `FDP-0 → FDP-1 → FDP-2 → FDP-3 → FDP-4 → FDP-5 → FDP-6`. A slice may use smaller cohesive patches; this is not permission to leave its contract, command and UI permanently inconsistent.

For each slice: reproduce or characterize the current behavior, implement the smallest complete change, run targeted checks, inspect the diff, update the existing checkpoint and report the next action. Do not remove failing assertions, weaken authorization, swallow failures or replace real persistence tests with mocks.

Keep progress in the existing checkpoint rather than creating competing TODO files. Suggested current-entry fields:

```text
Plan / active task ID:
Actual HEAD and working-tree scope:
Approved behavior implemented:
Changed files and affected commands:
Executed checks and exact results:
Outstanding failure / external acceptance limitation:
Next concrete action:
```

Keep this entry compact; retain useful older evidence in its existing history. Read summaries do not replace inspection of the code being changed.

## 4. FDP-0 — Reconcile policy and freeze the implementation boundaries

**Recommended model:** Sol High.
**Dependencies:** none.
**Output:** corrected owning specifications, a scoped implementation map and reproducible acceptance cases; not another long architecture report.

Record the confirmed dispatch decision in `PRODUCT.md`. Explicitly supersede the conflicting rules for automatic Instant booking, Scheduled-only manual eligibility, and ordinary pre-packed booking/assignment. Preserve existing paid quotes, accepted provider attempts and recovery obligations. Update active technical references so they do not instruct a later agent to rebuild those superseded rules.

Trace the reachable path for payment commitment, preparation, both dispatch methods, provider refresh/webhook/recovery and the relevant UI endpoints. Search all references to the automatic Instant booking helper and Scheduled-only manual guards, including scheduler and alternate RPC entry points. Identify schema triggers or constraints that also enforce the old policy before proposing a migration.

Define the shared dispatch eligibility result and location-order read contract before UI work. Prefer a small policy with named blockers over a configurable workflow engine. Both the read model and the command must implement the same meaning; commands must additionally revalidate transactionally.

Separate location-operational order detail from global finance authorization. Decide which existing capability grants operational order reading, and document that decision. Never globally relax `resolveFinanceAdministrationAccess`.

Preserve the existing fulfillment states for this change. Orders is the location operator's primary work entry; reuse the fulfillment queue/detail components and commands rather than creating a rival preparation system. Existing fulfillment URLs may remain compatible routes to that same workspace.

**Acceptance:** one documented new-dispatch matrix covers both modes and both methods; old policy references are explicitly superseded; current call sites and affected guards are identified; no unrelated policy is invented.

## 5. FDP-1 — Protect payment commitment and preparation/custody boundaries

**Recommended model:** Sol High.
**Dependencies:** FDP-0.
**Primary files:** payment reaction, preparation commands, manual/provider custody handlers and their owning integration tests.

### 1A. Delayed Scheduled payment confirmation

Reproduce the observed cutoff mismatch: `apply-checkout-payment-reaction.ts` checks the processing time against cutoff, while the technical policy permits completion of a legitimately started payment. Confirm current payment-admission evidence and compare the original checkout and paid-addition paths.

Prevent new payment admission at/after cutoff. Allow a valid pre-cutoff admitted payment to finish through the existing verified, idempotent commitment path after cutoff. Do not change the rule by substituting an untrusted browser timestamp or accepting every late payment. Preserve amount/currency/subject checks, refund-conflict checks and quote/entitlement evidence. Procurement must account for unresolved eligible pre-cutoff payments before treating paid demand as final; do not silently increase an already purchased requirement.

Test before, exactly at and after cutoff with an injected clock, delayed webhook, delayed reaction retry, duplicate success and conflicting refund. An unavailable legitimate entitlement remains an explicit recoverable/financial exception, not fabricated fulfillment.

### 1B. Preparation ends at packed goods

Remove ordinary generic fulfillment `HAND_OFF` and `COMPLETE` exposure and enforce the same restriction in reachable commands. Route custody changes through Delivery. Preserve historical state readability and legitimate provider/manual recovery paths.

Do not let `Cancel fulfillment` masquerade as cancellation/refund of a paid order. Use the existing coordinated cancellation/shortage resolution where available; otherwise return an actionable blocker rather than silently canceling only one record.

Keep Instant reservation consumption and Scheduled allocation consumption atomic and exactly once. Return useful stock/receiving/custody blockers instead of labeling every failed guard a stale-version conflict. Preserve idempotent replay responses.

**Acceptance:** late valid payments are either committed once or remain explicitly recoverable; no raw fulfillment command can fake handover/delivery; a packing failure rolls back all dependent effects; existing cancellation semantics remain intact.

## 6. FDP-2 — Unify staff-selected dispatch for both modes

**Recommended model:** Sol High.
**Dependencies:** FDP-1.
**Primary files:** `book-automatic-instant-deliveries.ts`, `book-order-delivery.ts`, `manage-manual-delivery.ts`, `manual-delivery.ts`, dispatch reads, application entry points and scheduled jobs.

### 2A. Shared first-dispatch eligibility

Use a shared policy for both modes: owning location, authorized actor, eligible Order, `PACKED` fulfillment, valid operational timing and absence of conflicting attempts. The execution method selects the implementation, not a different order lifecycle.

Remove the Instant prohibition from manual domain logic, command SQL, contracts/validation, tests and any current schema guards. Allow explicit first Lalamove booking for Instant as well as Scheduled; it must no longer depend on the automatic-booking path. Do not accidentally expose only an Instant retry button.

Scheduled grocery mode is not the same as a future-dated provider pickup. Once packed, request immediate or future pickup only when it satisfies the existing admitted pickup/delivery commitment. Do not dispatch a weekend order days early or invent a new lead-time rule.

### 2B. Manual is ordinary work

The form collects rider/person name and contact information, plus an optional operational note. Do not make staff explain why Lalamove failed. Preserve required audit reason storage by recording an explicit system-generated action reason such as `STAFF_SELECTED_MANUAL` where appropriate; exceptional cancellation/failure/return still keeps its required evidence.

Reuse the existing manual attempt lifecycle: assign, hand over, complete or fail. Record its actor, current version, timestamps and any existing cost evidence. Do not create rider accounts, route batches or a new rider application.

### 2C. Disable automatic first bookings without losing recovery

Remove automatic first-booking triggers at every reachable caller, not just the UI. Do not disable reconciliation for already submitted/uncertain attempts. Classify retained automatic intents: distinguish provably unsent intents from externally submitted or uncertain work. Preserve identities, audit and receipts during any required closure; do not delete them or assume no courier exists.

Legacy already-admitted pre-packed attempts remain visible and reconcile safely. The new packed-only rule governs new dispatch admission, not erasure of past authority.

### 2D. Race and timeout safety

Manual and Lalamove commands contend on the same durable job/attempt ownership. Verify one winner when two staff select different methods simultaneously. A repeated identical request replays its original receipt. New intent after definite pre-handover closure must use the existing safe retry policy. Unknown create/cancel outcomes block another execution; inspected-return requirements continue after custody transfer.

**Acceptance:** all four mode/method combinations work; no method is selected automatically; zero external calls before explicit dispatch; no overlapping execution; current and retained attempts recover without duplicate bookings or stock deductions.

## 7. FDP-3 — Build the location Orders and preparation experience

**Recommended model:** Sol Medium for implementation against FDP-0's contract; Sol High review of authorization or transactional changes.
**Dependencies:** FDP-2.

Make Orders available within an authorized location, including Central Cebu. The global commercial/finance workspace remains separately authorized. Reuse the existing order, fulfillment and delivery records. Test list, detail, direct-link and mutation access, not just navigation visibility.

Return human-readable order number, commitment time, mode, Scheduled cycle/window or Instant promise, preparation/delivery progress, relevant recipient information, purchased lines including committed additions, and safe goods-availability information. Read original labels/units/prices from paid snapshots; do not substitute today's catalog values. Avoid exposing unrestricted financial/provider details through an operational DTO.

Use a reusable order detail/drawer for review and preparation. Show each required selling quantity and exact base unit, the relevant Instant reservation or Scheduled receiving/allocation result, and current blockers. Show simple named actions rather than a generic status dropdown. A visual item checklist must not pretend to reserve/consume goods. If durable checked-item evidence is required for a command and not already present, define the smallest versioned structure rather than presenting browser-only checks as server proof.

Suggested views are New, Preparing, Ready for pickup and History, with Upcoming Scheduled work clearly separated by its existing timing/readiness. These are derived views, not new independent statuses. A Scheduled order is visible when paid but can show Awaiting receiving. Staff should not leave the order repeatedly to decode raw IDs or locate products in Inventory.

In Delivery, show Ready to dispatch, Active deliveries and Needs attention/history using the same records. Show both delivery choices for eligible packed orders. Request Lalamove must communicate searching versus actual rider assignment; Manual must show the assigned person and explicit custody actions.

Derive allowed actions from Core, including actor permissions and eligibility blockers. Revalidate on submit and handle stale versions gracefully. Keep the shell, list and selection mounted during refresh; show row/local pending indicators, not full-page loading replacements. Preserve pagination, selected location and direct links.

**Acceptance:** a location-only staff account can inspect and prepare its paid order without global finance access; both dispatch options work from the same operational journey; another location's data/actions remain unavailable; detail and lists agree after mutation.

## 8. FDP-4 — Make new orders visible without manual page refresh

**Recommended model:** Sol Medium.
**Dependencies:** FDP-3.

Reuse the existing committed-order notification identity and bell presentation. Do not create a second order event merely because a payment callback is repeated. The order list remains the source of pending work, not the bell's limited recent-activity page.

Replace full-dashboard notification polling with a lightweight scoped read/revalidation path. Proposed initial transport: visible-tab polling with a healthy-network target of roughly 5–10 seconds, refresh on focus/reconnect, and invalidation after local commands. This is a proposed UI freshness target, not a guarantee of instant delivery. Prefer existing query infrastructure; do not add a Durable Object, WebSocket service or new notification table just for this slice.

Use one shared refresh owner per selected scope rather than separate loops in the bell, Orders and Delivery. It must refresh relevant progress changed by other staff as well as new paid orders, without repeatedly loading the entire analytics overview. Preserve previous data during revalidation; cancel/ignore stale responses after account/location changes; use backoff and a visible stale/error indication when offline.

Present a notice such as `New paid order · FM-… · Central Cebu`, opening the operational order detail. Any new-order toast is browser/session-deduplicated. Opening the bell is not accepting an order. Do not claim cross-device unread/acknowledged semantics without durable support. No sound, push, SMS or new email send is required.

For a cursor-based arrivals feed, use a timestamp plus stable tie-breaker and bounded pagination that catches up safely; a latest-24 result must not be treated as proof that no other orders arrived. Do not expose private customer payloads in logs or notifications.

**Acceptance:** a newly committed paid order appears without navigation/reload; duplicate callbacks do not create duplicate notices; location/account changes cannot leak stale data; background refresh preserves UI state; network recovery reconciles authoritative current work.

## 9. FDP-5 — Targeted SQL and policy cleanup

**Recommended model:** Sol Medium; escalate changes to transaction guards/schema invariants to Sol High.
**Dependencies:** functional slices are stable.

Revalidate these candidates on the current revision before changing them:

| Candidate | Bounded change | Required evidence |
| --- | --- | --- |
| Sequential SKU/pool read inside the paid-order line loop | Fetch the needed mappings together, preserving exact paid SKU/pool meaning and transactional checks | Same committed lines/effects; fewer round trips on multi-line fixtures |
| Two latest-dispatch correlated lookups in Orders | Resolve the latest attempt once and select its fields | One row per order, correct latest attempt, no pagination distortion |
| Repeated reservation sums in packing SQL | Evaluate one per-location/pool aggregation | Identical ledger, balances and rollback behavior; useful plan/measurement improvement |
| UUID sorting in fulfillment/dispatch queues | Sort by appropriate real timestamp/deadline plus stable ID | Correct ordering and no skipped/duplicated rows with equal timestamps |
| Orders cursor uses a different timestamp from sort/filter | Align SELECT, ordering, cursor payload and comparison | Retained orders with different created/committed times paginate correctly |
| Repeated legal-action maps | Consolidate within the owning policy, not a generic engine | Read decisions and command admission agree across tested facts |
| Broad notification/overview work | Keep operational refresh narrow and indexed | Reduced work for the same scoped user-visible outcome |

Inspect actual migration-defined indexes before adding any. Use local `EXPLAIN QUERY PLAN`, representative fixtures and available D1 query metadata. Record before/after measurements; do not claim production latency improvements from source inspection alone. Do not alter or inspect production without authority.

Do not delete tables, rewrite applied migrations, flatten payment/fulfillment/delivery into one status, or remove ledger/outbox/idempotency records as cleanup. Any schema change must have a concrete dependency case, compatibility plan and fresh/retained-data tests. Prefer leaving a candidate unchanged when its benefit is unproven or it expands scope.

**Acceptance:** each retained optimization has a correctness test and measured or demonstrable reduction in redundant work; no unrelated schema rewrite is included.

## 10. FDP-6 — Integration, release-readiness review and acceptance

**Recommended model:** Sol High for a bounded final review; tests run through the repository tools.
**Dependencies:** FDP-0 through FDP-5.

Review the final diff against the owner decision and invariants, not another whole-repository audit. Revisit reachable alternate RPC, scheduler, direct URL and provider-recovery paths. Confirm no hidden auto-dispatch or Scheduled-only manual restriction survives for new work.

### Mandatory acceptance matrix

| Test | Expected outcome |
| --- | --- |
| Instant + Lalamove, Instant + Manual, Scheduled + Lalamove, Scheduled + Manual | All four complete through the normal staff journey |
| Payment succeeds | One order and required operational records exist at the assigned location |
| Paid Scheduled order before goods arrive | Visible with honest preparation blockers, no Instant stock deduction |
| Duplicate payment webhook/reaction | No duplicate order, stock effect or new-order notice identity |
| Valid pre-cutoff payment; delayed confirmation/reaction | Existing admissible commitment completes once or has explicit legitimate recovery |
| New payment at/after cutoff | Admission rejected without fabricating a paid order |
| Packing before sufficient goods / repeat packing | Blocked or idempotent; no partial or double consumption |
| Packing begins or completes | No automatic external booking |
| First dispatch before packed | Both methods rejected in Core, not only hidden in UI |
| Manual selected first | No Lalamove call and no failed-courier prerequisite |
| Two staff choose Manual/Lalamove concurrently | Exactly one durable execution owner and no duplicate courier create |
| External create/cancel times out | Original attempt remains uncertain; method replacement blocked |
| Lost response after successful manual command | Same key returns original receipt; no repeated custody effects |
| Direct generic fulfillment handover/completion call | Cannot fake Delivery custody or terminal success |
| Verified pickup/completion, duplicates and out-of-order events | Consistent legal progress; terminal evidence does not regress |
| Retained pre-packed/automatic attempt | Reconciles safely without being deleted or rebooked |
| Failed/returned delivery | Existing evidence and inspected-return/retry safeguards preserved |
| Location-only staff and tampered location/order IDs | Authorized local work succeeds; cross-location access fails |
| Equal timestamps / retained created-versus-committed difference | Stable complete pagination |
| Background refresh, reconnect and scope switch | No full-page loading churn, stale-scope leak or missed authoritative work |
| Choosing actual method different from quoted courier | Paid price/promise unchanged; actual method shown honestly |

### Verification commands

At the source baseline, the workspace uses Node >=24 and pnpm 11.0.9. Recheck `package.json` and local configuration rather than changing the toolchain by assumption. The existing scripts support:

```bash
# Select exact test files for the active slice; do not paste placeholders into a real run.
pnpm --filter @freshmarkets/core test <core-test-file>
pnpm --filter @freshmarkets/web test <web-test-file>
pnpm --filter @freshmarkets/core typecheck
pnpm --filter @freshmarkets/web typecheck

# Run relevant architecture/schema checks when those boundaries change.
pnpm architecture:check
pnpm migration:check

# Final aggregate, plus the relevant isolated local browser journeys.
pnpm check
pnpm --filter @freshmarkets/web test:e2e <local-e2e-spec>
git diff --check
```

Inspect the browser harness/environment first. Use only isolated local/disposable identities and data. Do not drive the owner's signed-in session or trigger real provider/email actions. Read the full aggregate scripts before running them in a changed environment. A failing prerequisite must be reported, not bypassed or relabeled as passed.

Run relevant Worker/D1 tests, not just mocked units. Run the complete required aggregate at the integration boundary; do not rerun the entire suite after every cosmetic edit unless repository rules require it. Tests of fake provider ports prove local handling, not real provider acceptance.

Any required Web/Core release must be coordinated because both behavior and interfaces change. Document release order, compatibility and retained intent handling. Do not deploy. Final status must distinguish implemented, locally verified, real-provider accepted and deployed.

**Definition of done:** the four ordinary journeys and safety matrix pass at a recorded revision; active docs match the implementation; no unsupported production claim is made; unresolved acceptance is named precisely.

## 11. Model and token-use protocol for the operator

Recommended sequence: **Sol High for FDP-0–2 → Sol Medium for FDP-3–5 → Sol High for FDP-6.** This is a task-risk recommendation, not a measured benchmark of these models on this repository. One-model alternative: Sol High throughout, keeping the same bounded slices.

Luna Max is optional for isolated, already-specified frontend presentation, mechanical DTO plumbing or test fixtures. For simple mechanical work, evaluate Luna Medium/High before making Max the default; higher effort is not inherently more token-efficient. Do not introduce it as another permanent orchestrator. It must not independently redesign payment admission, auth scope, stock consumption, transactional dispatch races, unknown-provider recovery or migrations. A UI task that changes one of those boundaries is no longer a low-risk UI task.

At a model/session handoff, provide the owner decision/invariants, active slice, exact HEAD, changed files, approved contracts, relevant tests and one concrete next action. Do not paste the full conversation, all source files, tool logs or historical plans. A new session may inspect the necessary callers without reopening settled product questions.

After two failed attempts at the same reproducible defect, stop speculative retries: record the failing command, expected/actual behavior and focused diff for escalation. Do not increase a budget by inventing new architecture. Use actual token/credit/cost usage per accepted slice, including review and rework, to evaluate whether a cheaper model is helping.

Keep a stable concise brief and concise checkpoint; inspect only affected source ranges. Short final prose is not a substitute for a small, correct change and executed tests. Do not modify personal model settings or launch subagents automatically.

## 12. Baseline source map

All paths below were inspected in the source review at the pinned commit; filenames are entry points, not evidence that current HEAD is unchanged. The implementer must follow real imports/callers and current tests.

| Subject | Starting paths |
| --- | --- |
| Execution authority | `AGENTS.md`; `docs/operations/checkpoints/COMMERCE_ALIGNMENT_EXECUTION.md` |
| Product/technical policy | `docs/product/PRODUCT.md`; `docs/architecture/STATE_MACHINES.md` |
| Paid commitment | `apps/core/src/orders/application/apply-checkout-payment-reaction.ts` |
| Preparation/custody exposure | `apps/core/src/operations/application/advance-fulfillment.ts`; `apps/core/src/admin/application/operations-commands.ts` |
| Fulfillment reads | `apps/core/src/fulfillment/application/list-fulfillment-queue.ts`; `apps/core/src/admin/application/operations-reads.ts` |
| Automatic courier admission | `apps/core/src/delivery/application/book-automatic-instant-deliveries.ts`; its callers in `apps/core/src/index.ts` and scheduling |
| Manual admission and custody | `apps/core/src/delivery/domain/manual-delivery.ts`; `apps/core/src/delivery/application/manage-manual-delivery.ts` |
| Delivery read policy | `apps/core/src/delivery/application/list-delivery-dispatch.ts` |
| Global Orders restriction/query duplication | `apps/core/src/admin/application/finance-administration-access.ts`; `apps/core/src/admin/application/finance-reads.ts` |
| Existing staff notification projection | `apps/core/src/admin/application/admin-notifications.ts` |
| Current preparation screen | `apps/web/app/admin/fulfillment/page.tsx` |
| Current notification refresh/UI | `apps/web/app/admin/admin-overview-provider.tsx`; `apps/web/components/admin/admin-notifications.tsx` |
| Actual verification entry points | root `package.json`; `apps/core/package.json`; `apps/web/package.json` |

Related owners to inspect only when affected: `API_CONTRACTS.md`, `DATA_MODEL.md`, `ENGINEERING.md`, `DESIGN.md`, shared contracts/validation, migrations and provider adapter tests. No conclusion that a database table/index is redundant is authorized by this map.
