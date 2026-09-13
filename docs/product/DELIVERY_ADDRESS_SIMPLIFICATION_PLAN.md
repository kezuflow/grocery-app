# Delivery address simplification

Status: ADDR-1 through ADDR-4 implemented and locally verified on 2026-09-14.
PRODUCT owns the approved rule. Deployment, real courier transactions and shared
data changes remain outside this implementation.

## Outcome

Remember Deliver to through browsing and checkout. Show the confirmed address
and pin, address label (Home/Work or existing custom label), recipient name,
mobile number, and one optional Delivery instructions field. Remove separate
building/unit, landmark, gate/guard, recipient guidance, extra delivery note
and private note inputs. Customers can include useful unit/entrance details
in the single instructions field without a separate unit requirement.

## Observed baseline and preservation

Observed main at af663a18. AddressEditor currently implements a three-step
save wizard with structured address fields, five instruction fields and a
private note. DeliveryAddressDialog remembers browsing text/coordinates and
reduces saved-address selection to browsing context. Checkout bootstrap
prefers an explicit saved selection or the account default, without seeding
the editor from the current browsing destination.

Affected path: address editor/dialog and browsing-location helpers -> Web
commerce routes -> checkout/geography contracts -> Core customer address
commands -> fulfillment options/quote -> payment admission -> immutable Order
address snapshot -> delivery adapter. Reinspect exact validators and consumers
before implementation. Core owns authorization, routing and business writes.

Preserve existing dirty Admin location/map/schedule and address-prediction
files, globals.css, cart drawer/tests, storefront browser tests, checkpoint
edits and untracked measurement artifacts. Recheck status/HEAD before each
phase. No subagents. No unrelated commerce or HSPA work is closed by this plan.

## ADDR-1 — Simplify delivery details

- Replace the three-step save wizard with pin confirmation followed by one
  compact details form containing label, recipient, phone and instructions.
  Keep custom labels and add Home/Work shortcuts without relabeling old data.
- Show resolved geography as a readable address summary with Change. Keep
  geographic components internally. If lookup lacks usable address text,
  allow a single address-text correction instead of a full geographic form.
- Establish one canonical instruction value for new commands/reads. Update
  contracts, validators, Core persistence, quote construction, snapshots,
  provider ports/adapters and consumers together. Inspect retained data and
  deployed consumers before choosing a forward migration or compatibility
  reader; do not reset shared data as an incidental implementation step.
- On edit, combine existing courier-facing instruction values without loss
  or duplication. Never include private account notes. Preserve paid snapshots.
- Check provider remarks limits before setting the shared input limit; show
  validation errors instead of silently truncating delivery information.

Acceptance: save/edit with blank instructions succeeds; only one instruction
input appears; old delivery details survive editing and reach the courier
adapter once; private notes stay private; stale-version and exact-retry
behavior remain intact. Unit information is never separately required.

## ADDR-2 — Carry Deliver to into checkout

- Preserve selected saved-address identity along with browsing context; Core
  must reauthorize it. Browser context remains read-only evidence.
- Seed a new checkout address from the confirmed browsing destination and ask
  only for missing details. Reuse valid finalized evidence, never temporary
  provider text. Do not require a second search for the same destination.
- Prefer the current Deliver to choice over the account default. Use a
  default only when there is no current selection. Deleted/stale/inaccessible
  selections require explicit resolution, not a silent destination switch.
- Preserve guest destination through sign-in; scope saved identities and
  contact data to the current account. Clear private state on replacement or
  sign-out. Selecting an address does not change the account default.
- Retain payment-in-progress locks and status routing; an already-started
  payment cannot have its committed destination edited through this flow.

Acceptance: guest pin -> sign-in -> checkout retains destination; selected
Home/Work beats a different default; reload/back navigation retains selection;
account replacement cannot reuse another customer's private address data.

## ADDR-3 — Reconcile Instant cart on destination change

- Core resolves the confirmed destination under existing service-area and
  nearest-ready-location policy, then checks every cart item's local stock,
  quantity, price and promotion. No stock-based rerouting or split orders.
- Preserve unavailable rows and show specific reasons. Require explicit
  removal or quantity adjustment; block payment until resolved. No silent
  item removal or quantity reduction.
- Invalidate stale checkout acceptance and obtain a replacement courier quote
  for changed route inputs. Preserve valid-quote reuse under existing guards.
  Label/instruction changes alone do not change geographic routing.
- Reject stale asynchronous responses. Preserve atomic stock admission at
  payment, rejection without partial effects and immutable success receipts.

Acceptance: Central Cebu zucchini cart -> Mandaue without zucchini leaves the
row visible and Pay blocked; explicit removal enables a new valid total.
Cover insufficient quantities, local price changes, same-location address
changes, unserviceable pins, rapid address changes and stock lost before Pay.
Shared Scheduled address UI remains compatible without changing demand/hours.

## ADDR-4 — Verify and deliver

Run relevant contracts, Core customer/checkout/payment/delivery integration
and Web address/checkout suites with existing package scripts. Execute local
Worker/D1 ownership/version/race/atomicity acceptance and desktop/mobile
browser journeys for ADDR-1 through ADDR-3, including focus, keyboard, errors,
saved-address edit and started-payment recovery. Local provider fakes are not
actual provider acceptance; report any external gate separately.

Run pnpm check and record exact commands, tested revision and results. Record
unrelated failures honestly. Update affected API_CONTRACTS, DATA_MODEL and
DESIGN sections as interfaces are implemented; update the active checkpoint
at meaningful milestones. Review intended diffs, commit directly to main and
push origin main. Deployment/real courier transactions remain separate.

Completion: ADDR-1 through ADDR-4 are complete at the application-source level.
Contracts, Core and Web typechecks pass; contracts pass 20 files / 69 tests, Web
passes 138 / 570 and Core passes 206 / 1,671. Focused managed Worker/D1/browser
acceptance passes public destination confirmation and checkout address-change
revalidation at 1440 px and 390 px, plus saved-address search/save/edit. Both
Worker builds pass. Root `pnpm check`
stops at the pre-existing staging delivery-binding harness mismatch (`lalamove`
configured while that harness expects `disabled`); all subsequent stages were
run directly and pass. Local adapters/fakes do not establish actual Lalamove or
Grab acceptance. No deployment, real provider transaction or shared-data reset
was performed. Counting level: zero remaining ADDR implementation phases; the
remaining release gate is actual-provider/deployment acceptance when separately
authorized.
