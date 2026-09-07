# FreshMarkets Commerce Alignment and End-to-End Completion Plan

Saved: 2026-09-07. Status: **implementation authorized; Phase 0 in progress; no phase yet accepted**.

This document saves the owner's agreed commerce decisions and expands the earlier proposal with the missing setup, media, administration, and frontend-to-backend work requested by the owner. The coverage below is the implementation checklist; it is not a claim that every current defect has been found or that an existing screen is complete.

The canonical business documents still describe parts of the previous model. Phase 0 reconciles them before implementation. The owner decisions below supersede conflicting older planning direction; the rest of this document specifies the proposed completion work. Read [AGENTS.md](../../AGENTS.md), [coding standards](../architecture/CODING_STANDARDS.md), and [testing guidance](../architecture/TESTING.md). The owner has authorized implementation in dependency order. This status does not establish code, schema, provider or deployment acceptance.

## 1. Agreed decisions

| Area                        | Decision                                                                                                                                                                                                                      |
| --------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Instant                     | Authenticated pay-as-you-go, backed by stock and checkout holds/reservations at the resolved fulfillment location.                                                                                                            |
| Scheduled                   | Authenticated pay-as-you-go preorder. Aggregate paid demand at cutoff, buy after cutoff, receive, pack, and deliver. No physical-stock check, deduction, incoming-stock netting, safety buffer, or cycle/order capacity.      |
| Membership                  | Remove active membership requirements, enrollment, trials, membership pricing, recurring billing, and membership-only promotion rules. The owner reports no live subscriptions.                                               |
| Global mode                 | One versioned global Instant/Scheduled mode and a separate Open/Paused selling switch. Switch while paused; preserve committed orders and reconcile payments already initiated. Weekly remains the initial Scheduled cadence. |
| Customer delivery fee       | Lalamove supplies the checkout quotation in both modes. Preserve the accepted customer fee; record actual courier/manual cost and variance separately. FreshMarkets absorbs increases and retains decreases.                  |
| Courier choice              | Customer accepts FreshMarkets' delivery promise and, for Scheduled, a window. The customer chooses neither a courier nor a fulfillment hub.                                                                                   |
| Execution                   | Lalamove is default. Manual delivery is an emergency fallback for Scheduled only. No Rider app/accounts, fleet capacity, batches, route planning, or live-driver map.                                                         |
| Booking                     | During preparation: Instant after all items are picked/checked and final packing has started; Scheduled future pickup after purchased goods are received/checked with a credible packing-ready time.                          |
| Handover                    | Always after packing is complete. Searching, assigned, out for delivery, and delivered are separate facts.                                                                                                                    |
| Catalog and price authority | Global owns products, categories, variants, media, and price writes. Prices remain exact per location/SKU and may differ by location; no fallback. Location staff can read prices and manage authorized local activation.     |
| Central inventory           | A physical central warehouse holds stock. Global dispatches quantities to sites; transit is tracked and destinations gain sellable stock only on accepted receipt. Transfers do not change prices.                            |
| Scheduled goods             | Receiving creates cycle-allocated goods, separate from Instant inventory. Inspected surplus enters physical stock only through an explicit audited release.                                                                   |
| Quantities and finances     | Fixed variants consume integer grams or pieces from shared Product pools. Money uses integer minor units and explicit currency. No new FreshMarkets Service Fee or customer processing-fee surcharge.                         |
| Schema approach             | Pre-launch redesign/rebasing is allowed when better than retaining obsolete schema. Update code/contracts/seeds/generators/verifiers/tests together; distinguish disposable environments from retained data.                  |

Lalamove quotation remains a checkout dependency even when a Scheduled order may later use manual fallback. Manual fallback solves a dispatch problem; it is not a fixed-fee checkout bypass when quotation is unavailable.

## 2. What exists and what needs completion

These observations come from the code/document review and targeted contract inspection. Recheck them at phase start; an implemented primitive is not a completed business journey.

