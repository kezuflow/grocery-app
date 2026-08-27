# FreshMarkets Product Feature Programs

Status: APPROVED PROGRAM MAP (2026-08-26). Dependency-ordered decomposition of the approved
product rulings D1-D11 plus the delivery-instruction, order-detail/tracking, and
minimal-support decisions, reconciled into the canonical documents in the same change.
Inputs: `PRODUCT_COMPLETENESS_AUDIT.md` (accepted baseline), canonical documents, the completed
remediation program (Plans 01-07 plus Plan 08 P1 core, merged to `main` via PR #1), and current
repository reality (migrations `0001`-`0018`; Core bounded-context modules in `apps/core/src`).

This document is program authority for sequencing and decomposition only. Scope authority remains
`MVP_SCOPE.md`; runtime, contract, state, and data authority remain the canonical architecture
set named in `AGENTS.md`. Implementation has NOT started. Do not treat Plans 01-07 or the Plan 08
P1 core as unfinished; Program 1 below is the only remaining remediation scope.

Program numbering matches the references already embedded in `PRODUCT_COMPLETENESS_AUDIT.md`.

---

## Part A — Remaining Remediation Follow-On

### Program 1 — Plan 08 Completion (Composition Root, Operational Read Models, Admin/Rider UI, Playwright)

**CLASSIFICATION:** architectural (remediation completion, not a new product feature)

**LAUNCH PRIORITY:** P0 (operational correctness; prerequisite for clean integration of most later programs)

**WHY:** `IMPLEMENTATION_STATUS.md` records Plan 08's deferred remainder: Core composition-root
extraction, purpose-built operational read models, the purpose-built admin/rider screens, and
Playwright operational flows, plus the residual compatibility-symbol sweep. The existing admin/rider
pages are minimal compatibility surfaces. Completing this first minimizes merge friction and rework
for every program that adds Core modules or admin surfaces (Instant rider dispatch, order-issue
admin queue, cycle administration).

**DEPENDENCIES:** None. Starts immediately from the merged `main` baseline.

**CAN RUN IN PARALLEL WITH:** Programs 7, 8, 12, 13, 14 (bounded features that do not add Core
bounded contexts) and the design-only track of Program 5. Coordinate merge order with anything
touching `apps/core/src/index.ts`.

**AUTHORITATIVE DOCS AFFECTED:** `docs/design/admin/DESIGN.md`, `docs/design/admin/ADMIN_DESIGN.md`,
`docs/design/admin/COMPONENTS.md` (screen inventory realization); `DATA_MODEL.md`/`API_CONTRACTS.md`
only if a read model requires new persisted projections (expected: read-model queries, not schema).

**EXPECTED CODE DOMAINS:** `apps/core/src/entrypoint` (composition root), `apps/core/src/application/queries`
(read models), `apps/core/src/operations`, `apps/web` admin/rider routes, Playwright specs.

**MIGRATION LIKELY:** no (possibly `0019` only if a canonical invariant requires an operational
index; otherwise none)

**SUPERPOWERS FLOW REQUIRED:** writing-plan (the approved remediation Plan 08 already serves as
the spec); execute as reviewed TDD slices.

**ACCEPTANCE BOUNDARY:** `apps/core/src/index.ts` is a thin composition root with no inline domain
logic; admin/rider surfaces consume purpose-built scoped read models and commands (no raw rows);
cycle administration, fulfillment, delivery, and inventory exception queues are operable end to
end; Playwright covers staff login, cycle administration, order exception handling, and rider job
flows; residual compatibility-symbol sweep finds no legacy `/api/operations` or `advanceOrder`
references; full verification gates (`pnpm check`, vinext, builds) pass.

---

## Part B — Launch-Critical Architectural Programs

### Program 2 — Scheduled Jobs & Reconciliation

**CLASSIFICATION:** architectural

**LAUNCH PRIORITY:** P0 (operational and financial correctness: expiry, cutoffs, dunning, reconciliation)

**WHY:** D4 approves Cloudflare Cron Triggers as the time-driven mechanism with an explicit
job-registry boundary. Today, checkout-expiry reconciliation runs only inline before checkout, and
cycle cutoff/closeout, scheduled cancellation, dunning, and provider redrive have no time-driven
owner. This program is the operational backbone Programs 3, 5, and 6 schedule against.

**DEPENDENCIES:** Program 1 composition root (strongly recommended first; not a hard blocker).
Consumes existing idempotent commands: hold-expiry reconciliation utility, `ReachCycleCutoff`,
`CloseCycle`, `ApplyScheduledSubscriptionCancellation`, provider reconciliation utilities.

**CAN RUN IN PARALLEL WITH:** Programs 7, 8, 9, 11, 12, 13, 14 and Program 5 design work; Program 4
provider selection/verification (independent tracks).

**AUTHORITATIVE DOCS AFFECTED:** `ARCHITECTURE.md` (already amended: Cron Triggers section),
`DATA_MODEL.md` (job-run/outbox persistence), `API_CONTRACTS.md` (admin job-status read model only).

**EXPECTED CODE DOMAINS:** `apps/core/src/entrypoint/scheduled`, new scheduled-job registry module,
`apps/core/src/commerce/reconciliation.ts`, cycle/membership command modules, wrangler cron config.

**MIGRATION LIKELY:** yes (`0019+`: scheduled job run/registry tables; domain-event writer if the
outbox is included)

**SUPERPOWERS FLOW REQUIRED:** full flow — brainstorm → spec → writing-plan → TDD slices.

**ACCEPTANCE BOUNDARY:** `scheduled()` contains zero business policy and dispatches only through
the registry; every registered job invokes an existing idempotent command with its normal
authorization/idempotency/version semantics; missed/duplicate cron fires are safe (job-run records
prove at-least-once with no double effects); hold expiry, cycle cutoff/advancement/closeout, and
scheduled cancellation execute correctly from a Worker-local cron harness; job outcomes are
observable (last run, status, failure visibility) without exposing internals publicly.

### Program 3 — Membership Renewal / Trial Conversion / Dunning

**CLASSIFICATION:** architectural

**LAUNCH PRIORITY:** OPEN OWNER DECISION (production recurring charging is unapproved)

**WHY:** D2 approves the full policy, now canonical in `STATE_MACHINES.md`/`DOMAIN_MODEL.md`:
recurring-capable authorization before trial activation (no ₱0 payment), first paid charge at
`trialEndsAt`, `PAST_DUE` with 7-calendar-day grace preserving entitlement/checkout eligibility,
verified recovery to `ACTIVE`, grace exhaustion to `EXPIRED`, cancel-during-grace to immediate
terminal `CANCELED`, and the nominal billing anchor across short-month clamping. D3 approves the
abuse baseline. The seams from remediation Plans 05/06 exist, but production automatic charging,
retry ownership, and retry cadence are not approved.

**DEPENDENCIES:** Explicit owner approval of a production recurring provider, mandate semantics,
charge initiation, retry ownership/timing, and recovery policy. Program 2 supplies neutral
scheduling mechanics and Program 4 supplies the future adapter boundary only after that approval.

**CAN RUN IN PARALLEL WITH:** Programs 5 (design + non-payment slices), 7, 8, 9, 10, 11, 12, 13, 14.

**AUTHORITATIVE DOCS AFFECTED:** `STATE_MACHINES.md`, `DOMAIN_MODEL.md`, `MVP_SCOPE.md` (already
amended in the reconciliation change); `DATA_MODEL.md` and `API_CONTRACTS.md` when the dunning
fields, renewal-attempt records, authorization-identity abuse prevention, and customer-facing
grace/retry status surface are specified.

**EXPECTED CODE DOMAINS:** `apps/core/src/membership`, `apps/core/src/payments` (authorization /
recurring capability), `apps/core/src/promotions` (trial-abuse identity hooks), Web
account/subscription surfaces, contracts.

**MIGRATION LIKELY:** yes (`0019+`: dunning/grace metadata, renewal attempts, billing anchor
fields, authorization-identity for abuse prevention)

**SUPERPOWERS FLOW REQUIRED:** full flow — brainstorm → spec → writing-plan → TDD slices.

**ACCEPTANCE BOUNDARY:** currently open. Mock tests may prove authorization and lifecycle seams,
but production acceptance additionally requires owner-approved mandate/charge/retry semantics and a
real signed-provider integration. No mock scheduler result counts as production recurring evidence.

### Program 4 — Production Payment Provider Readiness

**CLASSIFICATION:** architectural

**LAUNCH PRIORITY:** P0 (hard launch gate: live checkout fails closed without it)

**WHY:** Only the deterministic mock provider is approved; production checkout fails closed by design. Requires
the selected Philippine provider with signed webhooks, canonical state translation, refunds,
reconciliation, and verified recurring-capability for membership (D2/D3 dependency). Includes the
already-blockered provider-integration specification that finalizes exact renewal/retry behavior.

**DEPENDENCIES:** Human provider selection (see Remaining Human Decisions). Program 2 for
reconciliation/redrive scheduling. Mock containment work from remediation Plan 02 is the seam.

**CAN RUN IN PARALLEL WITH:** Programs 1 (after its first slices), 2, 5 (design), 6 (render/queue
side), 7, 8, 9, 10, 11, 12, 13, 14.

**AUTHORITATIVE DOCS AFFECTED:** `ARCHITECTURE.md` (provider adapter boundary), `API_CONTRACTS.md`
(payment flows), `DATA_MODEL.md` (provider mappings), plus the new provider integration
specification document.

**EXPECTED CODE DOMAINS:** `apps/core/src/payments` (adapter, webhook ingress verification, refund
mapping, reconciliation), wrangler secrets/config, Web payment return/recovery surfaces, contracts.

**MIGRATION LIKELY:** unknown (likely small: provider configuration/mappings; core tables from
`0016` already provider-neutral)

**SUPERPOWERS FLOW REQUIRED:** full flow — brainstorm → provider integration spec → writing-plan →
TDD slices (contract tests against deterministic provider simulations).

**ACCEPTANCE BOUNDARY:** live-configured Core passes the proven business loop end to end with real
provider test configuration; webhook ingress verifies signatures, dedupes by
`(provider, providerEventId)`, and never trusts client `expectedVersion`; captured/success maps to
canonical `SUCCEEDED` and nothing weaker commits membership or orders; refunds are
provider-confirmed only; reconciliation detects and resolves drift; recurring capability is
verified and documented in the integration spec (deciding Program 3 retry ownership); secrets never
appear in logs; fail-closed behavior preserved outside production configuration.

### Program 5 — Instant Mode

**CLASSIFICATION:** architectural

**LAUNCH PRIORITY:** Launch (first-class product mode per D1; launch-critical customer experience
where enabled, but not a financial-correctness blocker)

**WHY:** D1 confirms `INSTANT` as a first-class mode, never a fake Scheduled cycle. It requires a
dedicated product/UX/domain design covering serviceability, current sellable inventory,
promise/ETA, capacity/rider supply, delivery fee policy, reservation/hold behavior, preparation,
cancellation stages, payment/commitment timing, rider dispatch, customer tracking, and failed
delivery. Shared commerce primitives are reused; mode-specific policies stay explicit. The audit
found instant-specific promise/fee configuration, rider-supply capacity, and cancellation-stage
policy open. Instant may be operationally enabled/disabled per market/zone without losing
first-class status.

**DEPENDENCIES:** Approved Instant-mode design specification (brainstorm first — D1 mandates it).
Program 2 (expiring-hold expiry scheduling, dispatch follow-up). Program 4 for real payment at
launch (deterministic mock suffices during build). Program 1 rider surfaces for dispatch operations (soft).

**CAN RUN IN PARALLEL WITH:** Programs 2, 3 (non-renewal slices), 4, 6, and all of Part C.

**AUTHORITATIVE DOCS AFFECTED:** `DOMAIN_MODEL.md`, `STATE_MACHINES.md`, `API_CONTRACTS.md`,
`DATA_MODEL.md` (instant promise/fee/rider-supply concepts), plus the new Instant-mode design
specification under `docs/design/marketplace/`.

**EXPECTED CODE DOMAINS:** `apps/core/src/geography` (zone-level instant enablement),
`apps/core/src/checkout` (instant quote/promise/fee policy), `apps/core/src/inventory` (hold
conversion), new dispatch domain, `apps/core/src/fulfillment`/`operations` (preparation/dispatch),
Web storefront surfaces, contracts.

**MIGRATION LIKELY:** yes (`0019+`: instant promise/fee configuration, rider supply/dispatch
records, cancellation-stage policy fields)

**SUPERPOWERS FLOW REQUIRED:** full flow — brainstorm (product/UX/domain design per D1's twelve
areas) → spec → writing-plan → TDD slices.

**ACCEPTANCE BOUNDARY:** an Instant order never touches a synthetic cycle; quote carries a
mode-specific promise and fee backed by current inventory and configured rider supply; the
expiring hold converts to a reservation exactly once at commitment; cancellation stages match the
approved policy table with correct refund/entitlement effects; dispatch assigns and tracks through
explicit rider commands; failed delivery enters the specified retry/escalation path; customer
tracking shows the authoritative timeline without fabricated live GPS; disabling instant for a
zone/market cleanly renders unavailable rather than erroring; mode switch never rewrites committed
Order snapshots; Playwright covers the Instant happy path plus cutoff/hold-expiry/out-of-stock
states.

### Program 6 — Transactional Notifications

**CLASSIFICATION:** architectural

**LAUNCH PRIORITY:** Launch (D5 minimal email set)

**WHY:** D5 approves email-first transactional notifications as launch scope: order confirmed;
payment action required; payment failed; Scheduled cutoff reminder; out for delivery; delivered;
failed delivery; renewal payment failed/action required; introductory trial ending; upcoming first
paid renewal. Notifications are side effects only; the authoritative timeline/state remains the
source of truth. The Notifications bounded context is now recorded in `ARCHITECTURE.md`.

**DEPENDENCIES:** Program 2 for scheduled sends (cutoff reminders, trial-ending/upcoming-renewal,
dunning notices). Programs 3/4 for the renewal/dunning trigger events to exist. Email provider
selection (human). Inline dispatch (no Queues) per the amended Queues clarification.

**CAN RUN IN PARALLEL WITH:** Programs 1, 3 (build side), 4, 5, and all of Part C.

**AUTHORITATIVE DOCS AFFECTED:** `ARCHITECTURE.md` (already amended), `DOMAIN_MODEL.md`
(Notifications context semantics), `API_CONTRACTS.md` (customer notification-status read surface
if any), `DATA_MODEL.md` (outbox/attempts).

**EXPECTED CODE DOMAINS:** new `apps/core/src/notifications` context (templates, render, dispatch,
attempt records), email provider adapter, event-reaction subscriptions on owning contexts, Web
preference/status surfaces (minimal), contracts.

**MIGRATION LIKELY:** yes (`0019+`: notification outbox/attempt tables, template registry,
minimal preference fields)

**SUPERPOWERS FLOW REQUIRED:** full flow — brainstorm → spec → writing-plan → TDD slices.

**ACCEPTANCE BOUNDARY:** all ten launch emails render and deliver with correct deep links; sends
are triggered only by authoritative state changes through idempotent reactions; a failed send never
alters the domain outcome and is retried/visible operationally; no notification handler mutates
business state; customers can see delivery status minimally without a full preferences platform;
secrets and customer data are handled per auth redaction standards; deterministic test double keeps tests
hermetic.

---

## Part C — Bounded Launch Features

### Program 7 — Delivery Instructions

**CLASSIFICATION:** bounded

**LAUNCH PRIORITY:** Launch

**WHY:** The `notes` plumbing exists in contracts/persistence but there is no UI input, no view
exposure, and no order-snapshot preservation. The ruling requires structured PH delivery context
(building/unit, landmark, gate/guard instruction, delivery note, recipient/contact instruction),
kept out of structured Address fields, and snapshotted immutably onto committed Orders.

**DEPENDENCIES:** None hard. Rides existing address/checkout surfaces.

**CAN RUN IN PARALLEL WITH:** everything (small, isolated diff surface).

**AUTHORITATIVE DOCS AFFECTED:** `MVP_SCOPE.md` (already amended), `DATA_MODEL.md` (instruction
fields + order snapshot), `API_CONTRACTS.md` (address/quote/order DTO fields),
`docs/design/marketplace/DESIGN.md` (already amended).

**EXPECTED CODE DOMAINS:** `apps/core/src/customer` addresses, checkout quote/snapshot, Web
address/checkout forms and order views, contracts.

**MIGRATION LIKELY:** yes (`0019+`: instruction columns/JSON + order snapshot field)

**SUPERPOWERS FLOW REQUIRED:** short-form spec + single writing-plan (one or two slices).

**ACCEPTANCE BOUNDARY:** instructions captured separately from Address structure; committed Order
snapshots them; later Address edits never rewrite historical Orders; instruction text appears in
rider/fulfillment operational views; validation bounds length/content; tests prove snapshot
immutability.

### Program 8 — Product Media (R2)

**CLASSIFICATION:** bounded

**LAUNCH PRIORITY:** Launch (D6)

**WHY:** Storefront currently uses hardcoded static assets. D6 approves R2 as the canonical
product-media store: primary image, stable object key, alt text; multiple images only if the
accepted storefront design requires; basic admin upload/association or controlled import; no DAM;
no arbitrary external URLs as canonical source.

**DEPENDENCIES:** None hard. R2 binding configuration.

**CAN RUN IN PARALLEL WITH:** everything.

**AUTHORITATIVE DOCS AFFECTED:** `MVP_SCOPE.md` (already amended), `DATA_MODEL.md` (media tables),
`API_CONTRACTS.md` (media fields on catalog DTOs), `docs/design/admin/*` (upload flow).

**EXPECTED CODE DOMAINS:** `apps/core/src/catalog` media records, R2 infrastructure adapter,
admin upload route, Web image rendering, contracts, seed/import path.

**MIGRATION LIKELY:** yes (`0019+`: product media table)

**SUPERPOWERS FLOW REQUIRED:** short-form spec + writing-plan.

**ACCEPTANCE BOUNDARY:** every sellable product renders a canonical R2-backed primary image (or an
approved explicit placeholder state) with alt text; upload/association requires catalog
capability; object keys are stable and referenced through Core-validated metadata (a blob is not
attached until Core commits it); arbitrary external URLs are not the canonical source; vinext
image rendering verified; no DAM features.

### Program 9 — Order Detail / Tracking

**CLASSIFICATION:** bounded

**LAUNCH PRIORITY:** Launch

**WHY:** Order history is list-only. The ruling requires a customer Order Detail surface with an
authoritative timeline derived from Order/Fulfillment/Delivery state (amendments as separate
financial additions, next valid actions), explicitly without live rider GPS.

**DEPENDENCIES:** None hard (read model over existing tables). Entry points benefit from Program
1's read-model conventions.

**CAN RUN IN PARALLEL WITH:** everything.

**AUTHORITATIVE DOCS AFFECTED:** `MVP_SCOPE.md` (already amended), `API_CONTRACTS.md` (order
detail read model), `docs/design/marketplace/DESIGN.md` (already amended).

**EXPECTED CODE DOMAINS:** `apps/core/src/orders` read model, Web order detail route/timeline
components, contracts.

**MIGRATION LIKELY:** no (possibly a covering index)

**SUPERPOWERS FLOW REQUIRED:** short-form spec + writing-plan.

**ACCEPTANCE BOUNDARY:** route renders committed Order with immutable snapshots, payment summary,
fulfillment/delivery timeline (mode-appropriate), amendments as additions, and next valid actions
(amend/cancel request/retry payment/report issue/buy again/contact support as applicable);
unauthorized access to another customer's order is rejected; no live GPS claims; loading/empty/
error states handled; Playwright covers authenticated access.

### Program 10 — Customer Order-Issue Intake

**CLASSIFICATION:** bounded

**LAUNCH PRIORITY:** Launch (D8)

**WHY:** No intake exists. D8 approves typed issue categories (missing item, wrong item, damaged
item, poor-quality produce, quantity discrepancy, delivery issue, other + notes), separate from
Refund/Credit authorization, feeding an admin operational queue; submission never fabricates a
refund.

**DEPENDENCIES:** None hard; admin queue rides Program 1's read-model/screen conventions (soft).

**CAN RUN IN PARALLEL WITH:** everything.

**AUTHORITATIVE DOCS AFFECTED:** `MVP_SCOPE.md` (already amended), `DOMAIN_MODEL.md` (Orders/
operations ownership of issue records), `API_CONTRACTS.md`, `DATA_MODEL.md`,
`docs/design/admin/*` (queue screen).

**EXPECTED CODE DOMAINS:** new order-issue aggregate/commands in `apps/core/src/orders` or
`operations`, admin queue read model + screen, Web intake form on order detail, contracts.

**MIGRATION LIKELY:** yes (`0019+`: order_issue table + status/events)

**SUPERPOWERS FLOW REQUIRED:** short-form spec + writing-plan.

**ACCEPTANCE BOUNDARY:** customers submit typed issues against their own committed orders with
notes; issues carry status lifecycle (open → in review → resolved/dismissed) visible to the
customer; admin queue lists/filters/claims issues with scoped capability; submitting an issue
creates no refund/credit/money movement of any kind; refund authorization remains a separate
Payments/Refunds decision; audit trail records actor and resolution.

### Program 11 — Reorder / Buy Again

**CLASSIFICATION:** bounded

**LAUNCH PRIORITY:** Launch (D7)

**WHY:** Absent everywhere. D7 approves the simple flow: select a historical order, add its
currently purchasable items to the current ordinary cart at current price/catalog/
serviceability/availability; skip and report unavailable/discontinued items; never restore
historical pricing/inventory/capacity; no recurring baskets.

**DEPENDENCIES:** Soft: Program 9 (detail surface hosts the entry point; order history list also
suffices).

**CAN RUN IN PARALLEL WITH:** everything.

**AUTHORITATIVE DOCS AFFECTED:** `MVP_SCOPE.md` (already amended), `API_CONTRACTS.md` (reorder
preview/apply contract), `DOMAIN_MODEL.md` (Cart ownership note).

**EXPECTED CODE DOMAINS:** `apps/core/src/cart` reorder command/validation, Web order history/
detail actions + result reporting (added/skipped reasons), contracts.

**MIGRATION LIKELY:** no

**SUPERPOWERS FLOW REQUIRED:** short-form spec + single writing-plan.

**ACCEPTANCE BOUNDARY:** reorder preview applies current catalog/price/availability/
serviceability; skipped items are reported with explicit reasons; the result is an ordinary
current cart (no special state); historical prices/inventory/capacity never resurface; idempotent
re-submission does not duplicate items beyond cart semantics; tests prove the skip rules.

### Program 12 — Privacy / Account Closure Baseline

**CLASSIFICATION:** bounded

**LAUNCH PRIORITY:** Launch (D9)

**WHY:** Nothing exists. D9 approves the baseline: data-subject request intake, account-closure
request, request status, audit trail, disable-vs-delete-vs-anonymize distinction, retention-policy
hooks. No invented legal retention periods; exact Philippine rules remain gated on authoritative
legal/accounting confirmation. Closing authentication access must not destroy required
order/payment/audit history.

**DEPENDENCIES:** None hard (Better Auth + IAM + Customers surfaces exist from remediation).

**CAN RUN IN PARALLEL WITH:** everything.

**AUTHORITATIVE DOCS AFFECTED:** `MVP_SCOPE.md` (already amended), `DOMAIN_MODEL.md` (IAM/
Customers privacy semantics), `API_CONTRACTS.md`, `DATA_MODEL.md` (request tables, closure
metadata), `ARCHITECTURE.md` only if a retention hook changes context ownership (not expected).

**EXPECTED CODE DOMAINS:** new privacy/closure module in `apps/core/src/iam` or `customer`,
admin request-status surface, Web account closure request flow, contracts.

**MIGRATION LIKELY:** yes (`0019+`: DSR/closure request tables + closure state on customer)

**SUPERPOWERS FLOW REQUIRED:** short-form spec + writing-plan.

**ACCEPTANCE BOUNDARY:** a customer can request closure and see request status; closure disables
authentication access and marks the customer record per the disable/delete/anonymize distinction;
legally/operatorially required order/payment/audit records survive with required linkage;
retention hooks are explicit configuration seams, not invented periods; every step is auditable;
legal-specific retention values remain ungated placeholders pending authoritative confirmation.

### Program 13 — Tax / Invoicing Persistence Readiness

**CLASSIFICATION:** bounded

**LAUNCH PRIORITY:** Launch gate (readiness only; production rules legally gated)

**WHY:** D11 keeps tax/invoicing readiness as a production launch gate using BIR-compliant
invoicing terminology (not Official Receipt as the assumed primary commerce document). Additive
persistence seams approved: invoice identifier/serial, issuance timestamp, seller/taxpayer
snapshot, taxable/VAT breakdown, immutable relationship to committed Order/payment, future
external/electronic invoice references. No invented Philippine tax computation or retention rules.

**DEPENDENCIES:** None hard. Rides committed Order/payment records.

**CAN RUN IN PARALLEL WITH:** everything.

**AUTHORITATIVE DOCS AFFECTED:** `MVP_SCOPE.md` (already amended), `DATA_MODEL.md` (invoice seam
tables), `DOMAIN_MODEL.md` (Orders/finance boundary note), `API_CONTRACTS.md` (admin invoice read
surface minimal).

**EXPECTED CODE DOMAINS:** `apps/core/src/orders`/payments invoice seam records, minimal admin
read surface, contracts.

**MIGRATION LIKELY:** yes (`0019+`: invoice table + order references)

**SUPERPOWERS FLOW REQUIRED:** short-form spec + single writing-plan.

**ACCEPTANCE BOUNDARY:** invoice seams exist additively and immutably (one committed Order/payment
each, never rewritten); issuance data captures identifier/serial, timestamp, seller/taxpayer
snapshot, taxable/VAT breakdown fields, and external-reference placeholders; no tax computation
logic is added; BIR-compliant terminology is used; go-live checklist flags the authoritative
accounting/tax confirmation as an open gate.

### Program 14 — Minimal Support / Contact

**CLASSIFICATION:** bounded

**LAUNCH PRIORITY:** Launch

**WHY:** Customers need a clear route from relevant order/account surfaces to support. No customer
-service platform unless an accepted design requires one.

**DEPENDENCIES:** Soft: Program 9/10 surfaces host the entry points.

**CAN RUN IN PARALLEL WITH:** everything.

**AUTHORITATIVE DOCS AFFECTED:** `MVP_SCOPE.md` (already amended); a small design note in
`docs/design/marketplace/DESIGN.md` if a support surface is added beyond links/copy.

**EXPECTED CODE DOMAINS:** Web links/copy/surface(s), optionally a configuration-driven contact
read model; no new Core context expected.

**MIGRATION LIKELY:** no

**SUPERPOWERS FLOW REQUIRED:** short-form spec or a single writing-plan slice.

**ACCEPTANCE BOUNDARY:** every order/account error, empty, and permission state offers a working
support route; contact channel(s) are configuration-driven, not hard-coded; no ticketing/platform
machinery is built.

---

## Dependency Graph

```text
                       ┌──────────────────────────────────────────────┐
                       │ Program 1: Plan 08 completion (P0)           │
                       │ composition root, read models, admin/rider   │
                       └───────────────┬──────────────────────────────┘
                                       v
                       ┌──────────────────────────────────────────────┐
                       │ Program 2: Scheduled Jobs & Reconciliation(P0)│
                       │ cron registry, hold expiry, cutoff/closeout,  │
                       │ scheduled cancellation, redrive               │
                       └───────┬───────────────────┬──────────────────┘
                               v                   v
     ┌─────────────────────────────┐   ┌────────────────────────────────────┐
     │ Program 4: Payment Provider │   │ Program 3: Renewal / Dunning (P0)  │
     │ Readiness (P0)              │──>│ needs P2 scheduler + P4 capability │
     │ [human: provider selection] │   │ verification                       │
     └──────────┬──────────────────┘   └────────────────┬───────────────────┘
                v                                         v
     ┌─────────────────────────────────────────────────────────────────────┐
     │ Program 6: Transactional Notifications (scheduled sends need P2;     │
     │ dunning notices need P3; email provider selection is human)          │
     └─────────────────────────────────────────────────────────────────────┘

  Program 5: Instant Mode ─── design spec (brainstorm) starts immediately;
                              implementation needs spec approval + P2 (hold
                              expiry/dispatch follow-up); real payment at
                              launch via P4; rider surfaces via P1.

  Independent bounded track (any wave, mutually parallel):
  P7 Delivery Instructions   P8 Product Media (R2)   P9 Order Detail/Tracking
  P10 Order-Issue Intake     P11 Reorder            P12 Privacy Baseline
  P13 Tax/Invoice Seams      P14 Support/Contact
  (soft synergies: P9 hosts P10/P11/P14 entry points; P1 sets read-model
   conventions used by P9/P10 admin surfaces)
```

Hard sequential chains: **1 → 2 → {3 (with 4's capability verification), 6's scheduled sends}**,
**4 → 3 retry finalization → 6 dunning notices**, **5 design approval → 5 implementation**.

## Recommended Execution Order

Optimized for (1) financial correctness, (2) operational correctness, (3) launch-critical CX,
(4) minimal architectural rework, (5) safe parallel execution — explicitly not easiest-first.

1. **Wave 0 (start immediately, parallel):**
   - Program 1 slices (composition root first — every later Core program merges cleaner).
   - Program 5 design brainstorm/spec (design-only; no code).
   - Programs 7, 8, 12, 13 (isolated bounded features).
   - Human decision work: production payment/recurring policy. Cloudflare Email Service and the
     Core-only Mapbox route adapter are already selected; external onboarding remains deployment work.
2. **Wave 1:** Program 2 (scheduled jobs) — after Program 1's composition-root slices; Programs
   9, 14, and 11 join the bounded track; Program 4 adapter work begins once the provider is
   selected.
3. **Wave 2:** Program 4 can resume only after production-provider approval. Program 3
   state/command machinery remains a mock-tested seam until mandate, initiation, and retry policy
   are approved. Program 6 build side (templates, render,
   inline dispatch) proceeds; its scheduled/dunning sends activate with P2/P3.
4. **Wave 3:** Program 5 implementation (post-spec, post-P2; launch enablement after P4).
   Program 6 completion. Program 10 anytime from Wave 1 onward (independent; admin queue rides
   Program 1 conventions).
5. **Launch gate review:** Program 13 seams + accounting/tax confirmation, Program 12 legal
   confirmation, Program 4/3 financial verification, Playwright/observability evidence.

## Safe Parallelization Opportunities

| Track | Contents | Why safe |
|---|---|---|
| Bounded customer features | Programs 7, 9, 11, 14 | Disjoint Web/read-model surfaces; no Core context ownership changes |
| Bounded platform features | Programs 8, 12, 13 | New isolated tables/modules; no shared-aggregate mutation |
| Design track | Program 5 spec | Produces documents only |
| Operational backbone | Programs 1 → 2 | Sequential within itself; touches entrypoint/registry others avoid |
| Financial track | Programs 4 → 3 → (6 scheduled/dunning) | Sequential within itself; adapter + policy modules are disjoint from backbone |
| Issue intake | Program 10 | New aggregate; coordinate only admin-screen conventions with Program 1 |

Coordination rules: use separate worktrees only to isolate in-progress uncommitted work per
`TRUNK.md`; land each program's commits back on `main` promptly in dependency order; Core
bounded-context files are owned by exactly one active program at a time; land the composition
root before programs that add entrypoint registrations.

## Remaining Decisions Requiring Human Approval

1. **Production payment provider selection and recurring policy** — mandate capability, automatic
   initiation, retry ownership/timing, reconciliation, and refund behavior all require approval.
2. **Cloudflare Email Service sender onboarding** — from-domain/DNS and sender configuration gate
   deployed delivery; the provider/binding choice is settled.
3. **Default cancellation UX choice (immediate vs period-end as the customer-facing default)** —
   the policy for both modes is canonical; only the presented default remains open.
4. **Real-provider paid-success/downstream-commit recovery policy** — the mock MVP preserves the
   payment, retries the same commitment, and escalates bounded failure without automatic refund;
   future real-provider refund automation remains unapproved.
5. **Accounting/tax authority confirmation** for BIR invoice computation/retention specifics —
   D11 boundary; seams ship without it, go-live does not.
6. **Legal authority confirmation** for Philippine deletion/anonymization/financial retention
   periods — D9 boundary; hooks ship without it.
7. **Production geocoder + approved service boundaries** — Mapbox is selected only for Core route
   distance; address geocoding/polygon approval remains separate.
8. **Google OAuth production credentials + production Better Auth base URL/cookie verification** —
   pre-existing launch blocker.
9. **Instant operational go-live readiness** (rider supply, zone enablement) — an operational
   decision at launch time, not a code decision; the mode stays first-class regardless.

Resolved by ruling and no longer open: D1-D11 themselves, the post-clamp billing anchor (nominal
anchor preserved), and the renewal/dunning policy content.

## Git / Execution Policy (encoded for every program)

This repository follows trunk-based development (`TRUNK.md`): a single-developer repo where all
work lands directly on `main`. For every approved architectural feature (Programs 1-6) and each
bounded feature (Programs 7-14):

```text
brainstorm -> approved spec -> commit to main -> push origin main
-> writing-plan -> commit to main -> push
-> TDD implementation slices (worktree only to isolate uncommitted state)
-> task review -> fresh verification -> commit to main -> push
-> next slice
-> whole-feature review -> final verification -> push
```

- Every independently reviewable implementation slice receives its own coherent commit.
- Commit and push verified/accepted slices directly to `main` (`git push origin main`).
- Do not create, push, or open PRs from feature branches unless the owner explicitly approves an
  exception; `.githooks/pre-push` rejects non-`main` pushes, bypassed only with owner-approved
  `--no-verify`.
- Never force-push without explicit instruction. Do not mix unrelated dirty files into a program's
  commits.
- The Superpowers progress ledger (`PROGRESS_LEDGER.md` in this directory) must be maintained with:
  program/spec, task, status, commit SHA, verification, review result, push result, and next
  incomplete task — so any session can recover safely after context/usage limits.
- Applied migrations are immutable; each program owns the next sequential migration number
  (starting from `0019`) for its additive schema work and must not squat or reorder numbers.
- Stop at every remaining-decision gate above: implement the seam and visible exception state,
  then stop before the gated policy-specific automation.