| Surface                  | Current evidence                                                                                                                     | Work required                                                                                                                                          |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Product R2 authoring     | `uploadAdminProductMedia`, update/remove/content reads and Core-owned `product_media`/R2 handling exist.                             | Prove upload/edit/remove end to end and connect published R2 media to customer catalog reads.                                                          |
| Storefront images        | Catalog still resolves `product.image_metadata_json` into bundled `/produce/*` paths.                                                | Newly uploaded images must appear on home, category/search, product detail, and cart without a frontend rebuild.                                       |
| Promotion media          | Admin promotions expose order-discount authoring; no complete promotion-image lifecycle was found.                                   | Add R2 campaign image upload and public campaign presentation, keeping image publication separate from benefit eligibility.                            |
| Location administration  | Serviceability, seeded locations, location scopes, and pickup-profile read/upsert exist.                                             | Add Global create/edit/deactivate location, store address/map confirmation, capabilities, serviceability configuration, readiness, and scope exposure. |
| Cycle administration     | Cycle reads and downstream operations exist.                                                                                         | Add usable cycle/window creation and lifecycle setup so Scheduled does not depend on SQL seeds or manually typed IDs.                                  |
| Pricing and availability | Exact-location prices and local activation exist; local operational scope currently permits price writes.                            | Separate Global price-write authority from local activation and read access.                                                                           |
| Central transfers        | Inventory balances/ledger exist.                                                                                                     | Add central dispatch, transit, scoped receipt, discrepancy, and conservation workflows.                                                                |
| Procurement              | Aggregation/receiving primitives exist, with transition and mutation defects identified.                                             | Complete a reachable cutoff-to-purchase-to-receipt workflow and separate cycle goods.                                                                  |
| Customer and staff setup | Auth, customer/staff reads, invitations, access commands, roles/scopes exist; some invitation completion/profile paths are deferred. | Complete actual identity onboarding and permitted profile/address/support operations; do not treat an invitation row as an onboarded account.          |
| Checkout and delivery    | Substantial implementation exists, with obsolete membership/courier rules and critical audit findings.                               | Reconcile policy, fix money/stock/state defects, add Scheduled manual fallback, and verify complete customer/operator journeys.                        |

Starting evidence: [service manifest](../../packages/contracts/src/core-service.ts), [product media implementation](../../apps/core/src/admin/application/product-media.ts), [catalog image reads](../../apps/core/src/catalog/service.ts), [promotion contracts](../../packages/contracts/src/admin-promotions.ts), [customer contracts](../../packages/contracts/src/admin-customers.ts), and [catalog authorization](../../apps/core/src/admin/application/catalog-administration-access.ts).

## 3. Completion rule for every feature

Each capability below includes a usable UI, shared typed contract and validators, Core authorization/application policy, repository/storage or provider integration, honest loading/error/conflict states, and focused verification. No phase is done with only a screen, table, RPC stub, seed, or test that bypasses the workflow.

The boundary stays `Web -> typed Service Binding -> Core application command/query -> domain policy -> repository/provider`. Core owns secrets, D1, and R2. Read models supply names, versions, legal actions, and scope; operators do not enter internal IDs or expected versions manually. New commands use stable idempotency, expected versions where needed, and audit evidence.

### A. Global setup, stores, and serviceability

- Provide a Global Locations workspace to create, view, edit, activate/deactivate a central warehouse or customer fulfillment site. Preserve the market/currency/timezone relationship and explicit receiving/storage/picking/packing/dispatch capabilities.
- Add a store-address form with structured address, map search/pin confirmation, and one authoritative coordinate pair. Save provider-derived address data only under the existing permanent-finalization rules. Courier pickup uses the location coordinate, not a second conflicting coordinate field.
- Configure each dispatch site's sender name, phone, optional email, pickup instructions, operating schedule/closures, and fulfillment readiness. Keep Instant preparation/delivery promises and Scheduled window setup explicit.
- Add validated versioned service-area/zone configuration and location eligibility. Provide address-preview/testing so Global can see which site owns an address before opening selling. Retain Haversine/stable-ID assignment; stock never silently reroutes/splits the order.
- Make a newly created site appear in permitted scope selectors, price targets, transfer destinations, cycle participation, and operational queries. Staff grants remain explicit; creation does not grant every local operator access.
- Inventory-only warehouses have no customer geofence/dispatch eligibility and do not block customer fulfillment readiness for lacking packing or courier settings.
- Location edits affect future options/quotes through version revalidation. Committed commercial snapshots stay fixed; an existing delivery affected by an origin closure/change requires reviewed operational resolution, not silent address replacement.
- Deactivation blocks new assignment while retaining reads and completion/recovery for existing work. Do not hard-delete a site referenced by retained orders, stock, transfers, or audit history.

**Acceptance:** Global creates a second site from Admin, sets its address and pickup profile, configures serviceability and staff scope, and sees readiness blockers resolve. A confirmed customer address selects it correctly. No direct database edits are needed.

### B. Catalog, categories, R2 product and promotion images

- Complete Global product/category create, detail, edit, activation, ordering, variants, base consumption, shipping grams, and media management. Local views use the same catalog records rather than copied products.
- Use one Core-owned R2 bucket for product and promotion images initially, reusing the existing `PRODUCT_MEDIA` binding with separate owner namespaces and typed attachment metadata. Credentials and raw object keys never become browser authority.
- Reuse the product uploader's bounded JPEG/PNG/WebP baseline (5 MiB maximum) for campaign images: client preview/progress/errors plus Core MIME/signature/size, owner/scope, alt text, ordering, version, and idempotency validation. Core generates object keys.
- Product media supports primary image, ordering, replacement and removal. Promotion media supports one primary campaign image with replacement/removal and accessible alt text. Promotion text/benefit data remains structured, not embedded only in an image.
- Complete public image delivery through a same-origin Web media adapter backed by a Core-authorized published-media read. Anonymous customers can see published catalog/campaign images; draft/inactive media and private provider evidence remain protected. Use opaque media identity/version, bounded caching, ETags, and explicit invalidation on replacement/deactivation.
- Make home, search/category, product detail and cart consume Core's canonical R2 media. Replace bundled-image authority; migrate needed development images or use explicit placeholders during the pre-launch reset. Do not require shipping a new frontend build for each upload.
- D1 owns attachment/publication metadata. Handle failed metadata attachment, failed object cleanup, replacement races, and retry without orphaned active records or fabricated success. Pending cleanup is observable and retryable through existing recovery infrastructure.
- Complete promotion create/preview/activate/deactivate, dates, targets, usage limits, merchandise benefits and delivery discounts with the existing one-merchandise-plus-one-delivery stacking policy. Images do not make an expired/ineligible campaign applicable.

**Acceptance:** Upload a new product image and promotion image in Admin; a fresh anonymous storefront renders them without a rebuild. Replace/remove/deactivate them and observe the correct public result. Reject oversized, disguised, unauthorized, and wrong-owner uploads; verify storage/metadata recovery on failure.

### C. Global pricing and location availability

- Add an explicit Global per-location price editor/read model with currency, positive final price, effective time, and history. Require Global scope plus a dedicated price-management capability in Core.
- Permit equal prices at several sites only by writing those explicit location targets. Show missing/invalid prices as unavailable, never zero or a fallback.
- Location staff retain authorized selling-status controls and inventory views with price read-only. A direct local-role RPC price write must fail even if the UI is bypassed.
- Price/catalog/address changes invalidate stale uncommitted evidence as appropriate, while committed snapshots remain immutable. Transfers neither create a price nor activate selling automatically.

**Acceptance:** Global prices potatoes differently at Cebu and Mandaue; local staff cannot change either price. Checkout uses only the assigned site's price, and old orders keep their accepted totals.

### D. Physical warehouse inventory and transfers

- Provide warehouse opening receipt/replenishment and reasoned inventory correction through authorized commands, not manual SQL. Local adjustment remains capability/scoped and auditable; it does not grant price authority.
- Global dispatches a transfer to one destination with Product-pool quantities. Deduct source stock and create transit atomically, excluding checkout holds and committed reservations.
- Destination staff accept all or part of a transfer. Credit only accepted quantities; keep outstanding transit, damage, shortage, and reasoned discrepancy resolution visible.
- Global resolves losses or verified physical returns; no deletion reverses a dispatched transfer. Repeated dispatch/receipt must replay without duplicate movement, and simultaneous transfers cannot overspend source stock.
- Report central, local, reserved/held, transit, and non-sellable quantities separately. An administrative Global total is derived and never another physical balance.
- Initial transfer route is central warehouse to fulfillment sites; branch-to-branch transfers and automatic replenishment forecasts are deferred.

**Acceptance:** Start with 100,000 grams centrally; dispatch/receive 20,000 to Cebu and 20,000 to Mandaue. Final balances are 60,000/20,000/20,000. Include partial receipt, damage, wrong-location receipt, duplicate commands, and concurrent checkout/transfer tests.

### E. Customer and staff journeys

- Verify registration/login, Google OAuth where configured, email verification/reset, persistent cookies, logout, and disabled-principal enforcement through Web and Core.
- Complete initial Global administrator bootstrap as documented setup, then staff invitation acceptance, activation, roles and location scopes. Invitation expiry/replay and wrong-identity acceptance must be handled.
- Global customer administration supports list/detail, invitation/provisioning linked to real auth identity, updates only to approved application-owned profile/support fields, and disabling/closure. Better Auth remains the credential/session authority; recipients and delivery phone remain address-owned.
- Customer account/address book supports add/edit/deactivate saved addresses, structured instructions, phone and pin confirmation. Referenced order snapshots are not rewritten.
- Customer deletion means controlled closure/anonymization where allowed, not cascading deletion of orders/payments/audit evidence. Define the actual permitted profile fields and retention-sensitive closure policy during Phase 0; do not invent legal retention facts.
- Remove membership gates and active subscription/trial/billing navigation, commands/jobs, checkout errors, notifications, and promotional eligibility. Retain only compatibility actually required by retained environments under the pre-launch policy.

**Acceptance:** A newly registered customer with no subscription completes either mode. A newly invited local operator can handle their site and cannot access Global pricing, another site's work, or raw auth records.

### F. Cart, checkout, payments, orders and recovery

- Complete browse/search/category/product-to-cart flows with fixed variants, current exact-location availability/prices, integer quantities, clear stale/unavailable lines, and minimum pre-discount merchandise validation.
- Require a confirmed serviceable address and current cart before quoting. Present the active FreshMarkets Instant promise or Scheduled window with Lalamove-priced delivery; remove customer courier selection.
- Revalidate selling state, mode/configuration versions, address/location, local activation, price/discounts, required shipping/contact facts, provider quote and payment readiness. Instant uses exact holds; Scheduled uses cycle/window/cutoff only. Changes to accepted payment terms require explicit customer review.
- Separate pickup time from arrival promise. Scheduled quotation uses a supported future pickup; a missing/out-of-horizon quotation is unavailable, never replaced by an invented flat fee. Validate the final payable amount against the provider's supported payment constraints before initiation.
- Provider-confirmed payment commits exactly one order with immutable snapshots and Instant reservations or Scheduled demand. Resolve identical payment replay before rejecting already-applied state. Preserve payments already initiated when selling pauses or a quote later expires.
- If success cannot be fulfilled, retain the financial observation and use a visible bounded reconciliation/compensation-refund operation. Do not silently consume replacement stock after hold entitlement disappeared, fabricate a zero-value payment, or leave paid money invisible.
- Complete order detail/timeline, payment continuation/recovery, Scheduled paid additions before cutoff, coordinated cancellation/refund progress, issue reporting, reorder, and provisional printable transaction summary. Normal Instant additions remain disabled until a deadline policy is separately approved.
- Customer cancellation locks at preparation start for Instant and the earlier of cutoff/preparation for Scheduled. Refund the original payment and committed additions as one coordinated operation; prohibit independently canceling a paid addition. Record provider-cost retention only where actual documented policy permits; FreshMarkets-caused cancellation refunds the full remaining applicable set.

**Acceptance:** Exercise both modes from anonymous browse through authentication, quote, real application payment-reaction path, order detail, and recovery. Cover duplicate submit/webhook, altered price, expired hold, missing quote, cancellation races and partial refund progress without fake-success frontend paths.

### G. Scheduled cycles, purchasing and receiving

- Add Global cycle/window setup: ordering-open time, cutoff, purchase/preparation timing, pickup planning, customer delivery window, timezone, site/zone participation, and explicit lifecycle controls. No customer/order/cycle capacity is introduced.
- At cutoff aggregate committed original and paid-addition quantities, excluding accepted coordinated cancellations. Show consolidated purchase requirements with destination breakdowns. Purchase exactly the paid demand; do not subtract physical inventory or add a buffer.
- Provide the complete reachable command path: aggregate, confirm purchase, start receiving, record accepted/rejected/short quantities, resolve discrepancies, complete receiving. Validate transitions before any mutation/idempotency success.
- Keep receiving/packing quantities allocated to their cycle and destination. Supplier shortage or poor quality creates an operational exception; resolve through replacement sourcing or approved order/financial resolution, not silent substitution or fulfillment success.
- Inspected unused goods may enter physical inventory through an explicit surplus-release operation that reduces the cycle allocation and credits physical stock exactly once. Spoiled goods never become sellable.

**Acceptance:** Staff configure a cycle from Admin, customers order before cutoff, purchasing reflects exact paid quantities, received goods become packable, and scheduled fulfillment never creates phantom Instant stock. Include paid-addition/cutoff races and rejected receiving with zero partial writes.

### H. Preparation, Lalamove and Scheduled manual fallback

- Start preparation through one coordinated application operation that locks customer cancellation and validates the order is still eligible. Picking/packing are distinct from delivery assignment.
- Enable Instant booking only after all items are picked/checked and final packing starts. Enable Scheduled future pickup after goods are received/checked and a ready time is known. Staff initiate booking; no predictive dispatch engine is needed.
- Track `Finding rider`, `Assigned`, `Out for delivery`, `Delivered`, and delivery exceptions independently of fulfillment. A quote/create response is not rider acceptance. Mark packed consumes Instant stock/reservations exactly once and only cycle goods for Scheduled.
- Enforce `PACKED` before normal handover. Genuine conflicting provider pickup evidence is retained and escalated instead of discarded or used to fabricate packing; recovery reconciles physical facts through owning commands.
- Scheduled fallback records reason, available delivery person's name/phone, assignment, handover, completion/failure and actual cost where known. Core rejects manual delivery for Instant. Unknown manual cost is not assumed zero.
- Keep one active execution attempt across external/manual methods. Definite cancellation/expiry/failure must close the old attempt before replacement. Use attempt-specific merchant references and preserve all history; do not double-book while an external create/cancel outcome is uncertain.
- Route webhooks, refresh and reconciliation through the same normalized Delivery application service. Searching differs from accepted; rematching is an explicit transition. Old-attempt events cannot overwrite current work, and courier cancellation never directly cancels a paid grocery order.
- Instant no-rider resolution offers provider retry, customer-agreed revised promise, or coordinated cancellation/refund. Revised promises retain the original promise and agreement evidence; do not silently overwrite the commercial snapshot. Scheduled can additionally use manual fallback.
- Validate sender/destination/contact/coordinates, full-order shipping grams and actual provider vehicle suitability. Internal BAG/BOX is not proof that a parcel fits a motorcycle and is not automatically sent to Lalamove.

**Acceptance:** Complete Lalamove delivery for both modes and manual fallback for Scheduled. Book during packing without marking out-for-delivery; reject early handover and Instant manual calls. Exercise no-rider, definite cancel, cancel timeout, duplicate booking, driver rematch, old webhook and failed delivery.

### I. Notifications, support, observability and deployment

- Send relevant order/payment/delivery/cancellation/refund notifications from durable Core outbox facts through the existing Queue transport. Remove retired membership messaging. Email failure never changes business success.
- Complete customer issue intake and staff queues for missing/wrong/damaged/poor-quality/quantity/delivery issues, with allowed support actions and separate refund authority.
- Provide operational visibility for paid-but-uncommitted orders, missing stock, receiving/transfer discrepancies, stale packing, no rider, unknown bookings, failed refunds, media cleanup, and notification dead letters. Each exception has an owner, age, reason and legal recovery action.
- Verify environment configuration for Core D1/R2, Service Binding, auth/email, address provider, PayMongo, and Lalamove. Test local Worker behavior, sandbox account operations and production activation separately; mocks/builds are not live acceptance.
- Keep transaction summaries labeled `NOT AN OFFICIAL BIR INVOICE`. Official invoice/tax/retention policy remains an explicit launch decision requiring factual business/accounting input; never invent seller or taxpayer data.
- Plan versioned operational metrics for preparation/search/wait time, delivery punctuality, manual-fallback frequency, inventory accuracy, spoilage and actual courier variance. Contribution reporting requires recorded procurement/packaging/courier/processing costs and an approved formula; show unknown inputs as unavailable.

## 4. Audit defects to resolve before completion

These remain open until reproduced and fixed with regression evidence. The earlier review used targeted in-memory probes; re-run in the relevant Worker/D1 integration harness for acceptance.

| Finding                                                                                                 | Required repair and regression                                                                                                 |
| ------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| Multi-pool commitment collides on one ledger idempotency key.                                           | Stable per-effect identities and atomic complete order commitment; test two pools and replay.                                  |
| Packing leaves the grocery Order cancelable and stock/reservations unchanged.                           | Coordinate Order lock, fulfillment, and exactly-once consumption; test cancellation/packing race.                              |
| Courier cancellation writes grocery Order canceled without refunds.                                     | Delivery exception through owning application services; explicit coordinated Order cancellation only.                          |
| Delivered Orders still count against outstanding Instant work.                                          | Count only current operational work and verify a later order can commit.                                                       |
| Commitment can proceed after required checkout holds disappear.                                         | Validate the full entitlement set and route impossible paid commitment to recovery/compensation.                               |
| Receiving can mutate state and record idempotency success before returning an illegal-transition error. | Validate first and guard all writes/result; rejected command leaves no success effects.                                        |
| Stock adjustments ignore checkout holds; cancellation release lacks complete ledger evidence.           | Protect holds plus reservations and record each release once.                                                                  |
| Procurement approval/purchase bridge is missing or unreachable.                                         | Reach receiving through actual preceding commands, not only seeded ORDERED fixtures.                                           |
| Scheduled receiving creates physical inventory that Scheduled packing does not consume.                 | Cycle allocation and explicit inspected surplus release.                                                                       |
| Booking eligibility omits relevant Order/fulfillment prerequisites.                                     | Reject canceled/ineligible orders while allowing the agreed preparation-stage booking.                                         |
| Searching maps to assigned; webhook/refresh/inbox recovery paths diverge.                               | One normalized applying path, distinct searching state, retriable unapplied inbox records, and safe compare-and-swap recovery. |
| Warehouse readiness, pickup-versus-arrival timing, and vehicle suitability are incomplete.              | Exclude inventory-only sites; separate time promises; enforce verified payload/service constraints.                            |

## 5. Implementation sequence

Every phase includes the UI/Core/contract/storage tests for the capability it completes. Do not defer all integration until the last phase.

| Phase                                          | Deliverable and exit condition                                                                                                                                                                                                                                                                                                            |
| ---------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 0 — Canonical reconciliation and schema design | Align AGENTS, architecture/domain/states/data/contracts/scope with the agreed decisions, map real implementation gaps, define profile/closure fields and proposed capabilities, and choose a coherent pre-launch baseline/reset or retained-data upgrade strategy. Do not build atop obsolete membership/external-only/local-price rules. |
| 1 — Commerce correctness                       | Reproduce and fix payment, commitment, ledger, hold, cancellation, receiving atomicity and provider projection defects; ensure paid operations have durable recovery.                                                                                                                                                                     |
| 2 — Setup and access                           | Global/staff/customer onboarding and scoped access; location create/address/coordinates/capabilities/geofence/readiness; cycle/window authoring. New operational setup is usable without SQL.                                                                                                                                             |
| 3 — Catalog, images, promotions and pricing    | End-to-end R2 product/campaign publication, complete Global catalog and price authoring, local activation/read-only prices, promotion authoring/checkout application.                                                                                                                                                                     |
| 4 — Warehouse distribution                     | Initial stock receipt, Global dispatch, transit, local receipt, discrepancies, ledger and scope; conservation/race tests pass.                                                                                                                                                                                                            |
| 5 — Scheduled operations                       | Cutoff demand, purchase confirmation, receiving, cycle goods, shortage resolution, picking/packing and surplus release are reachable end to end.                                                                                                                                                                                          |
| 6 — Delivery and customer alignment            | Preparation-stage booking, Lalamove normalized state/reconciliation, Scheduled-only manual fallback, customer promise/courier-choice changes, and complete membership removal across frontend/backend/jobs.                                                                                                                               |
| 7 — Complete journeys and activation evidence  | Both customer modes and operator setup-to-delivery journeys, notifications/support/refunds/reorder, media failure recovery, Worker/browser/provider acceptance, and deployment/operational readiness.                                                                                                                                     |

Existing authentication/payment/stock/provider primitives should be repaired or reused where sound. No parallel commerce backend, general-purpose public API, speculative workflow engine, or internal rider fleet is introduced.

## 6. Final acceptance and explicit limits

The release-level demonstration starts with a clean, reproducible application database plus documented administrator/provider setup. Global creates warehouse and fulfillment sites, sets addresses/serviceability, onboards staff, creates products/categories, uploads product and promotion images, sets exact prices and local activation, supplies physical stock, transfers it, and creates a Scheduled cycle. Normal operational configuration then uses the frontend and Core commands rather than hand-written SQL.

Run these journeys against that setup:

1. **Instant:** customer account/address -> browse R2 images -> cart -> Lalamove-priced quote -> provider-confirmed payment -> stock reservation -> pick/check/pack with booking during packing -> packed consumption -> actual pickup -> delivered -> notification/order history.
2. **Scheduled with Lalamove:** no membership -> open window -> paid order and optional paid addition -> cutoff -> exact purchase -> receipt/cycle allocation -> pack with future pickup booking -> pickup -> delivered; no physical-stock netting or phantom Instant balance.
3. **Scheduled manual fallback:** Lalamove fails to match -> definite old-attempt closure -> manual name/phone/reason -> packed handover -> delivered/failed; accepted customer charge unchanged, no second active attempt.
4. **Exception recovery:** duplicate requests/events, missing quote/hold, stale price/version, concurrent inventory operations, failed media attachment, supplier shortage, provider timeout, cancellation/refund partial progress, no rider, and notification failure each remain visible and recoverable without duplicate money/stock/delivery effects.
5. **Permissions:** local staff cannot change prices, write Global catalog, receive another site's transfer, manufacture customer identity, or bypass fulfillment/manual-mode guards through direct Core calls.

Use [TESTING.md](../architecture/TESTING.md) for actual commands: relevant contracts/Core/Web tests, Worker/D1 integration, type/lint/convention checks, clean-schema verification, builds/vinext compatibility, executed Playwright flows, and separately recorded Lalamove/PayMongo sandbox acceptance. A listed test, mock provider, or documentation update is not completed E2E evidence.

This plan covers the identified application loop and its setup/recovery dependencies. Launch still needs factual provider credentials/account activation, operational pickup addresses/service boundaries/hours, staffed delivery promises, real catalog/prices, and approved customer support/accounting/retention policies. These are configuration/business inputs, not values an agent should invent.

Deferred: internal rider apps/maps/routes/batches, Instant manual delivery, automatic stock forecasting, branch-to-branch transfers, variable-weight settlement, automatic substitutions, customer self-service post-commit window changes, loyalty/wallet, recurring orders, and additional live markets. They are not prerequisites to call the agreed first release complete.
