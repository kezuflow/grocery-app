# Web to Core Application Contracts

Focused technical reference; load the sections affected by the current command or data change. Business meaning is in [PRODUCT.md](../product/PRODUCT.md); technique and verification are in [ENGINEERING.md](ENGINEERING.md). The decision reconciliation in PRODUCT identifies approved intent still needing implementation. This specification does not certify the current code. Historical source and requirement accounting are in [the GD-1 audit](../operations/GUIDANCE_REBUILD_AUDIT.md).

## Contract Principles

This document is authoritative for target Web/Core and provider-ingress application boundary semantics. Contracts live in `packages/contracts` and are shared as source/types within the monorepo. They define RPC method names, input validation, purpose-built DTOs, stable error codes, and pagination. They never export D1 row types, Better Auth table records, provider payloads, or infrastructure handles.

Domain-oriented commands in this document are the contract. Removed broad compatibility RPCs must not be reintroduced as a second business implementation.

Core owns implementation and authorization. Web owns presentation adapters. Contract changes follow the pre-launch interface policy in `ENGINEERING.md`. Update all consumers coherently and remove unused compatibility paths when safe; use additive evolution where retained deployments or temporary Web/Core version skew actually require it.

## Retired membership boundaries

New trial/enrollment, membership-offer/eligibility and recurring-authorization RPCs reject authenticated calls with `ILLEGAL_TRANSITION` and create no membership, payment or provider setup. Membership-price editing is retired. Account/marketplace pages expose ordinary shopping; old enrollment-payment/pricing pages redirect to Account/Settings. Existing subscription summaries, authorized historical administration/cancellation and financial/provider reconciliation remain for retained records. Local retirement does not assert cancellation of provider-owned billing. Trial expiry and creation of trial-ending/upcoming-renewal reminders are no longer active jobs; retained unsent reminders of those two types are canceled at delivery without deleting evidence. Unknown sends remain unresolved rather than being relabeled as canceled. Existing provider-account disposition remains separate external work.

Otherwise eligible nonempty Instant and Scheduled carts have no general spending minimum. Core still checks active market currency, exact prices, availability and delivery; spending conditions for a particular promotion affect only that promotion. Retained minimum-policy rows and historical service-fee amounts never create a new checkout fee/minimum.
## Common Envelope and Context

Conceptual RPC inputs include:

```ts
type RequestMeta = {
  requestId: string;
  idempotencyKey?: string;
  locale?: string;
  timezone?: string;
};

type PageRequest = {
  cursor?: string;
  limit?: number;
};

type AppErrorCode =
  | "UNAUTHENTICATED"
  | "FORBIDDEN"
  | "VALIDATION_FAILED"
  | "NOT_FOUND"
  | "CONFLICT"
  | "STALE_VERSION"
  | "ADDRESS_NOT_SERVICEABLE"
  | "SELLING_PAUSED"
  | "FULFILLMENT_MODE_UNAVAILABLE"
  | "CYCLE_CLOSED"
  | "INVENTORY_HOLD_EXPIRED"
  | "DELIVERY_QUOTE_UNAVAILABLE"
  | "DELIVERY_QUOTE_EXPIRED"
  | "PRICE_CHANGED"
  | "ITEM_UNAVAILABLE"
  | "PROMOTION_INELIGIBLE"
  | "PROMOTION_STACKING_CONFLICT"
  | "PAYMENT_REQUIRED"
  | "PAYMENT_FAILED"
  | "ILLEGAL_TRANSITION"
  | "IDEMPOTENCY_CONFLICT"
  | "INTERNAL_ERROR";
```

Core derives authentication/session context from the forwarded browser request/session, not from a client-supplied user ID. Administrative scope is resolved in Core from application role assignments.

Error responses contain a code, safe user-facing message/key, request ID, field details when appropriate, and optional recovery metadata such as alternate cycles. They do not expose SQL/provider internals.

Web computes one request context at the public boundary. A caller UUID may be preserved; invalid,
oversized, or non-UUID values are replaced. The selected ID is the `requestId` in the RPC input,
overrides forwarded `x-request-id`, is returned as the response header, and appears in safe error
JSON. Customer command JSON is limited to 16 KiB unless a route family documents a narrower or
larger bound; auth and payment webhooks are limited to 256 KiB, and auth responses to 1 MiB.
`415` means an unsupported content type, `413` means the declared or streamed byte limit was
exceeded, and `400` means body-read, JSON, or schema failure. Provider signatures consume the
exact bounded raw webhook text.

The runtime `coreServiceMethodNames` manifest is exhaustive with `CoreServiceBinding`. Deployment
conformance tests prove that Core implements every advertised method, advertises no missing method,
and exposes only those methods plus the Worker lifecycle.

### Liveness and readiness

- `health({ requestId? }) -> CoreHealthResponse` is liveness. It performs no D1/provider probe.
- `readiness({ requestId? }) -> CoreReadinessResponse` is traffic readiness. It reports only
  `runtimeConfiguration`, bounded `database`, and provider-neutral `paymentProvider` state.

`paymentProvider` includes `status`, configured `code`, the closed capabilities
`PAYMENT_CREATE`, `RECURRING_AUTHORIZATION`, `WEBHOOK_VERIFICATION`, `PAYMENT_LOOKUP`, and
`REFUND_REQUEST` when implemented. Missing critical capability is
`not_ready`; neither environment names nor browser state infer provider readiness. The HTTP
`/ready` adapter returns 503 for `not_ready` and preserves the request reference.

Client/application/admin lifecycle commands require a stable idempotency key and `expectedVersion` where concurrent mutation is possible. Provider webhook events are a different boundary: they require signed authenticity plus unique `(provider, providerEventId)` identity, and they never accept or invent `expectedVersion`. Core performs current-state validation and compare-and-swap internally and records retry/reconciliation state when a concurrent command wins.

## Authentication Boundary

Browser auth endpoints are public Web routes that faithfully proxy to Core's Better Auth handler. This is an HTTP-response-preserving boundary rather than ordinary JSON RPC because redirects, multiple `Set-Cookie` headers, callback URL, host/origin, and CSRF semantics must survive.

Core also exposes typed session/application context methods such as:

```ts
auth.getSessionContext(): Promise<{
  authenticated: boolean;
  authUser?: { id: string; email: string; emailVerified: boolean };
  customer?: { id: string; status: string };
  staff?: {
    id: string;
    capabilities: string[];
    scopes: Array<{ marketId?: string; locationId?: string }>;
  };
}>;
```

The DTO intentionally excludes Better Auth session tokens and password/account internals. Auth-specific operations—Google sign-in, email/password registration/login, verification, reset, logout—are handled by Better Auth through the proxy path.

## Customer and Marketplace Queries

- `marketplace.getHome({ marketHint?, addressId? }) -> MarketplaceHomeView`
- `catalog.search({ query, categoryId?, cursor?, limit? }) -> ProductSearchPage`
- `catalog.getProduct({ slug, locationId? }) -> MarketplaceProductView`
- `catalog.listCategories({ parentId? }) -> CategoryNavigationView`
- `checkout.listFulfillmentOptions({ addressId, addressVersion, cartId, cartVersion }) -> FulfillmentOptionView[]`

`MarketplaceProductView` includes customer display data and persisted fixed variants with `skuId`, display/packaging label (`500 g`, `1 pack`), optional `Pack`/`Bunch` merchandising label, integer sell quantity, controlled sell-unit code/display (`G`/`KG`/`PC`), exact integer base-unit consumption, Core-resolved media (`src` + `alt`) with ordered customer-facing product details, an approximate assembled-pack contents note, the exact resolved-location quoteable price, availability messaging, and global fulfillment context. Staff packing instructions never appear in any public DTO. It does not expose inventory ledger quantities unless a deliberate customer-facing availability field is defined. Sellable sizes are returned from database configuration, not a hard-coded union. Before location resolution the target permits general catalog browsing without fabricated local price/stock. The first-visit location flow is PRODUCT GD-D21; no Market/global fallback is allowed.

`catalog.search` applies query/category/activity/local-activation/exact-location-price predicates database-side before keyset pagination over `(category sort order, product name, product id)`; results are bounded (`limit` 1–50) and `nextCursor` is an opaque token whose malformed values return `VALIDATION_FAILED`. The complete launch catalog is reachable through cursors without truncation. `marketplace.getHome` returns active categories plus bounded category rails (default 8 items per rail, capped at 12) built from one windowed scan and the same eligibility rules as search, never materializing the full catalog into one response. Location-scoped browsing requires a resolved delivery area; checkout revalidates the confirmed customer address rather than treating a remembered browse location as authority.

`CategoryNavigationView` returns each active category's `code`, `name`, `slug`, and Core-resolved `iconSrc`. `iconSrc` is either a safe `/category-icons/<asset-key>.svg` Web path derived from database configuration or `null`; Web renders its local fallback for null and never reconstructs category taxonomy from hard-coded navigation metadata.

`FulfillmentOptionView` exposes an opaque option ID, mode, FreshMarkets promise/window and Lalamove-priced delivery amount. Scheduled exposes its configured selectable window/cadence; Instant exposes its current promise. The approved target exposes available verified courier choices without a hub selector; the opaque option binds the selected provider/service and its accepted quotation. A single available provider needs no extra selection step. Internal quotation/provider evidence remains opaque.

## Serviceability

- `geography.searchAddressCandidates({ requestId, query, proximity? }) -> AddressSearchCandidate[]`
- `geography.reverseAddressCandidate({ requestId, coordinate }) -> AddressSearchCandidate`
- `geography.confirmBrowsingLocation({ requestId, coordinate }) -> ConfirmedBrowsingLocation`
- `serviceability.resolveCoordinates({ latitude, longitude, addressComponents? }) -> ServiceabilityResult`

`AddressSearchCandidate` is provider-neutral and contains an opaque session candidate key,
display address, coordinate, structured address components, and nullable accuracy. Search
results exist only for the active interaction and may not be persisted, cached across sessions,
or logged. Temporary reverse geocoding uses the same candidate shape to fill the editor after a
customer moves the pin or selects device location; it keeps the exact customer-selected coordinate
and does not itself save the provider result. Candidate selection is not serviceability proof. Core finalizes provider-derived
coordinates under the provider's permanent-storage rules before any saved-address write.

The anonymous browsing confirmation uses `GeocoderPort.reversePermanent` (`permanent=true` for Mapbox) and re-resolves current serviceability at the selected entrance. Its minimal result contains the permanently finalized display address, confirmed coordinate and serviceability; no provider reference or raw payload. Web calls the private-body, no-store `/api/commerce/browsing-location` endpoint only on Deliver here, and remembers only successful, still-current, serviceable confirmation. Provider errors, changed coverage, editor closure and a moved selection cannot persist temporary or stale data. Search and editor pin autofill remain temporary. Browser storage uses new confirmed-location keys; old unconfirmed keys are discarded rather than migrated. This does not create a saved checkout address or waive checkout revalidation. Actual permanent-geocoding account eligibility remains an activation requirement.

`ServiceabilityResult` includes `serviceable`, stable failure reason, market/area/zone display context, active polygon versions, resolution-change detection, and a mode-aware fulfillment-eligibility summary. Internal polygon GeoJSON, location codes, mode configuration IDs, and ranking rules are never exposed. Customers do not select a location; Core filters operational candidates whose geofences contain the coordinate, selects the nearest dispatch origin by exact Haversine distance with stable location-ID tie-break, and always re-resolves at checkout. Product stock cannot select or replace the owning location.

Saved-address commands are customer-boundary operations:

- `addresses.listMine({ headers }) -> CustomerAddressView[]`
- `addresses.create({ label, recipient, phone, components, componentsSource, latitude, longitude, confirmationSource, instructions, notes?, addressJson? }) -> CustomerAddressView`
- `addresses.update({ addressId, expectedVersion, changed address fields }) -> CustomerAddressView`

`AddressComponents` contains `addressLine1`, nullable `addressLine2`, nullable `barangay`,
`city`, nullable `region`, nullable `postalCode`, and `countryCode`. `confirmationSource` is
`GEOCODER`, `USER_PIN`, or `DEVICE_LOCATION`. `DeliveryInstructions` contains nullable
`buildingUnit`, `landmark`, `gateGuard`, `deliveryNote`, and `recipientInstruction`. The
deprecated `addressJson` input is a compatibility seam only; new clients send structured
fields, and raw address JSON is never returned in `CustomerAddressView`.

Structured writes also carry component provenance independently from coordinate confirmation:
`TEMPORARY_GEOCODER`, `FIRST_PARTY`, or, for unchanged update data only, `SAVED_ADDRESS`. Core
permanently reverse-finalizes temporary provider components at the final submitted coordinate even
when that coordinate was confirmed by a user pin or device location. `USER_PIN` and
`DEVICE_LOCATION` continue to describe coordinate provenance; they never convert temporary
provider text into first-party data. An update that submits `TEMPORARY_GEOCODER` components must
therefore also submit the exact latitude/longitude pair and `confirmationSource`. Existing saved
provider components are already permanent: an unchanged `SAVED_ADDRESS` edit preserves their exact
provider reference and components without another provider call, while a location change
re-finalizes them at the new coordinate. Manual first-party components remain valid without
provider enrichment.

Core derives the customer from the Better Auth session, verifies address ownership,
and never accepts a client-selected customer or principal ID. Address updates require
`expectedVersion`; stale writes return `STALE_VERSION`. Coordinate changes re-run
authoritative serviceability resolution, while service-area, delivery-zone, resolution
version, status, and other serviceability fields are server-derived. The address view
returns recipient phone, structured components, confirmation source/time, delivery
instructions, and the persisted resolver `serviceable` outcome and failure reason. The
serviceability values are null
only for legacy rows that have not yet been authoritatively re-resolved; code presence
is never treated as proof of serviceability.

## Global Commerce Configuration

Core validates current mode/cadence policy on writes and rejects unsupported stored combinations on reads and new-commerce eligibility. Removing cadence CHECK coupling does not widen the public contract: Scheduled remains Weekly, Instant has no cadence. Promotion stacking and usage limits are likewise Core-owned; flexible benefit persistence does not widen current accepted stacks, and redemption guards share the commitment transaction. Historical service-fee configuration has no activation command or flag for new commerce.

`getGlobalCommerceConfiguration`, `pauseSelling`, `activateGlobalFulfillmentMode`, and `openSelling` require global scope and the existing fulfillment read/manage capability. Mutations require expected version, reason and stable idempotency. Mode changes require PAUSED. Readiness evaluates customer-serving locations only; inventory-only warehouses neither serve customers nor block reopening for missing courier/packing settings.

Selling-state and mode commands recheck current staff identity, Global scope and capability inside the mutation batch. The configuration, quote invalidation, audit and successful replay result commit together. Reopening rechecks mutable readiness in that same batch; switching preserves committed work and validates any concrete operational conflict, without requiring all historical Orders to finish. The reason is part of command identity, so changing it with the same key conflicts.

Global location setup uses `listAdminLocations`, `createAdminLocation`, `updateAdminLocation` and `transitionAdminLocation`. Reads require `locations.read`; commands require `locations.manage`, Global scope and a reason. Creation generates the location ID and starts inactive. Purpose, market and code are fixed after creation; detail changes and activation/deactivation require the current version. Core atomically guards current staff/grants, market and location version with capabilities, audit and exact replay result. List responses include active/inactive sites, named markets, currency/timezone, validated structured address or an explicit missing-confirmation state, coordinates and capabilities, with bounded keyset pagination. New capabilities are explicit role grants, never automatically assigned.

Every required location effect is checked inside that transaction: claim, location row, complete capability replacement, geography revision, required unstarted-Quote invalidation, audit and frozen receipt. Suppressed effects reject and roll back the whole command. Quotes with started Payments are excluded from invalidation so reconciliation preserves accepted terms. Identical retry after a failed transaction can recover; success replay returns its original location snapshot.

Customer-site changes supersede unstarted quotes within the market so changed capabilities or a newly nearer site require fresh customer review. Started Payments remain reconcilable with their accepted terms. Origin address/coordinate changes reject while affected deliveries or started checkout payments remain unresolved; the complete batch rechecks this guard. Deactivation preserves scoped operational/profile access and does not rewrite committed evidence.

Location detail commands accept explicit `componentsSource` and `confirmationSource` using the existing address provenance vocabulary. Temporary provider components require permanent finalization at the final confirmed coordinate, even after a user moves the pin. `SAVED_ADDRESS` requires unchanged text from that same location; unchanged coordinates retain protected provider evidence without another lookup. A moved provider-derived saved address is finalized again. Provider errors fail before business effects, and the eventual write still rechecks current IAM and aggregate version. The read model exposes only whether address text is provider-derived, not its protected provider reference.

Membership, trial, subscription pricing, recurring authorization and membership payment contracts are retired from the active release. No checkout method requires a Subscription.

## Cart

An authenticated Customer has at most one active cart; concurrent first-touch creation resolves to that same cart. The approved anonymous-cart carryover must preserve this invariant when signing in, without treating browser contents as authoritative prices or stock.

Cart creation now follows an explicit coordinate selection. `cart.get()` returns `DELIVERY_LOCATION_REQUIRED` when no active Cart exists; it never chooses a default site. `cart.selectCartLocation({ latitude, longitude, expectedVersion, idempotencyKey })` resolves the nearest geographically eligible site in Core, creates a version-one Cart when expectedVersion is zero or changes its location under the current version, and returns an immutable `{ cartId, version, locationId }` receipt. Current geography, customer and Cart state guard the complete transaction. Existing lines remain for current-price/unavailable-state review; paid Order and Quote snapshots are unchanged. This browsing choice grants no checkout eligibility or inventory reservation. A Quote records its Cart version internally. Successful payment commitment completes that Cart only while its version still matches; newer edits and retained Quotes with unknown Cart versions are preserved. Completed Cart rows remain historical. The next Cart or Buy again uses current location selection, while payment replay returns the existing Order and leaves later Carts intact.

`cart.mergeGuestCart({ cartId, expectedVersion, idempotencyKey, items: [{ skuId, quantity }] })` atomically adds guest quantities to existing quantities and returns an immutable `{ cartId, version }` receipt. Payloads are bounded to 100 distinct selling options within the Web byte bound. Names/prices/availability come from the following Core Cart read. Known inactive options remain removable unavailable lines; unknown options or invalid/overflow quantities reject without partial lines or success. The browser retains the exact pending command through a lost response, clears guest data only after confirmed merge/current read, and blocks checkout while carryover needs retry.

- `cart.get() -> CartView`
- `cart.setItem({ cartId, skuId, quantity, expectedVersion, idempotencyKey }) -> CartView`

Cart `quantity` is an integer count of the configured SKU, never kilograms/liters or a floating requested weight; zero removes the line. Every mutation is idempotent and compare-and-swaps the customer-owned active cart version. Identical replay returns the already-applied cart, key reuse with another payload returns `IDEMPOTENCY_CONFLICT`, and stale aggregate state returns `CART_VERSION_CONFLICT`. `CartView` reports each line as `AVAILABLE`, `UNAVAILABLE`, or `PRICE_UNAVAILABLE`; unavailable prices are nullable and are never projected as zero. `checkoutBlocked` plus stable blocking reasons prevents checkout while retaining removable stale lines. Cart activity alone promises no inventory hold/reservation or provider quotation.

## Checkout Eligibility and Quote

- `checkout.evaluate({ cartId, addressId, cycleId }) -> CheckoutEligibilityView` is a deprecated Scheduled-only compatibility read; current Web uses `listFulfillmentOptions` followed by authoritative `createQuote` and does not call it.
- `checkout.createQuote({ cartId, cartVersion, addressId, fulfillmentOptionId, promotionCodes?, idempotencyKey }) -> CheckoutQuoteView`; the opaque option binds address/cart versions, mode, internal routing, Lalamove quotation and the Instant promise or Scheduled cycle/window. Web never submits a provider code, location, or cycle as fulfillment authority. Customer promotion entry, Web transport and Core RPC accept at most five trimmed codes of up to 80 characters each, matching the Admin authoring length bound; codes normalize to uppercase before evaluation.
- `checkout.refreshQuote({ checkoutAttemptId }) -> CheckoutQuoteView`

The view reports each eligibility dimension, explicit financial components, price/availability changes, resolved serviceability, selected `INSTANT`/`SCHEDULED` option, delivery promise, Instant hold status or Scheduled window/cutoff status, provider quotation status, applied/rejected Promotions by price component, and available alternatives. Sensitive location/provider-selection rules remain internal.

Checkout quotes and new payment admission require known positive line shipping grams totaling at most 20,000 g. Core returns a plain 20 kg validation error before payment for an overweight Order. Original lines and committed additions count together; an addition's pending or unknown payment intent also claims its weight until definite failure, expiry or full refund. Admission rechecks that sum atomically with payment intent/link creation. Commitment checks the full committed Order again; an unusable paid quote/addition stays in existing financial recovery without partial Order/demand or false success. Exact replay remains available. No packaging allowance or fit inputs are required.

`CheckoutQuoteView` contains `merchandiseSubtotalMinor`, `itemDiscountMinor`, `orderDiscountMinor`, `deliverySubtotalMinor`, `deliveryDiscountMinor`, `taxMinor`, `totalMinor`, and currency. `subtotalMinor`, `discountMinor`, and `deliveryFeeMinor` remain compatibility projections. Item lines snapshot SKU quantity/unit/base consumption, shipping grams, and allocated discount. The internal Quote snapshots provider/service, quotation identity, amount/currency, issue/expiry time, applicable future pickup time, and capability evidence. New Quotes contain no Service Fee or PayMongo processing fee; legacy fields may be returned only by an explicitly versioned historical-Order DTO. Percentage/fixed Order benefits use only merchandise; delivery waiver/percentage/fixed benefits use only delivery.

The authoritative service validates selling `OPEN`; authenticated Customer; cart, exact location/SKU prices, nonempty cart, address coordinates, service area, zone, resolved location and active mode; Instant inventory hold or Scheduled cycle/window/cutoff; Promotions eligibility/limits/stacking; provider capabilities and quotation; required store/customer contact, coordinate, and shipping-weight data; and payment readiness. Scheduled performs no stock or capacity query. Missing, invalid-currency, expired, or stale required evidence fails closed. The approved item-sale/full-price-code/delivery stack in PRODUCT GD-D06–07 requires item-level allocation and concurrency-safe allowance accounting before exposure. Preserve exact component totals, usage claims and committed history; apply the approved overlap, depletion and eligible-cancellation restoration rules in PRODUCT GD-D07.

Fulfillment-option reads require a Maps-confirmed, active, Core-serviceable Customer address and an owned nonempty active cart at the submitted versions. Exactly the one current global `INSTANT` or `SCHEDULED` mode is returned, with a controlled unavailability reason and provisional promise/fee context. The option ID is opaque and re-resolved by Core at Quote creation; address/cart/global-mode/routing/cycle changes fail closed. An identical Quote idempotency replay returns the original immutable Quote even when current routing later changes, while the same key with another option is `IDEMPOTENCY_CONFLICT`.

## Checkout, Payment, and Order Commitment

- `checkout.createAttempt({ cartId, addressId, fulfillmentOptionId, promotionCodes?, idempotencyKey }) -> CheckoutAttemptView`
- `checkout.createPayment({ checkoutAttemptId, expectedQuoteVersion, expectedPriceAcceptanceVersion, expectedCurrency, expectedMerchandiseSubtotalMinor, expectedItemDiscountMinor, expectedOrderDiscountMinor, expectedDeliverySubtotalMinor, expectedDeliveryFeeMinor, expectedDeliveryDiscountMinor, expectedTaxMinor, expectedTotalMinor, paymentMethod, returnUrl, idempotencyKey }) -> PaymentActionView`
- `checkout.getAttempt({ checkoutAttemptId }) -> CheckoutAttemptView`
- `checkout.recoverCommitment({ checkoutAttemptId }) -> OrderCommitmentResult`

Core receives payment provider webhooks through a signed public webhook handler rather than Web RPC:

- verify signature and timestamp;
- preserve one validated UUID request ID through verification, ingestion logs, and the HTTP response;
- insert `(provider, providerEventId)` into the durable Payments inbox exactly once;
- after successful signature verification, persist the exact bounded raw body, payload hash, provider event identity/type and verification time alongside the provider-neutral observation and processing history; never persist secret keys or authorization headers, and never expose raw payloads through ordinary Admin DTOs or logs;
- append one immutable webhook-receipt row for every verified delivery, including duplicates and verified payloads rejected during normalization, while the separate event inbox deduplicates business processing by `(provider, providerEventId)`;
- conditionally lease due `RECEIVED`/`RETRY_REQUIRED` rows and mapping-only `RECONCILIATION_REQUIRED` exceptions (`INTENT_MAPPING_AMBIGUOUS`, `REFUND_UNMAPPED`) so redelivery and scheduled redrive share one application path;
- translate the vendor state into canonical Payments state under the configured payment commitment policy;
- update Payments using handler-side legal-transition and compare-and-swap protection, safely retrying/reconciling concurrent aggregate changes;
- invoke an explicit idempotent Order application command when the canonical outcome is sufficient;
- commit/recover the Order exactly once;
- enqueue non-critical follow-up.

Provider webhook payloads never contain an application `expectedVersion`. Vendor captured/success states map to canonical Payments `SUCCEEDED` for the current release; browser return state and payment initiation do not. The payment provider remains an adapter and its vocabulary is not exposed in Order DTOs.

Verified provider events may include a provider-neutral settlement observation containing gross,
processing-cost, withholding, adjustment, net, currency, and observation time. Core accepts the
observation only when exact integer arithmetic is valid and its amount/currency agree with the
owned Payment or Refund. Settlement evidence is immutable financial observability; it neither
changes customer price nor authorizes a Payment transition by itself. PayMongo processing cost is absorbed by FreshMarkets and never becomes a customer charge.
Invalid or mismatched evidence fails closed into reconciliation without mutating canonical state.

Application-accessible mock payment providers, simulation RPCs/routes/pages, and mock runtime configuration are removed. Local and shared development use PayMongo sandbox credentials. Deterministic fake adapters remain test-only and are never registered by an application runtime.

Retry availability uses bounded backoff. Expired leases are reclaimable; competing Workers cannot both own an observation. Retry age/attempt exhaustion transitions the inbox row to `RECONCILIATION_REQUIRED` and creates one operationally visible case, so recovery does not depend on the provider sending the event again.

The lease durably consumes an application attempt before work starts, including interrupted work. Both delivery and scheduled claims enforce ten attempts and a 24-hour age limit; exhaustion handling does not consume another application attempt. Scheduled replay requires recorded signature verification and validates the normalized identity, hash, exact money and settlement evidence before application. Applied inbox evidence cannot be downgraded by a late failure. Mapping-only exceptions remain retryable within the same bounds; financial mismatches, illegal transitions and exhaustion do not automatically reopen. Once a verified event applies to a unique current Payment mapping, previously unlinked matching reference cases acquire that Payment identity with a versioned, audited transaction and remain open for financial review. A failed association is recoverable without repeating financial effects.

The scheduler redrives provider inbox/reconciliation, expires provider actions and checkout holds, advances cycles and recovers notification delivery. Active membership/trial/recurring-billing jobs are removed.

Financial case resolution also excludes unapplied provider events linked through the Payment's provider attempts or the case's exact provider/event identity. A terminal Payment alone does not prove that pending event application has completed. The same evidence guard controls both the review projection and the atomic resolution command.

`retryAdminProviderEvent` is a Payments-owned reviewed recovery command for verified financial events stopped by `INBOX_REDRIVE_EXHAUSTED`. It requires Global `payments.manage`, the current open case version, reason and stable key. Current authority, exact case/event/evidence, exhausted state, absence of an active lease, case version advance, fresh bounded retry window, audit of the prior attempt/window evidence and immutable queued receipt share one transaction. It neither changes a financial outcome nor calls provider creation. Original receipt time is preserved. Identical replay returns the original acceptance after subsequent event progress; changed intent conflicts. Admin exposes application state, attempts and retry availability without private normalized/raw evidence. Web freezes unknown acceptance for exact request/key retry. Unverified, malformed, mismatched, nonfinancial and non-exhausted events do not use this action. A successful verified replay can link its previously unlinked exhaustion case, which remains open until the separate financial-resolution guard passes.

`retryAdminPaymentReaction` queues the same exhausted `COMMIT_ORDER` or `COMMIT_AMENDMENT` reaction through Payments. It requires current Global `payments.manage`, open reaction-failure case version, Payment version, reason and stable key. Core atomically validates matching Payment/reaction subject and purpose, canonical `SUCCEEDED`, absence of active/successful refund exposure or unfinished refund recovery, expired reaction lease, and current exhausted state. Case version, reset attempt budget, required audit preserving prior attempts, and immutable queued receipt commit together. The owning Order/amendment applier still validates all commitment prerequisites; a retry never manufactures missing holds, Quotes, paid additions or Orders. Retired membership reactions cannot be restarted through this action. Admin exposes current reaction progress and retry availability; Web retains exact unknown requests for replay. Escalation itself requires the reaction state, operational case and audit to persist together.

Checkout and paid-addition commitment revalidate the canonical Payment version, captured state, exact subject/customer/money identity, matching pending reaction, and absence of reserved/successful or unfinished refund exposure inside the complete commitment transaction. A pre-transaction lookup or a retained successful provider Attempt alone is insufficient. A changed financial outcome, reaction identity or refund reservation rolls back every Order/addition, demand, hold/reservation and success-reaction effect; rejection may retain a controlled financial exception for recovery.

Financial review may confirm `REFUNDED_WITHOUT_COMMITMENT` through `resolveAdminReconciliationCase` for its linked commerce reaction-failure case. `resolutionAction=CONFIRM_REFUNDED_COMMITMENT` makes that consequence explicit before confirmation. Current Global `refunds.manage`, case version, exact canonical full-refund sum/currency, completed provider/refund recovery, matching exhausted or retained failed commerce reaction, and absence of a committed Order/addition are required. The transaction composes Checkout-owned unused-entitlement cleanup and Orders-owned failed-addition/exception completion, marks the reaction `FAILED` with the refunded outcome, expires stale payment continuation, records required separate audits, then closes the case under the ordinary completed-evidence guard and stores its immutable receipt. A Quote's other active payment or winning committed Order retains shared entitlements. Legacy held capacity is released only against valid retained balances; this introduces no Scheduled capacity policy. Partial/uncertain refunds, committed additions, committed Orders, missing required effects or changed evidence prevent completion. This action submits no Refund and never records successful commitment or creates an Order.

Immediately before a new payment creation, Core first resolves an exact idempotency replay, then recalculates selling state, exact store/SKU prices, discounts, Instant stock/hold or Scheduled window/cutoff, serviceability, provider quotation, and fulfillment eligibility without persisting or superseding another Quote. The accepted Quote version, price-acceptance version, currency, `expectedTotalMinor`, every explicit component, and provider quotation evidence must agree; otherwise Core returns `PRICE_CHANGED` without creating a payment and the browser must request/present a replacement Quote for explicit acceptance. Identical replay retains the original accepted version and subject; a replay with changed accepted components is an idempotency conflict.

Stable financial-safety failures include `SELLING_PAUSED`, `DELIVERY_QUOTE_UNAVAILABLE`, `DELIVERY_QUOTE_EXPIRED`, `PAYMENT_OUTCOME_UNRESOLVED`, `AUTHORIZATION_OUTCOME_UNRESOLVED`, `PAYMENT_ACTION_EXPIRED`, `AUTHORIZATION_ACTION_EXPIRED`, and `REFUND_AMOUNT_UNAVAILABLE`. Ambiguous provider outcomes preserve their application identity and reconciliation state; clients must not retry under a new identity merely because a response was lost.

`OrderCommitmentResult` is either the existing/new committed Order summary or a stable actionable exception. Duplicate requests return the same logical result. If Instant inventory or provider quotation is unavailable before charge, return valid fulfillment alternatives without exposing or asking the customer to select a location. If canonical payment commitment succeeds but the downstream Order command cannot complete, preserve the payment observation and retry the same idempotent commitment. Bounded failure creates a visible finance/reconciliation exception. A second payment/Order and automatic refund are forbidden unless a separately approved recovery command explicitly authorizes them.

`checkout.abandonCheckoutAttempt({ quoteId, expectedVersion, idempotencyKey })` is the sole customer pre-commit abandonment command. It atomically guards current customer ownership/status, Quote version, and absence of started/paid financial work; releases its held Instant inventory when applicable; and makes the Quote/attempt terminal with audit and a frozen result, without creating an Order, Payment outcome, Refund, or Promotion redemption. An already expired/superseded Quote uses the same guards to release residual entitlements; retained capacity cleanup is compatibility only. A lost or rejected release response keeps the browser Quote available for identical retry before replacement. Exact replay returns the original result and changed replay fails. Quotes with a Payment that can still succeed fail closed; consumed Quotes are committed-Order territory and cannot be canceled through Checkout. Address, cart, Promotion, or fulfillment edits discard an accepted Quote through this command, with an explicit restart action as a retryable path; browser unload delivery is not relied upon.

Notifications publish the closed launch vocabulary `ORDER_CONFIRMED`, `PAYMENT_ACTION_REQUIRED`, `PAYMENT_FAILED`, `SCHEDULED_CUTOFF_REMINDER`, `OUT_FOR_DELIVERY`, `DELIVERED`, `DELIVERY_FAILED`, `ORDER_CANCELLATION_REQUESTED`, `ORDER_REFUND_PROGRESSING`, `ORDER_REFUND_COMPLETED`, `ORDER_CANCELLATION_COMPLETED`, and `ORDER_REFUND_EXCEPTION`. Versioned templates consume bounded provider-neutral facts only. Stable event/type/recipient identity deduplicates transactional D1 outbox intents. A publisher sends only the outbox ID to Cloudflare Queues; the idempotent consumer conditionally leases D1, records immutable attempts, and explicitly acknowledges/retries each message. Bounded exhaustion is dead-letter visible and scheduled redrive repairs unpublished or stuck work. Notification handling never becomes evidence that the source domain transition succeeded or failed. Courier observation application and manual HAND_OVER/COMPLETE/FAIL atomically persist delivery notification intent with the guarded delivery write. Identity is delivery:{dispatchId}:{eventType}, so newer duplicate observations do not repeat an attempt update and redelivery has a distinct identity. OUT_FOR_DELIVERY is recorded at EN_ROUTE/pickup, not by polling an obsolete DISPATCHED state; rapid pickup/completion retains both intents before any scheduler tick. Required intent omission rolls back application while the verified provider inbox remains available for recovery. Missing recipient data retains a FAILED/RECIPIENT_UNAVAILABLE intent without attempting email or undoing the recorded delivery fact. Current-state projection remains a legacy backfill using the same attempt identity and recognizes retained timestamp-based identities. Queue sending and actual provider acceptance remain separate.

The internal email adapter distinguishes `NOT_SENT` from `UNKNOWN` and bounds the provider call to 30 seconds. Only documented pre-send rejection codes are treated as definite; unrecognized errors, network/timeout failures and missing provider acknowledgement are unknown and cannot trigger automatic resend. Core atomically requires the lease and attempt before send, and both outcome projections after send. If accepted-send persistence fails, the existing attempt remains uncertain; recovery never fabricates failure or repeats the external effect. Existing Queue publication/dead-letter administration still requires its own acceptance evidence. Provider semantics follow the [Cloudflare Workers Email API](https://developers.cloudflare.com/email-service/api/send-emails/workers-api/); this implementation is not a live email acceptance result.

For `INSTANT`, attempt creation/refresh atomically creates or replaces an expiring exact-base-unit inventory hold; the transaction-local availability guard prevents concurrent carts from holding the same final units, and commitment converts the winning hold into a committed reservation. Instant requires no membership. For `SCHEDULED`, commitment uses the selected cycle/window and cutoff, records exact paid purchase demand, and performs no stock or capacity mutation. The committed result snapshots fulfillment mode, resolved location/zone/service area, cutoff and delivery instants, promise/window/ETA, optional Scheduled cycle identifiers, SKU conversion and shipping grams, Promotions, all active monetary components, and accepted provider quotation evidence. New commerce has no FreshMarkets Service Fee or customer-facing processing fee.

## Customer Orders and Amendments

- `orders.listMine(page) -> CustomerOrderPage`
- `orders.getMine({ orderId }) -> CustomerOrderDetail`
- `orders.cancelMine({ orderId, expectedVersion, reason, idempotencyKey }) -> OrderCancellationView`

Cancellation writes return the frozen acceptance receipt, not the latest refund progress. Core saves current customer ownership or Global staff authority, Order state/version, Scheduled cutoff, the exact paid set, refund exclusion, operational release, audit and the receipt in the same transaction. Matching replay returns that receipt after later progress; changed actor/customer/reason/resolution/version conflicts. Retained successful keys without original snapshots report already applied and direct the caller to current progress. Unapplied retained claims can recover through the guarded command. Customer and Admin Web preserve the complete submitted intent after an unknown response and validate the response before replacing its key.

`cancelAdminOrder` returns `AdminOrderCancellationResult { orderId, state, cancellation }`; the cancellation is null only for direct unpaid cancellation. `getAdminOrder` supplies current detail separately. An accepted paid cancellation reserves its refund-member amounts against unrelated Refund commands. Its recovery job considers at most ten due cancellations per run, permits at most five submissions per member separated by a minute, and reconciles an existing Refund identity instead of resubmitting it. An interrupted `REQUESTED` Refund is unknown-outcome evidence, not proof that no external refund occurred. Exhaustion or unknown outcomes remain exceptions for provider reconciliation. Historical/new acceptance receipts never assert provider success.

Cancellation preview and admission subtract prior canonical successful Refunds from each original/addition payment. Fully refunded payments remain in the guarded paid set but create no new refund member. Pending, uncertain or unfinished Refund recovery blocks admission. A historical Service Fee combined with a prior refund requires financial review when its component allocation is unknown; no allocation is inferred. A zero remaining refund completes cancellation, operational release, audit and its frozen receipt atomically without provider submission. The registered recovery path also completes retained accepted zero-refund cancellations in a legal Order state.

Refund observations wake the Orders projection; their supplied status is not financial authority. The projection reads the current canonical Refund, verifies payment identity, exact amount and currency, and atomically advances the member, cancellation and Order. An unlinked member recovers only through its stable cancellation-refund key. Completion requires canonical success for every member. Refund ingress marks its inbox applied only after projection succeeds, including the already-observed Refund path; a failed projection remains retryable. Payment reconciliation also attempts saved-refund projection when the Payment needs no state change. Late submission responses never overwrite canonical member success or completed cancellation.
- `orders.getProvisionalTransactionSummary({ orderId }) -> ProvisionalTransactionSummaryView`
- `orders.reorder({ orderId, expectedCartVersion, idempotencyKey }) -> ReorderResultView`
- `orders.listIssues({ orderId }) -> CustomerOrderIssueView[]`
- `orders.submitIssue({ orderId, category, description, affectedOrderItemIds?, idempotencyKey }) -> CustomerOrderIssueView`
- `orders.getAmendmentEligibility({ orderId }) -> AmendmentEligibilityView`
- `orders.createAmendmentDraft({ orderId, items, idempotencyKey }) -> AmendmentDraftView`
- `orders.payAmendment({ amendmentId, paymentMethod, returnUrl, idempotencyKey }) -> PaymentActionView`

`CustomerOrderDetail` is ownership-scoped and purpose-built from immutable Order snapshots. It contains the public order number and committed instant, exact line/SKU/unit/base-consumption/shipping-weight snapshots, an explicit financial source (`CHECKOUT_QUOTE` or `ORDER_TOTAL_ONLY` with unavailable components represented as null), provider-neutral payment/refund summaries, fulfillment mode and promise, normalized external-delivery progress, additive amendment summaries, customer-safe issue summaries, invoice availability, a deterministic timeline, and Core-derived action availability. Core supplies the exact current cancellation-refund preview, including any documented retained provider cost; Web never recalculates it. Historical Orders may expose their immutable historical Service Fee through a versioned financial-history projection. The active view excludes provider payloads/internal identifiers, reconciliation or Audit JSON, staff identity/internal notes, inventory/procurement data, and live-driver coordinates. A non-owned Order returns `NOT_FOUND`.

`ReorderResultView` reports complete, partial, or no-items-added outcome, current-price additions, controlled skip reasons, and the new ordinary Cart version. Orders reads only historical SKU/quantity/display snapshots and delegates one idempotent, expected-version batch to Checkout's Cart application service. Cart resolves current SKU/product activity, exact-location availability/price, and existing quantity, then applies every eligible merge under one aggregate compare-and-swap. Historical prices, Promotions, address, fulfillment mode, cycle, delivery quotation, and promise never return as current authority; address and fulfillment review are always required.

Customer issue submission accepts one controlled category, a trimmed nonblank description of at most 1,000 characters, and at most 50 affected line identifiers that Core verifies belong to the owned order. Affected-line selection is optional under PRODUCT GD-D11. Core accepts new customer reports only after delivery and revalidates ownership/delivered status in the insert transaction. An optional supplied line still must belong to the Order; the existing bounded category/description validation and exact replay guards remain. The idempotency key is bound to the complete normalized request; exact replay returns the same issue and changed replay fails with `IDEMPOTENCY_CONFLICT`. Submission creates no refund, payment, order-state, or Admin action. Customer projections collapse internal claimed/investigating/escalated work to `IN_REVIEW`, expose only controlled terminal-resolution copy, and never expose staff assignment, internal resolution notes, refund authority, or Admin workflow. Non-owned orders return `NOT_FOUND`.

Customer order DTOs compose original and amendment timelines while preserving separate financial records.

`listOrderAdditionOptions` authenticates the Customer and resolves the owned Scheduled Order's saved location, currency and cutoff. Its bounded name search returns up to 25 named product/selling-size choices with current positive exact-location prices and an explicit `hasMore` flag for refining the search. Missing prices and inactive/unavailable options are excluded; physical stock is irrelevant to this Scheduled read. Suggestions do not reserve goods or fix a price. The addition command still revalidates and creates the separately accepted financial snapshot. Web keeps the original draft/payment body and idempotency key after an uncertain response and validates returned actions before navigating.

An additive amendment is available only for an owned paid Scheduled Order before cutoff under the current location, cycle/window, availability, exact price, shipping weight, and provider-quotation context. Creation is expected-Order-version guarded, additive-only, permits one active draft/payment attempt, snapshots its own lines and complete financial components, and never rewrites original lines, totals, or payment history. Its Payment purpose and subject are `ORDER_AMENDMENT` and the amendment ID; the customer must explicitly accept its exact currency, total, and version. Initiation/browser return never commits. Provider-confirmed canonical success applies the separately auditable exact Scheduled demand delta once; terminal payment failure marks only the amendment failed, while a post-payment mutation race creates a bounded finance exception for reconciliation.

Paid Order commitment also creates one internal invoice-readiness record from the same provider-confirmed transaction. The record copies exact accepted financial components and bounded buyer facts; it does not calculate tax. Missing approved seller/tax configuration yields `PENDING_TAX_CONFIGURATION`, which the customer projection presents as not ready without an identifier. Only separately supplied complete policy facts may reach `READY_FOR_ISSUANCE`; `ISSUED` additionally requires the controlled official identifier and issuance instant.

Customer cancellation accepts no actor or cause authority from Web. Core resolves ownership and applies the mode-aware policy: Instant is customer-cancelable only while paid and awaiting staff acceptance (`COMMITTED`); Scheduled requires the snapshotted cutoff to remain strictly in the future regardless of earlier preparation and coordinates every committed addition. New commerce retains no FreshMarkets fee. Only an actual documented non-refundable courier cost may be retained when the approved customer-caused stage policy permits it. Acceptance automatically initiates the coordinated PayMongo refunds. The response is the cancellation aggregate/refund-member view and shows processing; it does not claim `CANCELED` until all canonical refund observations succeed. Existing unrelated refunds route to financial review.

`ProvisionalTransactionSummaryView` projects immutable buyer/address, line, financial, payment, refund, amendment, and invoice-readiness snapshots. Its fixed document kind is `PROVISIONAL_TRANSACTION_SUMMARY` and its literal disclaimer is `NOT AN OFFICIAL BIR INVOICE`. It never accepts or returns invented seller/TIN, official serial, or unapproved tax computation.

## Admin Foundation, Audit, and Application IAM

- `admin.context.get() -> AdminContextView`
- `admin.scopes.list() -> AdminScopeOptionView[]`
- `admin.bootstrap.get({ selectedScope?, timezone }) -> AdminBootstrapView`
- `admin.overview.get({ selectedScope, timezone }) -> AdminOverviewView`
- `admin.audit.list(filters, page) -> AdminAuditEventPage`
- `admin.audit.get({ auditEventId }) -> AdminAuditEventView`
- `admin.staff.list(filters, page) -> AdminStaffPage`
- `admin.staff.get({ staffId }) -> AdminStaffDetail`
- `admin.staff.invite({ email, displayName, idempotencyKey }) -> AdminStaffDetail`
- `admin.staff.update({ staffId, displayName, expectedVersion, idempotencyKey }) -> AdminStaffDetail`
- `admin.staff.changeAccess({ staffId, action: "ACTIVATE" | "SUSPEND", reason, expectedVersion, idempotencyKey }) -> AdminStaffDetail`
- `admin.staff.setRoles({ staffId, roleIds, expectedVersion, idempotencyKey }) -> AdminStaffDetail`
- `admin.staff.setScopes({ staffId, scopes, expectedVersion, idempotencyKey }) -> AdminStaffDetail`
- `admin.staff.revokeSessions({ staffId, reason, idempotencyKey }) -> SessionRevocationResult`
- `admin.roles.list(page) -> AdminRolePage`
- `admin.roles.get({ roleId }) -> AdminRoleDetail`
- `admin.roles.create({ code, name, description, capabilityCodes, idempotencyKey }) -> AdminRoleDetail`
- `admin.roles.update({ roleId, name, description, expectedVersion, idempotencyKey }) -> AdminRoleDetail`
- `admin.roles.setCapabilities({ roleId, capabilityCodes, expectedVersion, idempotencyKey }) -> AdminRoleDetail`
- `admin.roles.archive({ roleId, reason, expectedVersion, idempotencyKey }) -> AdminRoleDetail`
- `admin.capabilities.list() -> CapabilityDefinitionView[]`

Admin context derives the active Staff principal, canonical capability vocabulary, and global/market/location scopes from the Better Auth session plus Application IAM. For the current Admin experience it returns Global plus reachable operational locations as selector choices; internal Market scope remains an authorization and domain concern rather than a user-facing selector level. Web never manufactures a capability or infers authorization from navigation visibility.

`AdminBootstrapView` is the purpose-built first-render composition for the Admin shell and
Overview. It contains `AdminContextView`, reachable `AdminScopeOptionView` entries, Core-proven
selected-scope evidence, and the initial `AdminOverviewView` when a scope is selected. An optional
browser scope preference is only a hint: Core accepts it only when it is currently reachable,
otherwise falls back to the sole assigned scope or returns `SELECTION_REQUIRED` evidence without
granting access. Market and Location selections use the canonical configured timezone; Global uses
the validated request timezone. The Web adapter delegates one typed Service Binding RPC and does
not join or derive authoritative data.

Admin list Server Components may call the same typed Core query directly and pass its JSON-safe
read model into the interactive client boundary so the first list does not wait for an additional
browser HTTP request. Same-origin route handlers remain transport adapters for later cursor pages,
refreshes, and commands. A browser-stored Product pricing target is only a bounded request hint;
Core still enforces global Catalog capability/scope and validates that market/location context.

Core resolves the bootstrap's Better Auth session, Staff identity, roles, capabilities, and scopes
once. Context, scope-option, Overview, and nested Audit reads consume the same immutable internal
access result. This is request-scoped reuse only: it is never cached across RPCs, does not alter
capability or scope checks, and the internal Staff evidence is not part of any public DTO.

`AdminOverviewView` is generated for one Core-authorized selected scope and reporting timezone. It contains `generatedAt`, bounded operational cards, workload-stage counts, bounded active exceptions, bounded recent material operations, per-section freshness, and `deniedSections`. Cards and stages carry stable workspace/filter destinations and explicit availability; missing authority is never projected as numeric zero. Core composes the view from owning read models and applies each capability plus market/location scope independently. A global Staff principal with the required capabilities receives all Admin-safe sections and all reachable market/location records.
The same overview includes at most 24 recent `notifications` with a stable identity, plain label, Order reference, occurrence instant, authorized destination and optional operational scope. Core reads committed Orders, delivery notification intents, unresolved problem reports and failed/escalated refunds; this is a bounded projection, not a new business record or read/unread workflow. Selected-location filtering and current read capabilities apply on every read. Problem notices require Global Staff plus orders.read; refund attention requires Global Staff plus payments.read. Assigned operations readers receive only their authorized fulfillment/delivery work. The overview refreshes on visible-window focus and every visible minute; the shell bell links to that existing dashboard section.

Operational notice links use optional bounded `orderId` on the existing fulfillment and delivery queue reads. Core retains current location/read authorization and returns only that Order in the authorized location; explicit reads can include retained terminal rows. Omitting the filter preserves the default active queues. A notice does not authorize any action or reopen an Order. Global commercial notice links use existing Order/Problems/Payment details. Existing membership notification records remain retained, but the projector generates payment notices only for GROCERY_CHECKOUT and ORDER_AMENDMENT; membership enrollment/renewal facts cannot create new messages.

Audit queries require `audit.read`, enforce resource scope, use bounded keyset pagination, and return sanitized purpose-built DTOs rather than raw JSON rows. Credential, bearer-token, cookie, authorization, provider-payload, and secret values are redacted recursively. Staff invitations never accept a password; Better Auth retains credentials, verification, and session authority. Roles with active assignments cannot be silently deleted, and session revocation is an explicit audited operation.

### Admin Foundation service contract details

`packages/contracts/src/admin-foundation.ts` publishes the closed canonical dot-form capability vocabulary (`adminCapabilityCodes`), the derived `Capability` type, `isAdminCapability`, and the `AdminFoundationService` surface implemented by Core:

- `getAdminContext` returns `AdminContextView`: staff principal identity, canonical capabilities, assigned global/market/location scopes, Core-provided navigation, and environment. Active navigation uses closed entry codes including `overview`, `orders`, `catalog`, `inventory`, `procurement`, `fulfillment`, `delivery`, `customers`, `payments`, `commerce-configuration`, `promotions`, `analytics`, `staff`, `audit`, and `settings`; an entry appears only when its read or manage capability is held, and `overview` is always present for active Staff. Customer navigation requires Customer capability. Membership navigation and Membership Price authority are retired. Closure intake and its authorized review remain separate from policy-gated irreversible anonymization. `commerce-configuration` is emitted for authorized global selling/mode configuration. No Service Fee or internal delivery-pricing destination exists. Each item carries closed `scopeKinds` metadata (`GLOBAL`, `MARKET`, `LOCATION`) owned by Core. Web may only narrow the authorized items to the operator's selected scope kind and never infers or expands permission from visibility. The previous Membership child-navigation and deferred-intake behavior is historical implementation pending removal, not active product authority.
- Phase 12 extends each permitted navigation entry with a closed section code, selected-scope applicability, and optional parent code, and adds stable subview codes for the approved Product, Category, Order, Customer, Procurement/Receiving, Payment, Staff/Role, and Settings destinations. Core emits every visible parent and child; Web may filter, group, and collapse those entries but never manufactures an unauthorized route. Global Customer, Catalog definition, Promotion, Payment/Pricing, and Staff administration is hidden for Market/Location selections. Orders, Analytics, and Audit remain available for their supported scoped reads. Location Product operations, physical Inventory, and External Delivery are Location-only; selling state and Fulfillment Mode are Global-only.
- `listAdminScopes` returns location `AdminScopeOptionView` entries (ids, codes, names, parent-market identity, currency, and timezone) only for active locations reachable by the caller's global, market, or location assignment. A sole Market assignment auto-selects its sole reachable active location; otherwise explicit selection is required. Geometry, location-ranking rules, and the internal Market selector level are never exposed.
- `listAdminAuditEvents` and `getAdminAuditEvent` require `audit.read`, enforce resource scope in Core, bound `limit` to 1–100 (default 50), and page by a descending `(occurred_at, id)` opaque base64url cursor; malformed cursors return `VALIDATION_FAILED`. Audit detail parses `details_json`/`before_json`/`after_json` into structured objects and recursively redacts case-insensitive keys `password`, `token`, `secret`, `cookie`, `authorization`, `accessToken`, `refreshToken`, `idToken`, and `providerPayload` to `"[REDACTED]"`; invalid historical JSON becomes an empty object with a safe warning. Raw JSON strings and raw rows are never exposed.

Migration `0026_admin_foundation.sql` seeds the canonical capability rows with stable `perm_<domain>_<action>_v1` ids and maps historical colon-form assignments additively. Historical colon-form permission rows and assignments remain compatibility data; new source and DTOs use canonical dot-form capabilities only.

### Staff & Access service contract details

`packages/contracts/src/admin-staff-access.ts` publishes `AdminStaffAccessService` — `listAdminStaff`, `getAdminStaff`, `listAdminStaffInvitations`, `inviteAdminStaff`, `revokeAdminStaffInvitation`, `updateAdminStaff`, `changeAdminStaffAccess`, `setAdminStaffRoles`, `setAdminStaffScopes`, `revokeAdminStaffSessions`, `listAdminRoles`, `getAdminRole`, `createAdminRole`, `updateAdminRole`, `setAdminRoleCapabilities`, `archiveAdminRole`, and `listCapabilityDefinitions`.

- Authorization: every Staff & Access query/command requires `staff.read` (reads) or `staff.manage` (commands) **plus a global scope** in Core. Staff administration is a central concern; market/location-scoped principals receive `FORBIDDEN`.
- Staff reads compose application IAM identities with roles, canonical capabilities, scopes, and a single Better-Auth display `email`; no Better Auth row is returned as a Staff DTO.
- Staff scope editing uses Core-provided named operational locations or Global access, with readable current assignments rather than raw IDs/JSON. Retained market assignments remain visible as market context. Web validates its Staff/Role/scope read responses and preserves the same command intent on unknown responses; Core remains authoritative for assignment eligibility.
- Commands take caller-stable `idempotencyKey`s and `expectedVersion` where concurrent mutation is possible, require a reason for access changes/revocation/archive, and append `audit_event` rows (closed action vocabulary `STAFF.*`/`ROLE.*`) with before/after snapshots and `correlation_id = requestId`. Identical replay returns the authoritative result; hash conflicts return `IDEMPOTENCY_CONFLICT`.
- `setAdminStaffRoles`/`setAdminStaffScopes` replace atomically; the complete D1 batch rechecks the caller's authority and aggregate version and requires every dependent effect; a zero-row mutation must abort or produce no effects, not merely return a stale result after commitment. Archived roles fail closed on assignment.
- `revokeAdminStaffSessions` deletes the authentication authority's own session rows for the linked user (the minimal Better Auth build exposes no administrative revoke API), leaving no application-side session state.
- Invitation lifecycle for the current release: `inviteAdminStaff` creates one durable `PENDING` record per normalized email with 14-day expiry; verified invitation review/acceptance is implemented through the explicit commands described below; its complete browser/provider acceptance remains in the checkpoint.

### Customer CRM service

`packages/contracts/src/admin-customers.ts` publishes customer administration (`listAdminCustomers`, `getAdminCustomer`, `listCustomerInvitations`, `inviteCustomer`, `revokeCustomerInvitation`, `changeCustomerAccess`, `revokeCustomerSessions`, `requestCustomerClosure`), verified customer invitation review/acceptance (`getMyCustomerInvitation`, `acceptCustomerInvitation`), and `AdminPrivacyService` (`listPrivacyRequests`, `applyPrivacyAction`). Invitation review/acceptance derives the customer's verified identity; it does not require staff authority.

- Authorization: `customers.read` (reads) or `customers.manage` (commands) **plus a global scope** in Core; customer identity is global for the current release and scoped principals receive `FORBIDDEN`.
- `AdminCustomerSummary` composes the display `email`, `phone`, commerce-access status from the `customer_principal` gate, committed `orderCount`/`lastOrderAt`, aggregate `version`, and `createdAt`. Lifetime spend/AOV are excluded until their canonical metric definitions are approved. `AdminCustomerDetail` adds the ten most recent sanitized Audit summaries about this Customer, its accepted invitations and privacy requests. Resource ownership includes staff actions on the Customer and excludes unrelated staff actions merely authored by the same authentication user.
- `changeCustomerAccess` disables/restores commerce access through the `customer_principal` gate with the customer aggregate's positive expected version. Current Global customer-management authority, exact principal/Customer identity and state, both required writes, audit and the frozen summary receipt commit together. The receipt uses the same committed-order summary definition as Customer reads. Successful replay precedes same-state/version rejection; historical resource-only receipts retain read-back compatibility.
- `revokeCustomerSessions` uses the authentication authority's session rows. It atomically rechecks Global customer-management authority, target identity/version and the reviewed session count; deletion of the complete set, audit and receipt are required together. A newly created session invalidates the reviewed set before any deletion commits. Replaying a successful revocation never deletes a later login. Legacy numeric-count success receipts remain readable; malformed receipts do not trigger another deletion. The Web detail page preserves exact unconfirmed access/session requests and exposes explicit retry.
- `requestCustomerClosure` opens an auditable privacy request; `applyPrivacyAction` enforces the closed lifecycle `SUBMITTED -> VERIFYING|APPROVED|REJECTED`, `VERIFYING -> APPROVED|REJECTED|ESCALATED`, `APPROVED -> PROCESSING`, `PROCESSING -> COMPLETED|ESCALATED`, `ESCALATED -> PROCESSING` and returns `ILLEGAL_TRANSITION` otherwise. Both commands guard current Global authority, Customer identity/version, every required write, audit and frozen receipt in one transaction. Successful replay precedes later state rejection; historical resource receipts retain read-back compatibility. Rejected new claims leave no receipt.
- Completing `CLOSURE` disables the customer principal, advances the Customer version, revokes its reviewed current session set, records `CUSTOMER.CLOSED`, and completes the privacy request together. A failure in any dependent effect rolls everything back. This closes commerce access, preserves retained data, and does not cancel Orders or initiate financial effects. The separately authorized access-restoration command remains available; replaying the earlier closure never closes access again after restoration. Historical completed requests are not backfilled with fabricated closure effects.
- `ANONYMIZATION` completion is unavailable until actual retention/field policy is configured. `ACCESS` and `CORRECTION` remain manual-response/correction tracking with reasoned completion evidence; these commands do not implement data export or arbitrary profile mutation. The Web panel states that limitation. `PrivacyRequestView.availableActions` comes from Core, excluding unavailable completion; `listPrivacyRequests` accepts an optional exact `customerId` filter for the customer workspace, with bounded pagination.
- `getMyCustomerProfile` resolves the authenticated Customer and returns `customerId`, nullable `preferredLanguage`, boolean `promotionalEmails`, and current `version`. `updateMyCustomerProfile` accepts the existing two preference fields, `expectedVersion`, and a stable idempotency key. A rejected mutation never provisions a Customer. Current active Customer/principal identity and version guard the complete update, audit and frozen replay receipt. Preferred language is bounded to 80 characters and records a support preference rather than promising localized content. Promotional email defaults to no recorded opt-in; order, payment, delivery, cancellation and refund updates cannot be muted. Global `getAdminCustomerProfile` requires `customers.read`; `updateAdminCustomerProfile` requires `customers.manage`, reason and expected Customer version and guards current Global authority with every dependent write. `appendCustomerSupportNote` requires Global `customers.manage`, a bounded body and stable key; it creates immutable author-attributed evidence with audit and replay result. Distinct notes may append concurrently without changing Customer version. `listCustomerSupportNotes` requires Global `customers.read` and returns bounded exact-customer keyset pages. Note bodies are not copied into audit details or logs. Delivery recipient/phone remain address-owned, and identity credentials remain Better Auth-owned. Controlled segmentation is outside the current approved profile work.
- Customer invitations have one `PENDING` record per normalized email, 14-day expiry and no password input. `getMyCustomerInvitation` returns only the current verified account's offer without provisioning. `acceptCustomerInvitation` requires the offer's expected version and a stable key; current verified email, pending state, expiry, active customer access, any required provisioning, acceptance, audit and frozen result commit atomically. Normal self-registration remains available independently of invitations.
- `CustomerInvitationView.version` supports `revokeCustomerInvitation`, which requires Global `customers.manage`, expected version, reason and stable key. Creation and revocation recheck current authority and require every effect plus audit and a frozen receipt in one transaction. Original success replays precede later state rejection. Historical creation receipts containing only an invitation ID retain read-back compatibility. The Web invitation workspace preserves the exact unconfirmed request through explicit retry.

New Customer and Staff invitation creation includes one required durable email intent in the invitation transaction. Revocation cancels any still-pending email in the same transaction; an already submitted or uncertain send is not represented as canceled. Delivery rechecks pending invitation, exact recipient and expiry when claiming the send attempt. Invitation emails use the configured application origin and fixed verified-identity acceptance pages, with no bearer invitation secret. They neither create Customer records for staff recipients nor grant access through a link.

Invitation list items expose current `emailStatus`: `NOT_REQUESTED`, `QUEUED`, `SENDING`, `ACCEPTED`, `FAILED`, `OUTCOME_UNKNOWN`, or `CANCELED`. `ACCEPTED` means provider submission acceptance, not inbox delivery. Command receipts retain their original result independently of this live projection. Older invitations without an email intent remain `NOT_REQUESTED`; historical replay does not enqueue retrospective mail. Live sender and inbox delivery acceptance remains a separate environment/provider check.
- Material commands are idempotent, version-guarded where concurrent mutation is possible, reason-gated, and audited (`CUSTOMER.*`/`PRIVACY.*` closed vocabulary).

### Canonical delivery benefit authoring (2026-09-09)

Promotion create/read/edit/grant contracts now support the five canonical merchandise/delivery benefits. Create and draft edit accept optional `maximumDiscountMinor`; draft edit also accepts optional positive `globalUsageLimit`, `perCustomerUsageLimit`, and `automatic`. Omission preserves existing optional configuration on edit; explicit null clears a cap/limit. Waiver has no invented zero discount field, fixed benefits require a positive minor-unit amount, and percentages require an integer 1-100. RPC entrypoints, application commands and Web transports consume shared schemas. Original receipts include the saved cap/limits.

Discount preview accepts optional `deliverySubtotalMinor`, required for a delivery benefit; missing courier cost is not zero. The amount calculation is shared with Quote, applies integer floor for percentage discounts and caps only the owned price component. Preview without a customer checks definition status/time/minimum and returns `eligibilityChecked: false`; Web labels it an amount estimate. Optional `customerId` additionally requires Global `customers.read`, resolves active Customer and commerce-principal access, and runs the same current customer rules, grants, usage counts and selection policy as Quote. It returns `eligibilityChecked: true` with a controlled eligibility reason and discount, without creating Quote claims or consuming redemption capacity. Checkout and paid commitment still revalidate mutable evidence. The preview uses only fields the current closed rules need; it invents no location, courier quotation or fulfillment facts. Canonical new quote applications use the explicit delivery percentage/fixed types; `DELIVERY_FEE_DISCOUNT` stays representable only for retained quote/payment evidence.

### Pay-as-you-go promotion eligibility (2026-09-09)

The new-commerce promotion evaluator does not load subscription entitlement. Its closed rule vocabulary excludes `MEMBER` and `NON_MEMBER`; retained rows with either rule are ineligible, not broadened into general discounts. Existing records remain available as history. Quote feedback reports these requested campaigns as `INELIGIBLE` and does not create their usage claims. General first-order, new-customer, minimum-subtotal, segment and specific-customer rules retain their existing behavior. This removes promotion eligibility's membership dependency, not every remaining historical membership route/job.

### Current promotion command integrity (2026-09-09)

Promotion create, draft edit, lifecycle and targeted-grant commands accept bounded shared schemas and recheck active staff, Global scope and `promotions.manage` inside the complete transaction. Each required business effect, immutable audit and original JSON result must succeed together. Draft version/status and active promotion/customer grant eligibility are guarded in the same batch. A zero-row effect aborts the whole command. Successful identical replay is resolved before later lifecycle/version rejection; changed payload under the same key conflicts. A lost batch response reads the frozen receipt. Historical reference-only results conflict for history review rather than reapplying a command or claiming the current record is its original result.

That transaction repair initially covered fixed/percentage merchandise discounts; canonical delivery benefit authoring is described above. Draft edits validate amounts, dates and current benefit shape; creation bounds optional positive usage limits. Web adapters bound JSON to 8 KiB. Normal Create/Save and lifecycle actions preserve the complete unconfirmed request internally. Dates in the draft form are explicitly UTC. This integrity repair does not claim delivery-benefit authoring, complete audience authoring, campaign media or provider acceptance.

### Campaign image administration and publication

`getAdminPromotionMedia` and `getAdminPromotionMediaContent` require Global `promotions.read`. Upload, alt-text update and removal require Global `promotions.manage`, a stable command key, and the expected current media identity/version (null for an initial upload). Images have independent versions; changing one never changes the financial Promotion definition or committed benefit history. Core validates bounded JPEG/PNG/WebP bytes and generates the object identity. A replacement atomically deactivates the prior attachment, queues its cleanup, attaches the successor, audits and records the original command result. No storage recovery controls are exposed to staff.

`listPublishedPromotionCampaigns` is an anonymous, bounded (20) read of active campaigns within their effective dates, with a valid supported benefit and active image. It supplies structured campaign text/benefit fields and opaque image URLs, never audience customer identities, raw rules, object keys or a promise of customer eligibility. `getPublishedPromotionMedia` rechecks the owner, effective dates and media version before returning bytes, including after the storage read. Same-origin Web adapters revalidate Core publication before honoring ETags; stale/replaced/inactive URLs return unavailable with no-store caching. Checkout remains authoritative for audience, usage, stacking and final savings.

### Promotions service contract details

`packages/contracts/src/admin-promotions.ts` publishes `AdminPromotionsService` (`listAdminPromotions`, `getAdminPromotion`, `createAdminPromotion`, `updateAdminPromotion`, `changeAdminPromotionStatus`, `previewAdminPromotion`, `grantAdminPromotion`, `listPromotionGrants`, `listPromotionRedemptions`).

- Authorization: `promotions.read` (reads/preview) or `promotions.manage` (commands) **plus a global scope** in Core.
- The five implemented grocery/delivery benefit types are defined above. Promotion lifecycle is `DRAFT -> ACTIVE -> INACTIVE`, with `DRAFT|INACTIVE -> ARCHIVED` terminal and `ILLEGAL_TRANSITION` for unsupported changes; only drafts change definition and no delete path exists. Product-sale targeting and revised stacking remain the PRODUCT decision reconciliation gap. Membership benefit authority is retired.
- Preview is read-only and deterministic (status/window/minimum-subtotal policy, fixed or `floor(subtotal x percent / 100)` computation capped at the subtotal) and never claims usage or writes a redemption.
- Grants create targeted `promotion_grant` rows (`benefit_code` = promotion code, `customer_id` persisted, `max_redemptions >= 1`) for ACTIVE promotions only. `INTRO_TRIAL` and `LEGACY_TRIAL_HISTORY` are reserved system membership codes and are excluded from this surface. Exactly one grant may exist for a promotion/customer: an identical idempotent retry replays the original grant, while a distinct command conflicts without creating a duplicate. Redemptions are read-only inspections joined by promotion code.
- Material commands are idempotent, version-guarded and audited, with reasons where the owning operational policy requires them (`PROMOTION.CREATED/UPDATED/ACTIVATED/DEACTIVATED/ARCHIVED/GRANTED`).

### Catalog and Inventory services contract details

`packages/contracts/src/admin-catalog.ts` publishes `AdminCatalogService` (`listAdminCategories`, `createAdminCategory`, `getAdminCategory`, `updateAdminCategory`, `setAdminCategoryStatus`, `listAdminUnits`, `createAdminUnit`, `listAdminProducts`, `createAdminProduct`, `getAdminProduct`, `updateAdminProduct`, `setAdminProductStatus`, `uploadAdminProductMedia`, `updateAdminProductMedia`, `removeAdminProductMedia`, `createAdminSku`, `updateAdminSku`, `setAdminSkuAvailability`, `setAdminSkuPrice`) and `AdminInventoryReadService` (`listAdminInventory`, `getAdminInventoryLedger`).

- Authorization: Product identity, Category, media, unit, and SellableVariant definition surfaces require `catalog.read`/`catalog.manage` plus global scope. A location Product projection requires both `catalog.read` and `inventory.read` plus operational scope over the requested location. Exact-location price writes require Global scope and `prices.manage`; local selling activation requires the authorized catalog capability and operational scope. Inventory reads require `inventory.read` plus operational scope over the requested location.
- `listAdminInventory` includes catalog product pools that have no balance at the requested location: these report zero quantities and version zero for the first inspected-stock adjustment. The read never creates balances. `heldBase` and `availableBase` expose current checkout holds and on-hand less reservations and holds; these additive fields are optional for transport compatibility. A client missing availability evidence displays unavailable.
- `inventory.adjust` atomically guards current `inventory.adjust` capability/scope, expected balance version, exact stock, reservations and checkout holds with the ledger, audit and idempotency result. Matching replay returns the original quantities, balance version and ledger identity even after later stock changes. An interrupted unapplied legacy claim can recover; a historical successful key without a saved result reports that it already applied and requires ledger review, never another stock movement. The Web adjustment retains its exact submitted location, pool, quantity, reason, version and key after an unknown response.
- Migration `0052_global_fulfillment_location_commerce.sql` rebuilds `price_version` so `location_id` is required. Prices are inserted as new exact-location `STANDARD` rows, history is never silently rewritten, and missing/zero prices fail closed. There is no Market/global price row or fallback.
- SellableVariant creation validates that the controlled sell unit's dimension matches the Product pool and that integer sell quantity converts exactly to persisted base consumption; Admin derives that value for standard controlled units and Core verifies it. Newly created non-gram variants require a positive estimated shipping weight in grams per sold unit; existing historical variants remain nullable until an operator supplies an honest estimate. Variant updates and selling-status upserts are version-guarded (`sku_location_availability` inserts use `expectedVersion 0`). Product status toggles are global, reason-gated, audited, and guarded on current status.
- `listAdminUnits` exposes only active `MASS` and `COUNT` units for catalog authoring. `createAdminUnit` rejects `VOLUME`; packaged liquids are represented as count-based SKUs. Historical volume rows remain inactive compatibility data rather than being deleted.
- Unit/Variant/availability/price commands validate bounded shared schemas and atomically recheck current capability/scope, mutable unit/location/currency evidence, every required write, audit and original result receipt. Global Variant results contain no implicit default-location price; location commands return their exact target's fields. Replays return the frozen original result even after later changes. Historical successful reference-only receipts fail closed to history review, never another mutation. Explicit null clears a Variant merchandising label; omission preserves it. Concurrent price writes derive distinct SKU-wide versions within their write transactions.
- Both modes fail closed with `DELIVERY_WEIGHT_UNAVAILABLE` when any cart line cannot resolve shipping grams because every active delivery is externally quoted. Quote creation independently rechecks this invariant and returns `CONFIGURATION_ERROR`.
- Phase 12 Category and Product authoring adds guarded hierarchy, identity, ordered customer details, inventory-pool base-unit context, lifecycle, recent Audit, and Core-derived actions without exposing raw rows. Product and Category lifecycle has no generic delete command. Bulk import remains deferred; purchase/receiving surfaces belong to Procurement/Receiving.
- Category creation, editing and status commands validate shared bounded schemas and guard current Global `catalog.manage`, hierarchy/version, every required write, Audit and frozen result in one transaction. Same-key retries recover the original result after later edits or a lost batch response. An unapplied historical claim can resume only without applied Audit evidence; an old successful identity-only receipt reports that the command already applied and requires history review, rather than inventing its original response or repeating the mutation. Web preserves the submitted URL/body/method/key, locks fields while unconfirmed, validates read/result DTOs and pages parent choices explicitly.
- Product creation, editing and status use the same transaction and receipt boundary. Creation rechecks an active category and active canonical `GRAM`/`PIECE` base unit inside the write; the pool, Product, all requested customer details, Audit and frozen summary are required together. Editing atomically replaces the complete detail set at the expected Product version. Same-key recovery returns the original summary, including its original SKU count, after later edits or variant creation. Web validates Product reads/results and retains complete edit intents across scope refreshes; Product setup retains its original Product/media/variant command identities. Category choices are paginated and setup read failures expose retry controls. Variant, local activation and price commands remain independent versioned operations and need their own acceptance evidence.
- Category and Product lists apply query/status predicates in Core before bounded keyset pagination; cursors are opaque and scoped to the active filter set. Product requests carry an explicit Admin-authorized `GLOBAL` or exact `LOCATION` scope. Global detail returns only catalog definition. Location detail returns the location's name/currency, exact local prices, local active flags, and shared Product inventory; it never falls back to Market price.
- `AdminProductListRequest` and `AdminProductDetailRequest` carry a discriminated `scopeKind`: `GLOBAL` has no Market/Location fields, while `LOCATION` requires exact `marketId` and `locationId`. Their responses carry the matching discriminated `scope`; no duplicate view-mode flag exists. Global summaries contain primary-media identity and catalog Variant counts only. Location summaries additionally contain locally active/priced Variant counts, exact price range, and the Product's one shared inventory position (`onHandBase`, `reservedBase`, `availableBase`). Global DTOs and UI do not expose legacy price-resolution context, selling readiness, stock, or catalog-reference labels. Totals are scoped and filtered by Core; Web never derives completeness from a truncated page.
- `getAdminProductMediaContent({ productId, mediaId, version? }) -> AdminProductMediaContent` is an authenticated `catalog.read` query returning bounded bytes, MIME type, ETag, and media version after Product/media ownership and status checks. It never returns an R2 object key. Web exposes a same-origin authenticated adapter with private conditional caching; Web never binds or reads `PRODUCT_MEDIA` directly.
- `getPublishedProductMedia({ mediaId, version }) -> PublishedProductMediaContent` is an anonymous Core query restricted to current active published Product media. Web serves `/media/products/{mediaId}/{version}`, revalidating publication before honoring ETags with `public, max-age=0, must-revalidate` and `nosniff`; unavailable or obsolete media is not cached. Core bounds object bytes and returns only content, validated MIME and ETag, never object keys. Catalog home/search/category/detail projections use these canonical URLs. MarketplaceProductView.images supplies at most five active photos in main-photo/display order for the Product page and quick-view gallery; card and cart projections retain only the main photo. Upload forms retain the complete file/metadata/version/key for an unconfirmed outcome and retry the same intent.
- Cart reads include the same canonical Product media projection. Retained browser carts may omit media; missing or failed images render an explicit placeholder. Browser metadata accepts only the same-origin versioned Product media path and never grants publication authority.
- Owner correction, 2026-09-09: `getAdminProductMediaRecovery`, `recoverAdminProductMedia`, their shared DTOs and the Web media/recovery route are removed. Catalog operators have ordinary image CRUD only, with upload progress and actionable errors. Internal upload identity, bounded background cleanup and publication checks remain; they do not introduce a catalog recovery feature. Existing upload/cleanup/audit data is retained.
- `uploadAdminProductMedia({ productId, replaceMediaId?, bytes, mimeType, altText, isPrimary, sortOrder, expectedProductVersion, idempotencyKey })`, `updateAdminProductMedia({ productId, mediaId, altText, isPrimary, sortOrder, expectedProductVersion, idempotencyKey })`, and `removeAdminProductMedia({ productId, mediaId, expectedProductVersion, idempotencyKey })` return `AdminProductMediaView`. Upload accepts only signature-matching JPEG, PNG, or WebP bytes up to 5 MiB. Core persists one generated `products/{productId}/{mediaId}` identity and content digest before storing bytes through `PRODUCT_MEDIA`. Unknown storage outcomes are observed at that same identity. Publication rechecks current Global authority, Product version and the five-active-image limit. Optional replaceMediaId must identify an active image belonging to this Product; the existing image stays published through storage uncertainty. Publication atomically deactivates that image, queues its cleanup, attaches the replacement, and commits Audit and a frozen idempotency receipt. A failed attachment retains recoverable stored intent; an ambiguous D1 response never authorizes deletion of a published object. Removal atomically deactivates metadata and records durable cleanup, then the registered cleanup job deletes with bounded retries. Replays return the original operation receipt without repeating storage effects. Web cannot submit an object key or access R2 directly.

## Admin Orders and Payments

- `admin.orders.list(filters, page) -> AdminOrderListPage`
- `admin.orders.get({ orderId }) -> AdminOrderDetail`
- `admin.orders.cancel({ orderId, reason, resolution, expectedVersion, idempotencyKey }) -> AdminOrderDetail`
- `admin.orders.recordExceptionResolution(...)`
- `admin.payments.getOverview() -> AdminPaymentOverview`
- `admin.payments.list(filters, page) -> AdminPaymentPage`
- `admin.payments.get({ paymentIntentId }) -> AdminPaymentDetail`
**2026-09-09 owner clarification:** post-delivery exception refunds require authorized staff review and confirmation in the FreshMarkets dashboard. Core executes the refund through PayMongo and verifies the provider result; staff cannot enter a financial success flag. Retain the staff submission contract below. Automatic eligible customer cancellation continues through Orders and Payments without staff approval.

- `admin.payments.refund({ paymentIntentId, amountMinor, expectedVersion, reason, idempotencyKey }) -> AdminRefundView`
`recheckAdminRefund({ refundId, expectedVersion, reason, idempotencyKey })` returns an immutable `AdminRefundRecheckResult { refundId, state: QUEUED, version, acceptedAt }`. Payments checks current Global `refunds.manage`, current Refund version/state and absence of an active recovery lease with the durable queue intent, required audit and original result. It resets bounded lookup attempts for the existing Refund; it never submits a replacement refund. Identical replay returns the queued acceptance after later progress. The payment detail supplies each Refund's version and purpose-built recovery progress (attempts, next check, controlled error code and current recheck availability). Web freezes unknown recheck requests and explicitly retries the saved body/key.

The registered Payments recovery job considers at most five due Refunds per run. It claims a five-minute lease, performs read-only provider lookup, validates the captured payment reference, Refund reference, application key where binding an unknown reference, exact amount/currency and observation instant, and applies financial state, reference binding, payment-total projection and immutable audit together. Unknown, absent, mismatched, ambiguous or truncated lookup evidence keeps the amount reserved. Five attempts with bounded exponential backoff lead to operator review. Successful financial observation starts a separately bounded projection-recovery stage; its durable due intent is cleared only after Order cancellation projection succeeds. A linked recovery case resolves only on canonical success and completed projection; definitive failed refunds remain visible for review. No provider POST is issued by recovery.

The refund command returns its immutable `REQUESTED` acceptance receipt. Current Refund progress is read separately; accepting the command never asserts provider success. Payments atomically checks current Global `refunds.manage`, payment version/captured provider evidence, coordinated-cancellation exclusion, available refund budget, audit and idempotency. Only the command that creates the durable Refund identity submits it; unknown outcomes retain that identity and reserve the amount for reconciliation. Exact replay returns the original receipt even after provider progress; changed decision/version conflicts. Historical successful keys without an original receipt report already recorded and require reconciliation, never duplicate submission. `AdminPaymentDetail.refundUnavailableReason` explains current capability, state, cancellation, budget or provider-evidence unavailability. Web retains the original amount, reason, version and key when the response is unknown.

- `admin.payments.listReconciliationCases(filters, page) -> AdminReconciliationPage`
- `admin.payments.resolveReconciliationCase({ caseId, reason, idempotencyKey }) -> AdminReconciliationCaseView`

The Admin Order list exposes the committed Order number, immutable recipient label, customer email, fulfillment mode, amount, commitment instant, lifecycle status, and operational status summaries through a purpose-built projection. Admin order detail composes the sanitized recipient and delivery-address snapshot, immutable checkout financial and item snapshots, Payments, amendments, fulfillment, delivery, exception, merged timeline, allowed-action, and Audit projections; it is not a raw join response. Historical orders without an authoritative checkout quote explicitly return an `ORDER_TOTAL_ONLY` financial source with unavailable component amounts rather than fabricating a breakdown. Payment detail composes canonical attempts, refunds, provider-safe event metadata, downstream reactions, reconciliation cases, allowed actions, and Audit. Provider references, provider event identifiers, payload hashes/payloads, idempotency records, and reconciliation detail JSON do not leave Core. `CANCEL` and `REQUEST_REFUND` are returned only when both lifecycle policy and the caller's capability authorize the command.

Refund availability subtracts every reserved refund amount in `REQUESTED`, `PROCESSING`, `ESCALATED`, or `SUCCEEDED` before accepting another request. The guarded refund mutation, Audit event, and idempotency completion share one atomic D1 batch, so concurrent requests cannot over-refund or record a false success. Reconciliation resolution is a versioned, explicitly confirmed Payments-owned Admin command. `resolveAdminReconciliationCase` requires `expectedVersion`, a reason and stable key; its immutable receipt includes the resulting case version. Current Global `refunds.manage`, case identity/version/state, linked financial recovery evidence, audit and idempotency result share one guarded transaction. Unlinked cases and unfinished Payment, Refund, cancellation or reaction work remain open with `resolutionUnavailableReason`; entering a reason alone cannot manufacture recovery. Refund cases require their identified successful Refund and completed dependent projection. Exact replay returns the original receipt after later case progress; retained historical successful keys without snapshots report already recorded. Web validates read/acceptance responses and freezes an unknown resolution for explicit saved-request retry. Downstream payment-reaction redrive remains Core-owned scheduled work rather than a second Admin retry authority.

Operational command/read contracts publish the canonical Fulfillment (`NOT_STARTED` through `COMPLETED`, with `SHORTED` resolution) and Delivery Job (`UNASSIGNED` through `DELIVERED`, with explicit failure/retry/escalation) states and command actions. Core derives `allowedActions`; the former `START|PACK|SHORTAGE` and `DISPATCH|DELIVER|FAIL` shortcuts are not accepted. Procurement aggregation computes exact paid Scheduled demand without physical-stock netting inside its version-guarded command and permits one requirement per exact procurement run/SKU, including closed requirements. Order issues have no `REOPEN` action: `RESOLVED` is terminal and further work requires a new linked issue.

## Admin Customers, Catalog, Promotions, and Fulfillment Configuration

- `admin.customers.list(filters, page) -> AdminCustomerSummaryPage`
- `admin.customers.get({ customerId }) -> AdminCustomerDetail`
- `admin.customers.invite({ email, idempotencyKey }) -> AdminCustomerDetail`
- `admin.customers.update({ customerId, changedApplicationFields, expectedVersion, idempotencyKey }) -> AdminCustomerDetail`
- `admin.customers.changeAccess({ customerId, action: "DISABLE" | "RESTORE", reason, expectedVersion, idempotencyKey }) -> AdminCustomerDetail`
- `admin.customers.revokeSessions({ customerId, reason, idempotencyKey }) -> SessionRevocationResult`
- `admin.customers.requestClosure({ customerId, reason, idempotencyKey }) -> PrivacyRequestView`
- `admin.privacy.listRequests(filters, page) -> PrivacyRequestPage`
- `admin.privacy.applyAction({ requestId, action, reason, expectedVersion, idempotencyKey }) -> PrivacyRequestView`
- `admin.catalog.listUnits({ dimension?, status? }) -> UnitDefinitionView[]`
- `admin.catalog.createUnit({ code, displayName, dimension, canonicalBaseCode, conversionNumerator, conversionDenominator, idempotencyKey }) -> UnitDefinitionView`
- `admin.catalog.createSku({ productId, code, displayName, merchandisingLabel?, sellQuantity, sellUnitId, inventoryQuantityBase, status, sortOrder, idempotencyKey }) -> SellableSkuView`
- `admin.catalog.updateSku({ skuId, expectedVersion, changed fields, idempotencyKey }) -> SellableSkuView`
- `admin.catalog.setPrice({ skuId, marketId, locationId, amountMinor, currency, validFrom, expectedVersion?, idempotencyKey }) -> SkuPriceView`
- `admin.catalog.uploadProductMedia({ productId, bytes, mimeType, altText, isPrimary, sortOrder, expectedProductVersion, idempotencyKey }) -> AdminProductMediaView`
- `admin.catalog.updateProductMedia({ productId, mediaId, altText, isPrimary, sortOrder, expectedProductVersion, idempotencyKey }) -> AdminProductMediaView`
- `admin.catalog.removeProductMedia({ productId, mediaId, expectedProductVersion, idempotencyKey }) -> AdminProductMediaView`
- `admin.promotions.list(filters, page) -> PromotionPage`
- `admin.promotions.get({ promotionId }) -> PromotionDetail`
- `admin.promotions.create({ definition, idempotencyKey }) -> PromotionDetail`
- `admin.promotions.update({ promotionId, expectedVersion, definition, idempotencyKey }) -> PromotionDetail`
- `admin.promotions.activate({ promotionId, expectedVersion, idempotencyKey }) -> PromotionDetail`
- `admin.promotions.deactivate({ promotionId, reason, expectedVersion, idempotencyKey }) -> PromotionDetail`
- `admin.promotions.archive({ promotionId, reason, expectedVersion, idempotencyKey }) -> PromotionDetail`
- `admin.promotions.preview({ promotionId, customerId?, cartSnapshot? }) -> PromotionPreviewView`
- `admin.promotions.getAudience({ promotionId, segmentQuery? }) -> PromotionAudienceView`
- `admin.promotions.setAudience({ promotionId, rules, expectedVersion, idempotencyKey }) -> PromotionAudience`
- `admin.promotions.listRedemptions({ promotionId, cursor? }) -> PromotionRedemptionPage`
- `admin.promotions.grant({ promotionId, customerId, idempotencyKey }) -> PromotionGrantView`
- `admin.fulfillment.getGlobalCommerceConfiguration({}) -> GlobalCommerceConfigurationView`
- `admin.fulfillment.pauseSelling({ expectedVersion, reason, idempotencyKey }) -> GlobalCommerceConfigurationView`
- `admin.fulfillment.activateGlobalMode({ fulfillmentMode, cadence?, expectedVersion, reason, idempotencyKey }) -> GlobalCommerceConfigurationView`
- `admin.fulfillment.openSelling({ expectedVersion, reason, idempotencyKey }) -> GlobalCommerceConfigurationView`

The commerce-configuration commands are Global-scope only. A mode switch requires selling `PAUSED`; reopening returns controlled readiness blockers until committed work is protected and active locations are ready. Location operational promises, exact prices, Instant stock readiness, and provider pickup/profile readiness are configured separately and never select another customer mode or define Scheduled capacity.

`AdminCustomerSummary` contains only authorized Customer/profile display data plus location, Order count, last Order, lifetime-spend/AOV fields only when their canonical metric definitions are approved, and creation date. Detail composes scoped addresses, Orders, Promotion/redemption, Payments summary, delivery, support-visible, and audit read models. Better Auth rows are not the Customer contract. Customer "delete" is represented by the privacy/account-closure lifecycle: access may be disabled and eligible application fields may later be anonymized, but required Order, Payment, Refund, redemption, inventory-ledger, and Audit history is never hard-deleted by a generic Customer command.

Unit and SKU commands accept integer quantities only and validate dimension compatibility. `PACK`, `BUNCH`, and `TRAY` are labels, not universal conversion codes. Promotion definitions accept only the closed benefit/rule types and validated parameters from `PRODUCT.md`; no code/expression payload exists. All Admin operations require the capability and resource scope named by Application IAM.

## Admin Customer Issues

- `admin.orderIssues.list(filters, page) -> OrderIssuePage`
- `admin.orderIssues.get({ issueId }) -> OrderIssueDetail`
- `admin.orderIssues.applyAction({ issueId, action, reason?, expectedVersion, idempotencyKey }) -> OrderIssueDetail`

The Order Issue queue projects the committed Order number, immutable recipient label and phone, customer email, category, report summary, owner, status, creation instant, and Core-derived legal next actions. Order-issue actions control intake/triage state only; they never implicitly authorize a Refund or Credit.

The existing Problems action endpoint accepts only CLAIM and RESOLVE. SUBMITTED permits CLAIM; CLAIMED and retained INVESTIGATING/ESCALATED permit RESOLVE. The Being handled filter includes all three stored in-progress states. Display New / Being handled / Resolved without altering retained status history. Global orders.manage is revalidated in the guarded report/audit/receipt batch. New success receipts store the frozen result; legacy receipts containing only a report reference retain their older read semantics. Rejected or lost-claim commands leave no report, audit or success effects. A short internal resolution note does not issue a refund or change delivery. Customer submission replay reconstructs the original SUBMITTED response from retained submission facts, even after handling. Unknown browser submissions retain the exact body and key.

## Inventory

- `admin.inventory.list({ locationId, query?, availability?, cursor? }) -> InventoryAvailabilityPage`
- `admin.inventory.getLedger({ locationId, inventoryPoolId, cursor? }) -> InventoryLedgerPage`
- `admin.inventory.adjust({ locationId, inventoryPoolId, operation: "ADD" | "REMOVE", quantityBase, reason, expectedVersion, idempotencyKey }) -> InventoryAvailabilityView`

Adjustments require capability, location scope, exact base-unit quantity, reason, and audit. There is no generic `setStock` contract.

The Admin presentation maps the signed adjustment command to explicit **Add stock** and **Remove stock** actions and shows the server-recorded ledger date. This is the default manual inventory API path. Procurement, Receiving, and Fulfillment contracts remain separate because committed demand, accepted/rejected supply, and paid-order picking/packing cannot be safely collapsed into a stock setter; their Web routes are contextual/advanced rather than primary navigation.

## Procurement and Receiving

Starting receiving is explicit. The retained `receiveProcurement` adapter only records quantities against an already-started receipt and forwards the caller's expected receipt version; it cannot silently start a receipt or substitute a fresh version. A rejected quantity command must not start preparation or persist success.

The current requirement aggregation command enforces the operational cutoff and current cycle/destination market relationship, validates exact paid SKU totals without stock netting, and guards those totals and the mutable IAM/run/requirement/receipt state with every write. It creates or recalculates only an unapproved requirement and an unstarted empty receipt. Run creation, receipt preparation, audit and original result are transactional. New replay includes the original version and quantities; historical keys without original snapshots return an explicit already-applied conflict. Browser-selected cycle/location/SKU IDs do not provide authority.

The current `startAdminReceiving` transport accepts requirement ID and expected **receipt** version; `recordAdminReceivedLine` and `completeAdminReceiving` accept the session ID and that version. Core resolves and guards the requirement context, current procurement capability and requested location scope with the receipt, allocation, audit and frozen idempotency result. New replay returns the original response even after later receiving steps. Retained successful keys without a saved original result fail closed with an explicit already-applied/history-review conflict; they never post goods again. Matching unapplied legacy claims can recover under the original versions.

Receiving read models include product/cycle names, base-unit label, Core-derived `START`/`RECORD`/`COMPLETE` actions and `legacyAcceptedBase`. The Web workbench selects a named receipt and uses its version; unknown responses retain the exact body, path and key until recovery. Accepted Scheduled goods are cycle/destination allocations, rejected goods are unavailable, and completed packing consumes the entire paid Order's exact pool demand, including committed additions, without physical stock writes. Purchase-order authoring below remains the target command sequence and is not implied by the retained requirement-based receiving adapter.

- `admin.procurement.getRequirements({ cycleId, destinationLocationId }) -> ProcurementRequirementView`
- `admin.procurement.aggregateDemand({ cycleId, idempotencyKey }) -> ProcurementRunView`
- `admin.procurement.approveRequirement({ runId, expectedVersion, ... }) -> ProcurementRunView`
- `admin.procurement.placePurchaseOrder(...) -> PurchaseOrderView`
- `admin.receiving.start({ purchaseOrderId, idempotencyKey }) -> ReceivingSessionView`
- `admin.receiving.recordLine({ sessionId, skuId, acceptedBase, rejectedBase, reason?, expectedVersion, idempotencyKey }) -> ReceivingSessionView`
- `admin.receiving.complete({ sessionId, expectedVersion, idempotencyKey }) -> ReceivingSessionView`
- `admin.procurement.resolveException(...) -> ProcurementRunView`

## Fulfillment

Fulfillment lifecycle commands persist the original result and audit in the same guarded transaction as the Order lock, fulfillment state and any Instant reservation consumption. Both operational RPC adapters pass a trusted authenticated actor; Core rechecks current capability and Global/market/location scope inside that batch. Duplicate commands return the original fulfillment status/version even after subsequent advances. Rejected new commands create neither a success result nor a stranded processing claim. Supported historical pre-transaction claims recover only through the original request identity and current aggregate guards.

- `admin.fulfillment.getWorkQueue({ fulfillmentMode?, cycleId?, locationId, state?, cursor? }) -> FulfillmentQueueView`
- `admin.fulfillment.startPicking({ taskId, expectedVersion, idempotencyKey })`
- `admin.fulfillment.recordPicked(...)`
- `admin.fulfillment.recordShortage(...)`
- `admin.fulfillment.markPacked(...)`
- `admin.fulfillment.handOff(...)`

Every command validates location scope and legal transition.

## Delivery Operations

The active boundary provides location-scoped summary/exception and external-delivery queue/detail, verified quotation/booking, refresh/cancel and normalized recovery commands. `admin.delivery.getOperationsSummary`, `admin.delivery.listExceptions`, `admin.delivery.rescheduleJob` and `admin.delivery.resolveFailure` remain purpose-specific operations; each requires the owning capability/scope and legal state. Retired map/batch/Rider contracts are preserved only in the source archive. Their raw status setters and internal-fleet workflows are not active reading requirements. Current external-delivery paging, payload and recovery safeguards follow below.

## External Delivery Provider Boundary

The Delivery application depends on a provider-neutral typed capability/policy layer and `DeliveryProvider` port with `quote`, `create`, `get`, and `cancel` operations. Capability declarations cover immediate/scheduled quote and booking, scheduling horizon, quotation expiry, supported markets/services, required package facts, contact/address wire formats, instruction fields, status/tracking/cancel/proof support, and webhook identity/authentication. This is not a general rules engine, user-authored expression surface, Web RPC, or public general-purpose HTTP API. Its request carries:

- a stable FreshMarkets merchant-order reference and provider service assertion;
- sender and recipient names, required normalized E.164 phones, and optional provider emails;
- complete human-readable origin/destination addresses and exact confirmed coordinates;
- structured building/unit, landmark, access, delivery-note, and recipient guidance;
- a positive total gram weight plus only provider-required package facts; the internal `BAG`/`BOX` classification remains outside the Lalamove payload; and
- an optional RFC 3339 pickup window created only within the provider-supported horizon.

Admin exposes three purpose-built, location-scoped Service Binding operations around this boundary.
`getLocationDeliveryProfile(locationId)` returns the authoritative store coordinate and either its
sender/pickup profile or `profile: null`. `upsertLocationDeliveryProfile` requires `delivery.manage`,
a stable idempotency key, and `expectedVersion` (`0` for the first profile); it never accepts another
coordinate. `requestExternalDelivery` requires one `jobId`, its expected Delivery Job version, the
closed provider code, and either `IMMEDIATE` or an RFC 3339 `SCHEDULED` pickup. Core derives the
service type for Scheduled work from provider configuration. Instant uses the accepted provider/service snapshot; only verified enabled providers are available under PRODUCT GD-D03.

Instant's first booking is internal: after a successful START_PACKING (or its exact replay), both fulfillment RPCs await the existing Delivery booking command. The minute scheduler finds eligible packing/unbooked jobs left by interruption; it never automatically replaces a submitted, unknown or closed attempt. The packing record and job are durable intent, and `auto-book:<jobId>` is the stable first-booking identity. Only Instant PACKING/PACKED with an eligible paid Order is admitted, including an atomic dispatch-insert check. Scheduled retains its explicit booking action. Web does not ask staff to initiate Instant's first booking.

Courier-create success saves the provider identity, normalized inbox evidence, owning command success record and required audit in one guarded transaction. Create, refresh and webhook observations share the same projection: ALLOCATING means searching, not rider acceptance. Conflicting pickup before packing remains saved for bounded reconciliation. A failed evidence write cannot leave a falsely successful local dispatch or cause a blind second create. Actual provider acceptance remains separate from local mock-provider verification.
Pickup-profile writes recheck current Staff identity, `delivery.manage`, Global/market/exact-location scope, the observed location coordinate/name, and profile version inside the same transaction as the claim, profile, required audit and frozen result. Rejection leaves no new receipt. Same-intent unfinished historical claims may recover; old identity-only successful receipts retain read-back compatibility, while new receipts always replay the original profile. The Web form validates the response DTO and retains both original payload and key after an unknown response, including a scope change, with explicit retry and locked editing.

Checkout uses Lalamove quotation for both modes. Scheduled pickup must fit its verified horizon. Booking re-quotes and records actual courier cost/variance separately; it never charges the customer again.

The request command loads the store profile, Order currency/amount and fulfillment snapshot,
immutable customer stop/contact/instructions, and derived full-order weight. It rejects incomplete
profiles or customer delivery facts, stale/assigned jobs, pickup after the committed promise/window,
and providers that are not enabled. Manual execution is a separately guarded Scheduled emergency command; no internal-fleet assignment, Rider/batch command, or route preview is offered.

The GrabExpress adapter sends recipient identity/contact and delivery data rather than removing it.
It strips only the leading `+` required by Grab's phone wire format, maps building/unit to
`keywords`, forwards combined instructions within the provider limit, sends coordinates, and omits
`cityCode`; therefore no Grab city/barangay dictionary is an application dependency. Scheduled
FreshMarkets Orders are booked near dispatch, not at checkout, because provider pickup scheduling
is limited to the near-term horizon.

The Lalamove v3 adapter uses the documented sandbox/production REST hosts and signs every request
with lowercase-hex HMAC-SHA256 over timestamp, method, exact `/v3/...` path, and exact JSON body.
It sends `Market` and nonce `Request-ID` headers, creates a short-lived quotation immediately before placing an order, uses returned stop IDs for sender/recipient contacts, retains the leading `+` on E.164 phones, and stores the FreshMarkets merchant reference in provider metadata. Customer destination instructions may use labeled CRLF-separated building/unit, landmark, access, delivery-note, and recipient-instruction lines in recipient remarks only when no separate supported field exists. Store pickup instructions and the internal bag/box classification are never placed in recipient remarks. Orders request proof of delivery. Price strings are
converted exactly into integer currency minor units. The PH integration omits Lalamove's optional
`item` object, parcel dimensions, and perishable/temperature/keep-dry handling metadata. Configured
service keys are never invented from display labels.

FreshMarkets owns the customer's grocery payment and charges the accepted merchandise/order total
plus the FreshMarkets delivery-fee component. Lalamove's quotation and final provider charge are a
separate FreshMarkets courier payable funded through the provider arrangement. The adapter never
delegates collection to Lalamove and never requests Lalamove purchase service, cash on delivery,
cash-on-delivery autodeduct, or thermal-bag special requests. It also omits route optimization for
the current one-recipient route and the channel-partner field unless FreshMarkets later receives
and explicitly configures a documented partner ID.

`requestProviderDelivery` persists an immutable request snapshot/hash and compare-and-swap claim
before the create call. Exact replay returns the existing provider dispatch; changed replay is
`IDEMPOTENCY_CONFLICT`. A create outcome that might have reached an external provider is
`DELIVERY_RECONCILIATION_REQUIRED` and cannot be blindly retried. Provider tokens, bodies, customer
data, tracking URLs, and pickup PINs never enter diagnostic logs. Production activation remains
fail-closed until Cebu/city access, sender profile, resolvable Order weight, webhook authentication,
instruction visibility, credentials, and sandbox acceptance are confirmed.

GrabExpress callbacks enter only through `POST /webhooks/delivery/grab-express`. Core compares both
configured authorization headers in constant time before reading a bounded 64 KiB JSON body,
validates the provider references and status, derives a deterministic event identity, and stores
each authenticated event once in the protected provider-event inbox. Duplicate delivery retries unapplied inbox work through the same normalized application service; already-applied effects are no-ops. Unknown dispatches, compare-and-swap collisions, and ambiguous observations are
retained for reconciliation; older observations are retained without regressing current state.
Webhook processing updates the external provider dispatch only. It does not directly fabricate a
canonical DeliveryJob, DeliveryStop, arrival, or proof-of-delivery transition. Diagnostic events
contain only request/provider/result/status identifiers, never credentials, raw bodies, contact
data, tracking URLs, or pickup PINs.

Lalamove callbacks enter only through `POST /webhooks/delivery/lalamove`. Core verifies the
documented HMAC authorization against the configured API key/secret, exact callback path, and
serialized `data` object before persisting anything. It uses Lalamove's signed `eventId` for durable
deduplication, orders status observations by `data.updatedAt`, and translates only documented order
statuses. Authenticated non-status events are acknowledged and retained as reconciliation-required
evidence until a purpose-built handler exists; in particular, an `ORDER_REPLACED` event may not
silently switch the external order identity.

## Analytics Queries

- `admin.analytics.listMetricDefinitions({ category?, status? }) -> MetricDefinitionView[]`
- `admin.analytics.getOverview({ window, scope?, dimensions?, productSearch?, productCursor? }) -> AnalyticsOverviewView`
- `admin.analytics.getMetric({ metricCode, definitionVersion?, window, timezone, dimensions? }) -> MetricSeriesView`

Analytics contracts return definition code/version, formula description, source watermark/freshness, currency/base-unit dimensions, and null/unavailable reason when a required accounting definition or source fact is missing. Published reports follow PRODUCT's approved report definitions, including first-purchase new customers, unique purchasing customers and repeat purchases. They never expose a metric under an unapproved formula, mix currencies or quantity dimensions silently, or provide mutation methods for source context state. `analytics.read` is required.

Metric-definition lifecycle filters use `APPROVED|BLOCKED|SUPERSEDED`; default lists include only current approved reports. Unversioned reads resolve the latest definition, while an explicitly requested superseded version returns a typed unavailable result. Historical blocked and retired definitions remain readable without restoring them to the current release. Overview dimensions apply only to metrics declaring that dimension and never remove unrelated metrics. `MetricDefinitionView.valueUnit` identifies counts, currency minor units or selling units. Monetary figures require one selected currency; Product quantities require one `skuId`, so different selling options are never silently summed.

Overview includes `productOptions` from purchased original/addition line snapshots in the authorized scope, including retained inactive Products. Search is bounded to 100 characters; pages contain at most 25 options with a scope/search-bound continuation cursor. This read uses `analytics.read`, not a catalog mutation permission. The Web calendar converts the inclusive selected dates to a half-open instant window in the explicitly displayed timezone. Overview figures are period totals; a single aggregate point is not presented as a trend chart.

Received money uses the first Payments success reaction creation date, independently of downstream Order commitment and subsequent refunds. Global financial totals retain historical payment purposes, including retired membership payments; location totals use attributable grocery checkout/addition payments. This does not restore membership reports or actions. Refund totals use `payment_refund.succeeded_at`, never a later retry timestamp. Missing historical confirmation dates or required location attribution return unavailable. A retained success with no precise date only affects periods overlapping its creation/last-recorded interval; neither bound becomes a fabricated success date. Global paid facts are not dropped solely because their old location snapshot is absent. Delivery costs and accepted charges use the same original paid-Order cohort. Unknown costs remain unavailable. Original Product lines and committed addition lines use their own commitment dates and count once; canceled quantities use cancellation completion separately. Promotion usage/discounts come from committed immutable applications, not unlinked historical redemptions. Totals outside the exact integer range are unavailable rather than rounded.

Exactly one definition version per metric code is current and approved; replaced definitions remain immutable. Order counts count original Orders, not amendments as additional Orders. Empty denominators return null where a ratio is published under an approved definition. New-customer reports now use first purchase rather than the archived Customer-creation formula; broader historical metric names do not require additional current-release reports.

## Contract Testing

- Compile both deployments against the shared contract package.
- Run schema/validation tests for every input and DTO.
- Test that no contract imports infrastructure/D1/provider types.
- Test authentication cookie and redirect preservation end to end.
- Test every command for unauthenticated, unauthorized, out-of-scope, invalid-transition, stale-version, and duplicate-idempotency behavior.
- Test provider ingress separately for signature failure, duplicate/out-of-order `(provider, providerEventId)`, canonical-state mapping, compare-and-swap conflict, safe retry, and reconciliation; do not fabricate webhook `expectedVersion` values.
- Test fulfillment-mode DTOs so `INSTANT` never requires a cycle and `SCHEDULED` never treats `WEEKLY` as its mode; verify committed snapshots survive configuration changes.
- Test active mass/count units, integer SKU consumption and shipping grams, absence of universal packaging conversion, exact-location nonzero pricing with no fallback, deterministic Promotion component stacking/usage limits, provider quotation snapshots, and complete Quote/Order financial components without Service Fee or processing-fee charges.
- Test selling pause/mode-switch/reopen, Scheduled independence from stock/capacity, available-courier selection and the absence of hub choice, both-mode Lalamove pricing, Scheduled-only manual fallback, final courier variance absorption, and absence of active Rider/batch/map/mock-payment contracts.
- Test notification Queue duplicate delivery, per-message acknowledgement/retry, expired leases, bounded exhaustion/dead-letter handling, and scheduled redrive without source-domain mutation.
- Test every Admin/Analytics query for capability/scope enforcement, no Better Auth/raw-row Customer leakage, definition-version consistency, and read-only source ownership.
- During deployment, maintain compatibility for any interval in which Web and Core versions may differ.

## 2026-09-07 Setup and Operations Contract Requirements

The Global commerce control retains the complete original pause/mode-switch/reopen request and idempotency key after an unconfirmed response. Fields and replacement commands remain disabled through scope changes; explicit retry uses the original request. Runtime response validation distinguishes a Core result from a transport/parse failure, and stale reads cannot overwrite an in-flight command's reviewed state.

`getAdminLocationSchedule` requires Global `locations.read` and returns location name, market timezone, location version, explicit weekly hours/dated closures or null, and the management decision. `saveAdminLocationSchedule` requires Global `locations.manage`, location expected version, the complete schedule, reason and stable key. Core rejects reversed/overlapping weekly intervals and invalid closures, then atomically advances location/geography versions, persists hours, invalidates unstarted Quotes, audits and saves the original receipt. Lost responses retain the original Web payload/key. Weekly values are local minutes within a weekday; closure instants are UTC evidence, entered through date/time controls and reviewed in the market timezone. Missing configuration never authorizes 24-hour service. Existing started Payments retain reconciliation, and committed Orders retain their promises.

`getAdminLocationFulfillment` returns the location name/version, dispatch readiness, nullable Instant promise in integer minutes, setup blockers and management decision under Global `locations.read`. `configureAdminLocationFulfillment` requires Global `locations.manage`, the location expected version, complete readiness/promise settings, reason and stable key. Enabling dispatch requires an active customer site and market, picking/packing/dispatch capabilities, operating hours, courier pickup profile and currently eligible service area. Core rechecks these mutable facts and authority in the same transaction as location/readiness/geography versions, unstarted-Quote invalidation, audit and the frozen result. Warehouses cannot dispatch customer orders. New commerce in both modes requires dispatch readiness; only Instant requires the minutes promise. Web retains the full request/key after an unknown response. Later readiness changes or retired capacity fields cannot prevent commitment of a provider-confirmed payment; Instant commitment still requires its exact held quantities and atomic stock reservation.

Cycle setup uses `listAdminDeliveryCycles` (20-row stable ID pages plus active market context), `listAdminCycleDestinations` (50-row market-bound zone/location pages), `saveAdminDeliveryCycleDraft`, `scheduleAdminDeliveryCycle`, and `cancelAdminDeliveryCycle`. Reads require Global `fulfillment.read`; commands require Global `fulfillment.manage`. Draft save carries explicit timing, named windows, participation, reason and expected version (zero for creation); scheduling and cancellation carry cycle identity, current version, reason and stable key. Core validates the complete write set and current authority/destinations atomically, then returns a frozen original receipt. Matching replay precedes later lifecycle rejection; changed intent conflicts. Unknown Web responses retain the complete original request and key for explicit retry.

Unpaid cancellation permits only DRAFT, SCHEDULED or OPEN cycles without Orders, unresolved/confirmed Payments or retained checkout holds. The read model explains cancellation blockers; the command rechecks them within the transaction, invalidates all unstarted active Quotes and processing attempts, and requires transition, audit and receipt together. Inactive destinations do not prevent this recovery operation. Cycles with financial or operational commitments need coordinated resolution and cannot use this command.

The Scheduled option's delivery window includes its configured identity/name and actual start/end instants. Core resolves that identity from the opaque customer option; a browser-supplied cycle/location/provider is not authority. Quote and payment creation fence the accepted window and planned pickup; the customer Order detail renders immutable committed window evidence when available. Retained Orders without that evidence expose their original date, never a fabricated 24-hour window. Operating-hours configuration, subsequent cycle operations and provider acceptance remain separate acceptance work.

`getAdminSkuPrices({ skuId, locationId })` requires Global `prices.read` and returns exact target currency/market, the currently effective price or null, the latest expected price version, Core's management decision and the latest 25 historical versions with their own currency and effective instants. `setAdminSkuPrice` requires Global `prices.manage`; catalog permission alone is insufficient. Its complete write batch rechecks current staff/global-scope/capability and active location/market/currency before closing a prior price, inserting the successor, auditing and completing idempotency. Local catalog views retain read-only prices and authorized selling activation. Global Product detail provides the price target/editor; role grants remain explicit.

These target contracts supersede conflicting historical implementation descriptions above. They require reachable Web adapters, runtime validators, Core authorization and atomic effects before acceptance; this list is not an implemented service manifest.

- Global location create/update/deactivate, structured address/pin finalization, capability/schedule/closure setup, service-area/zone authoring and assignment preview use `locations.read`/`locations.manage`. Core supplies versions, legal actions and eligible scope choices. No operator types internal IDs manually.
- Global exact-location pricing uses `prices.read`/`prices.manage`; price writes require global scope even for a location target. Local catalog activation retains scoped authority and read-only prices.
- Staff/customer invitation acceptance derives verified identity from Better Auth and matches the invitation email, expiry and state atomically. Profile updates use explicit owned fields under PRODUCT GD-D01; name/contact editing remains a reconciliation gap alongside existing preference commands. Support notes stay append-only. Closure records an audited request and access state; irreversible anonymization is unavailable until approved retention/field policy exists.

Implemented staff acceptance rechecks the current authentication user's normalized email and verification at the Core write boundary. The invitation transition, every saved role and scope grant, staff identity, required audit and successful command receipt commit together. A suppressed required effect rolls back the whole command. Identical successful retries return the original staff identity; retained unfinished claims with the same request hash may be reclaimed within that transaction. Different intent under the same key conflicts. Web preserves the acceptance key when a response is lost.
- Product/campaign upload/update/remove and anonymous published-media reads use opaque identity/version, bounded bytes, MIME/signature/size validation, ETag and owner-publication checks. No caller object keys or private payloads are returned. Failed storage/metadata work has durable cleanup recovery.
- Global transfer dispatch, destination receipt and Global discrepancy/return resolution require transfer capability plus scope. All use stable command identities and per-line effects; receipt cannot credit another location or overspend outstanding transit.

The physical movement surface is `listInventoryTransfers`, `getInventoryTransfer`, `getInventoryTransferOptions`, `createInventoryTransfer`, `dispatchInventoryTransfer`, `receiveInventoryTransfer`, `cancelInventoryTransfer`, `resolveInventoryTransfer` and `listInventoryDistribution`. `transfers.read` permits Global reads or reads scoped to a transfer's source/destination; creation, dispatch and draft cancellation require Global `transfers.manage`, while acceptance requires that capability at the destination (Global and market scope apply normally). Actor identity comes from the authenticated Core session, never the payload. Options return named active warehouse/destination choices and up to 100 matching GRAM/PIECE pools with physical, reserved, held and available quantities. Lists use a status/location filter and opaque cursor with a maximum page size of 100. Details return snapshotted product/unit lines, accepted/lost/returned quantities, outstanding physical transit and current damaged/missing subsets, legal actions, and the latest 100 records each of immutable accepted receipts, checks and resolutions. Draft and canceled quantities are planned quantities, not transit.

Create accepts 1–50 distinct pools, positive integer base quantities, source/destination, reason and a stable key. Other commands also require the expected transfer version; checked receipt identifies lines, nonnegative newly accepted quantities and optional current damaged/missing quantities remaining after acceptance. A zero-credit check must explicitly report observations; it creates no sellable stock or accepted-receipt row. Updating observations while accepting recovered goods records both in one command. Dispatch revalidates active warehouse/customer-site purpose and warehouse receiving/inventory capability, then deducts stock after both reservations and checkout holds. Committed transit can still be received when the destination is later inactive. Catalog selling activation, exact prices and Scheduled allocations do not control physical movement. A guarded D1 batch contains current authority, the aggregate transition, every line/balance/receipt/ledger effect, audit and the frozen successful result. Any missing required effect rolls back all of them. Identical successful retries return the original result even after subsequent transitions; changed intent conflicts. Distinct per-line effects have distinct stable identities. Web exposes ordinary draft, dispatch, checked acceptance and cancel actions, retaining the original body/key after an unknown response. `resolveInventoryTransfer` requires Global `transfers.manage`, the expected transfer version, line, positive quantity, an outstanding category (`UNCLASSIFIED`, `DAMAGED`, `MISSING`), outcome (`LOSS`, `VERIFIED_RETURN`), reason and key. A verified return additionally requires explicit physical receipt and sellable inspection confirmation. Resolution cannot exceed its selected outstanding category; loss consumes transit with immutable resolution evidence and no second physical deduction, while a verified return also credits source stock/ledger atomically. Fully accounted goods close to `RECEIVED` only for complete destination acceptance, otherwise `RESOLVED`. Web keeps receipt observation and Global resolution behind ordinary named actions, preserving an unknown request behind the same button.

`listInventoryDistribution` requires Global `transfers.read` and returns a bounded product-name search/cursor page (default 25, maximum 100) of per-pool GRAM/PIECE totals. Central/site/total physical stock, reserved, checkout-held, transit, damaged and missing quantities remain separate; reservations/holds are subsets of physical stock and damage/shortage are subsets of transit. These are derived read values, never another stored Global balance. Unsupported numeric totals are unavailable rather than rounded into valid authoritative quantities.

- Global cycle/window authoring includes open/cutoff/purchase/preparation/pickup/arrival instants and participation. Procurement aggregate/approve/purchase/start receiving/record/resolve/complete form a reachable command sequence. Scheduled receipt/packing targets cycle goods; inspected surplus release is an explicit audited command.
- Preparation start locks Order cancellation atomically. Booking requires Instant picked/checked + packing started, or Scheduled checked receipts + credible ready time. Packed completion consumes the appropriate stock/allocation exactly once. Normal handover rejects unpacked goods.
- Scheduled booking exposes Core-owned `courierPickup.allowedKinds` and a plain unavailable reason in the scoped queue. Future pickup requires active preparation, complete exact paid-demand coverage (including committed additions) and enough accepted cycle goods; packed Orders use their recorded cycle-goods consumption instead of requiring the same quantities in the remaining balance. Immediate pickup requires PACKED. The operator supplies the future packing-ready pickup time using the existing booking form. Admission rechecks goods/preparation and time before a provider request: future pickup must still be ahead of the current clock, and pickup cannot exceed the immutable delivery-window end (retained Orders fall back to their saved delivery date). This is delivery readiness, not a Scheduled sales capacity, physical-stock reservation or predicted dispatch engine. Exact successful replay precedes mutable readiness rejection.
- Scheduled manual assignment requires reason, person name/phone and definite closure of any prior attempt. Manual handover/completion/failure is versioned and audited; unknown cost remains unavailable. Core rejects every manual command for Instant.
- `manageManualDelivery` requires current scoped `delivery.manage`, job/location, stable key and expected version. `ASSIGN` uses the job version and requires reason/person/phone; `HAND_OVER`, `COMPLETE` and `FAIL` use the selected manual attempt's version. Completion/failure accepts nullable actual cost in minor units; failure also requires a reason. Core derives `manualActions` in the delivery queue. Assignment requires an unassigned/retry Scheduled job, or a FAILED Scheduled job whose latest attempt is definitively CANCELED/FAILED before handover. Recorded handover, returned goods and out-for-delivery custody require separate recovery; pending cancellation and active/unknown attempts block replacement. Handover requires packed fulfillment and a ready Order; completion requires this attempt's recorded handover. Custody, job/stop and Order progress, audit and frozen receipt commit together. The ordinary fulfillment command cannot bypass active manual custody. Failed attempts leave delivery FAILED, retaining custody and Order facts for separate recovery; no return, retry or refund is inferred. Unknown financial evidence remains null, while known cost records the accepted Order/addition delivery charges, currency and variance without changing customer charges. Web preserves the exact body/key after an unknown reply. These policies are Core command guards, not schema authorization; execution evidence remains in the active checkpoint.
- Webhook, refresh and inbox redrive invoke one normalized Delivery application path. Searching is distinct from assigned, active/uncertain attempts are exclusive, prior-attempt observations cannot overwrite current work, and courier cancellation never cancels a grocery Order.

Use [Engineering](ENGINEERING.md#pre-launch-schema-and-interface-policy) for the retained-baseline boundary and [Architecture](ARCHITECTURE.md) for ownership. Membership RPCs, membership navigation/errors/jobs and local price writes described in historical slices are removal work, never active target authority.

### Staff creation atomicity

`AdminStaffInvitationView.version` carries current invitation concurrency evidence. `revokeAdminStaffInvitation` requires that `expectedVersion`, a reason and a stable key. Current Global staff authority, the `PENDING` transition, required audit and the frozen revocation receipt are atomic; acceptance and revocation cannot both win. Old creation snapshots without a version represent their known creation version one. Legacy successful revocation receipts can replay their original pre-version intent, but new commands cannot omit a version. The Staff page keeps an unconfirmed request unchanged and exposes an explicit retry before allowing a different action.

Staff rename and access changes resolve successful replay before mutable state rejection. Their transaction checks current Global authority and the reviewed staff version/state, requires the change and audit, and saves the original staff-detail receipt with the transaction's current role/capability/scope relations. Later edits do not change that receipt. Legacy resource-only successes retain read-back compatibility. The staff detail screen blocks replacement while an action is unconfirmed and retries the exact original body/key.

`AdminStaffDetail.roleIds` is the complete assigned-role identity set, independent of the paginated role picker. Role replacement preserves off-page assignments selected by the operator and atomically requires the reviewed staff version, deletion of the old set, each currently active role, audit and original detail receipt. Scope replacement uses the same guards and rechecks every active market/location and parent relationship in its transaction. Retained detail receipts without role IDs resolve their saved immutable role codes, never the staff member's current assignments. Scope or role eligibility changes after a successful command do not prevent replay of its saved result by a currently authorized administrator.

Role profile, capability replacement and archive commands revalidate current Global authority and the reviewed active role version in the same transaction as every required effect. Capability replacement requires complete deletion and each named permission grant; the original validated role receipt is saved atomically and can replay after later changes or archive. Archive retains existing assignments and history while preventing new assignment; it does not silently revoke those existing grants. Role creation/detail forms retain the exact unconfirmed body/key and block replacement until recovery.

`revokeAdminStaffSessions` guards current Global authority, the observed target identity/version and session count, then requires complete deletion, audit and frozen count receipt atomically. A concurrent session-count change rejects the transaction for same-key retry. Successful replay never deletes sessions from a later login; legacy numeric success receipts remain readable. This command uses Better Auth's existing session store and does not create application-owned session state.

Staff role creation and invitation creation recheck current active Staff identity, `staff.manage` and Global scope in the same Core transaction as every required grant, audit and command receipt. Rejection leaves no newly claimed receipt or partial access. New creation receipts preserve the original DTO when the role or invitation later changes; preexisting success records that saved only a resource identity retain their historical read-back compatibility. Unfinished same-intent claims may be reclaimed atomically. This does not accept the remaining staff lifecycle commands, which need their own current-authority, state/version and required-effect verification.

### Initial administrator setup

`getInitialAdministratorSetup` is an authenticated Core query with `UNAVAILABLE`, `VERIFY_EMAIL`, `READY` (expected version zero), or the caller's `COMPLETED` receipt. It never exposes the configured email or another account's setup identity. `completeInitialAdministratorSetup` accepts only an idempotency key and expected version zero; identity comes from Better Auth. Core requires the configured verified email, no prior setup, no Global staff scope and no existing Staff identity for the caller. Current identity, all explicit grants, immutable setup evidence, audit and command receipt are one guarded transaction. Identical completed replay remains available after setup configuration is removed. Web exposes this documented one-time workflow at `/setup`; see [setup operations](../operations/INITIAL_ADMINISTRATOR_SETUP.md).

### Verified provider identity recovery

`refreshExternalDelivery` accepts an optional bounded `providerDeliveryId` candidate only to recover a missing identity on a previously submitted uncertain booking. Core requires `delivery.manage` and the dispatch location scope, retrieves the candidate from the configured provider, and requires its returned merchant reference to match the saved booking. An existing identity cannot be replaced. Association, original booking idempotency completion, recovery audit and durable observation are atomic; observation projection uses the shared guarded application path. A mismatch or competing claim leaves no association or booking success. This recovery performs no new provider booking.

### Bounded customer order history

listCustomerOrders accepts an authenticated request plus optional limit (1–100, default 25), filter (all, active, completed), and cursor. It returns { items, nextCursor }. Core applies ownership and status filtering before keyset pagination on descending (COALESCE(committed_at,created_at),id); the cursor is versioned and bound to customer/filter. Invalid or cross-context cursors are rejected. The cursor is navigation data, never authorization. History preserves canonical and explicitly retained historical status vocabulary. Web loads subsequent pages, resets paging on filter changes, and renders loading, retryable error and unauthenticated states separately from empty results.


### Global service-area publication and routing

Global service-area administration uses `getAdminServiceability`, `publishAdminServiceArea` and `previewAdminServiceability` through typed Service Bindings. Reads require Global `locations.read`; publication requires Global `locations.manage`, expected area version, a reason and a stable key. Area pages use stable market/code cursors (20 areas); eligible-location pages use stable location-ID cursors (50 sites). Publication accepts simple ordered boundary vertices, named delivery zones and explicit eligible customer-fulfillment locations in the same active market. Core rejects degenerate/self-intersecting polygons and zones crossing the area boundary. It publishes a new retained area/zone version, retires prior active coverage, advances geography revision, invalidates unstarted quotes, and records audit/idempotency together. Started payments retain reconciliation and accepted terms. New Scheduled zone participation must be configured explicitly. Complex retained polygons are never flattened silently by the editor.

Publication checks every required insert and the complete retirement/invalidation sets inside the transaction. Missing area, zone, location link, geography revision, audit or receipt rejects the whole publication. Suppressed retirement retains the old boundary; a failed command can retry with its original key. A historical report of publication is not evidence that these effects were present before the guarded implementation.

The Global routing preview and checkout options/quotes use the same current geofences, timed eligibility links, customer-site purpose, capabilities and mode readiness. Overlap selection uses exact Haversine distance and stable location ID; saved address zone labels do not authorize routing. Quote evidence includes geography/global-mode versions. Geography changes during courier quotation reject the complete quote batch, and payment initiation rechecks geography inside its durable-intent transaction before contacting the payment provider. Existing payment-command replay remains available after geography changes.


### Payment lookup recovery

`recheckAdminPayment({ paymentIntentId, expectedVersion, expectedRecoveryVersion, reason, idempotencyKey })` requires current Global `payments.manage` and a pre-commitment Payment. It atomically resets a bounded read-only lookup identity, required audit and frozen `{ paymentIntentId, state: QUEUED, version, acceptedAt }` receipt. An active unexpired lease, changed versions, revoked scope or reused key with another intent rejects all dependent effects. `AdminPaymentDetail.lookupRecovery` supplies current progress and availability separately. Web preserves the exact unknown request and retries its original identity.

The scheduled sweep introduces at most ten stale pre-commitment Payments and claims at most ten due identities per run. Each identity receives at most five provider lookups with five-minute leases and exponential backoff; interrupted final attempts escalate without a sixth call. Provider unavailability and local application failure remain controlled recovery diagnostics, never financial failure. Existing Refund and paid-commitment recovery retain their owning paths. Later canonical terminal evidence can complete lookup recovery without another provider call.


Payment creation stores the adapter's response before applying its local Attempt/continuation. PayMongo network/server failures and unreadable or malformed creation responses remain unknown outcomes: the original intent stays INITIATED with a reconciliation case, and replay continues to report PAYMENT_OUTCOME_UNRESOLVED without resubmitting creation or presenting an invented ready action. Only explicit provider request rejection is recorded as a definite failure. Identical creation replay and scheduled provider lookup can adopt an unapplied stored response under current identity/version guards without calling createPayment again. Lost or ignored dependent writes roll back the entire adoption and retain the response for retry. Creation still yields only a pending/action state; provider-confirmed canonical success remains mandatory for Order commitment. An unusable/expired continuation never becomes a customer action, but its saved provider reference remains available to financial lookup. A response lost before any durable reference was captured, or historical missing linkage without such evidence, remains an explicit reconciliation exception; absence never authorizes another charge.


Promotion grants recheck active Customer and its matching active commerce principal inside the complete write transaction. Selecting a customer in Admin uses the existing capability-protected customer search by email/phone. Disabling commerce access cannot race a grant into a partial write or successful receipt.


The implemented binding names are `getAdminPromotionAudience` and `setAdminPromotionAudience`, with same-origin GET/PATCH `/api/admin/promotions/:promotionId/audience`. Audience replacement is a draft-only command requiring Global `promotions.manage`. It validates the closed FIRST_ORDER, NEW_CUSTOMER, MINIMUM_SUBTOTAL, CUSTOMER_SEGMENT and SPECIFIC_CUSTOMERS shapes, up to ten conditions and twenty distinct customers per customer condition. Every condition must match at checkout. Empty conditions intentionally remove audience restrictions; dates, definition minimum and usage limits still apply. Selected references must identify active matching Customer/commerce principals or active segments at the write boundary. The complete replacement, campaign version, audit and frozen result commit together. Any missing delete/insert effect or raced reference/authority/lifecycle guard aborts the complete command. Replay returns the original audience/version even after later activation.

Audience reads expose typed rules, an unsupported-condition count, bounded active segment choices with optional name search, and customer display labels only with Global `customers.read`. Unsupported retained rules never become an empty eligible rule set: checkout fails them closed, activation rejects them, and the draft editor requires explicit replacement before saving over them. This does not erase retained redemption/Order snapshots. Segment assignment remains Customer-owned data; this endpoint does not edit segment membership.

## Selected-item sales (CA-3.4)

Promotion Create/Update accept optional `productTargets` containing `skuId`, `locationId` and nullable `quantityLimit`. Targets are edited only while Draft; nonempty targets make the merchandise benefit an automatic product sale. Summary/detail and immutable command receipts include each target's configured and remaining quantities plus Product, option and location labels. Activation rechecks current targets and overlapping active date ranges inside the same transaction. Stopping a sale prevents new discounts without repricing already accepted paid Orders.

Product-sale quote applications retain the existing `MERCHANDISE` component and add `kind: PRODUCT_SALE` plus exact `{skuId, quantity, amountMinor}` line allocations. `itemDiscountMinor` sums those allocations; `orderDiscountMinor` contains the separate grocery benefit on full-price eligible lines. One delivery benefit remains separate. Payment commitment matches claims by promotion and component, validates the complete stack and line allocation, and commits allowance, stock, redemption, Order and receipt together. Older snapshots may omit the new fields.

Quote refresh cannot replace an active quote with a paid or unresolved payment. Both fulfillment modes guard this at the write boundary; an Instant refresh cannot release its stock hold and expose its reserved sale quantity. Existing payment/reconciliation owns settlement, without an extra operator workflow.

Catalog variants keep their regular `priceMinor` and may include Core's current one-unit `sale` price, name, end time and remaining quantity. Public catalog prices advertise only unconditional offers; customer, usage-per-customer and basket-minimum conditions require checkout facts. Cart evaluates its actual quantities through the same promotion policy, keeps regular `unitPriceMinor`, and returns discounted `lineTotalMinor` with optional `regularLineTotalMinor`. Web renders these decisions rather than choosing promotion eligibility. Subtotal-only Admin preview rejects product sales because it lacks items, quantities and location. A campaign banner identifies an automatic selected-item sale instead of advertising its identifier as a grocery code.

Local implementation and acceptance are tracked in the active checkpoint; these contracts do not imply provider or deployment acceptance.

## Product decision contract gaps

PRODUCT GD-D01–21 and its approved owner supplements account for changes against this implementation baseline. Existing preference-only profile DTOs, FIRST_ORDER/NEW_CUSTOMER stored names, whole-subtotal promotion previews and generic Product-pool quantities are retained interface evidence, not a prohibition on the approved replacement. Reconcile customer identity/contact ownership, actual counted-size receiving, item-sale allocation and quantity restoration, five-image CRUD/gallery, and the complete-order 20,000 g calculation across Core, contracts, storage and Web. Percentage and fixed discounts per selling unit are approved; overlapping active product sales for the same option/location are rejected. No packaging allowance or size/fit inputs are required.

The approved Problems list, weekly view and receiving form use purpose-built scoped reads and ordinary actions. Their presentation must preserve current authorization, transaction and recovery safeguards without exposing technical steps as operator work. The approved purchase-based customer reports replace conflicting historical metric meanings. These requirements do not claim that replacement contracts or their application paths already exist; keep their acceptance gaps visible.


### Actual count commands (CA-4.3)

Global Product creation accepts `stockTracking` (`SHARED` by default or `COUNTED_SIZES`). Counted sizes use a GRAM bulk receipt pool and fixed one-piece/pack selling options with their own positive recorded shipping grams. Existing omitted/default shared requests retain their original replay identity. The Product detail reports its tracking choice and each dedicated size pool; operational inventory lists distinguish bulk awaiting counts from exact counted sizes.

`receiveInventoryTransfer` may include `sizeCounts` on a newly accepted line. Each entry identifies a distinct current size belonging to that counted Product and a positive actual integer count. The accepted grams and counts are accounted for in the same transaction, with original sent weight and accepted receipt unchanged. Blank counts leave goods awaiting counting, never manufactured availability. Receipt details expose current count options and immutable recorded counts.

`sortInventoryStock` requires authenticated, currently scoped `inventory.adjust`, Product/location, measured grams, distinct actual size counts, current bulk version, reason and stable key. It consumes existing bulk goods once; it does not receive another shipment. Mutable scope and all stock/evidence effects are checked in one D1 batch. Identical replay returns the original sort identity; changed intent conflicts. Web keeps the original request behind its normal Save counts action after an unknown response. This is an ordinary stock/receiving form, not a recovery workspace. Phase 5 separately owns Scheduled allocated receipt/sorting.

### Delivery-week workspace (CA-5.1)

`getAdminScheduledWeek` requires scoped `procurement.read` and returns named cycle choices, the selected location/week dates and one bounded page of exact demand, Orders/preparation, or current locally enabled catalog options. Order/preparation rows additionally require `fulfillment.read`; denied access is explicit, never an empty-success metric. Demand includes original/paid-addition OPEN exact-line records and excludes canceled demand; physical stock is never subtracted. Current offers are labelled as current configuration, not historical cycle-specific catalog snapshots. Cycle choices and section rows paginate; this is an operational projection, not another owner of commerce state.

`confirmAdminProcurementPurchase` requires currently scoped `procurement.manage`, cycle/location/SKU/pool, reviewed exact base and selling quantities, expected requirement version (zero for no requirement), a reason and stable key. The normal Web confirmation captures those read-model values internally. Core rechecks current cutoff, demand, scope, requirement/receiving state and every purchase/audit/result effect in one transaction. Changed reviewed quantities require refresh; replay returns the original receipt. Supplier contact stays manual and no supplier portal, outbound message or additional approval engine is introduced. Existing purchase storage is reused. Scheduled receiving/counting, shortages, packing, surplus and the complete provider-origin journey retain their separate Phase 5/7 acceptance obligations.

### Scheduled purchase readiness (CA-5.5)

New addition payment admission rechecks Order ownership/state, amendment version/amount/currency, cutoff and open cycle in the same transaction as the Payment intent and its amendment link, before contacting the provider. A rejected admission writes neither intent nor link. Original payment-key retries remain recoverable after cutoff; another key cannot replace an already-linked payment. A successful started addition reaction uses the recorded start time against the immutable Order cutoff, rather than requiring the cycle still be open when confirmation arrives. Existing Order, Payment version and refund guards still apply.

The weekly read returns `week.purchaseBlockedReason` while started original or addition payments for that cycle remain unresolved. Purchase actions are unavailable until canonical commitment or definite closure accounts for them; browser expiry is not payment closure. The ordinary weekly view refreshes while pending. Aggregation may still describe currently committed demand, but purchase confirmation checks readiness again inside its complete D1 transaction before freezing quantities. The same Payments-owned predicate protects inspected surplus; pending reactions, unapplied creation observations and unresolved provider inbox evidence cannot be discarded. Successful started payments can still commit exactly once after cutoff. No new provider action, operator recovery step or storage lifecycle is introduced.

### Consolidated destination purchases (CA-5.6)

Omitting `locationId` from `getAdminScheduledWeek` requests the consolidated demand view and requires both Global scope and `procurement.read`. Orders and current offers still require an explicit authorized location. Demand rows carry the named destination, its exact quantity and whole-SKU/pool totals across the selected scope. These totals are calculated before the bounded destination page, include OPEN exact paid original/addition demand and exclude canceled demand; they never subtract physical stock. Cursors order SKU/pool/destination identities and must be reset when the selected scope or week changes. A local reader receives only local rows and local totals; omitting the location cannot widen their authority.

Global purchase actions additionally require `procurement.manage` and retain the existing exact-location confirmation command. The reviewed form names its destination and preserves that original destination/body/key after an unknown reply. Confirming one destination never marks another destination purchased. This read model adds no storage balance, supplier workflow or cross-location purchase transaction.

### Scheduled receipt discrepancies (CA-5.2)

The ordinary receiving form links to affected Orders through the weekly read's optional `requirementId` filter (CA-5.7). That filter requires the Orders section, an explicit authorized location and the matching week. Core verifies the requirement's cycle/location and selects only its exact SKU/pool demand; original and committed addition demand share that projection. Canceled demand remains traceable with zero open quantity. Order cancellation status is separate, so released quantities never imply confirmed refunds. Existing Global `orders.manage` business cancellation retains its reason, version, original idempotency key and coordinated payment set; the link creates no new cancellation authority. Original receiving rejection/missing evidence remains unchanged. CA-5.8 adds internal audited resolution in accepted cancellation when a fully accounted tracked receipt has enough received cycle goods for remaining unpacked paid demand. This is an effect of the guarded cancellation command, never the read. The receiving projection exposes `resolvedByCancellation` separately from the original receipt state and current refund progress; resolved tracked issues leave the operational list.

`recordAdminReceivedLine` accepts optional `shortageBase` for goods not delivered, or `receiptKind: REPLACEMENT` with a positive accepted quantity and zero rejected/missing quantity for inspected replacement goods of the same requirement. Original expected, rejected and missing quantities remain evidence; replacement receipts increase accepted cycle goods only. Accepted total never exceeds the original paid requirement. The normal receiving view supplies allowed actions and current versions; supplier contact remains manual. New commands expose missing and replacement totals in receiving and the delivery-week projection.

Each new rejected/missing observation creates an OPEN supply exception in the same batch as the receipt, accepted cycle allocation, immutable receiving/stock evidence, audit and command result. Partial replacements leave exceptions open; fully replacing the outstanding goods resolves only this receipt's tracked exceptions with `REPLACEMENT_RECEIVED`. Current scope, requirement/receipt versions and open-exception count are checked inside the transaction. Identical retries return original results; changed intent conflicts. Retained receipts without this linked discrepancy evidence, or with legacy physical-stock receipts, are not silently converted into the replacement flow. Financial cancellation/refund resolution stays with Orders/Payments; no supplier substitution or financial-success shortcut is added.

### Weighed Scheduled produce (CA-5.3)

`recordScheduledCountedReceipt` requires current scoped `procurement.manage`, one location/cycle/counted Product, a measured nonnegative received weight, DELIVERY or REPLACEMENT, a reason, stable key and 1–50 distinct size receipts with current versions and actual accepted/rejected/missing counts. Positive arrived counts require a positive measured weight; a wholly missing receipt records zero weight. No conversion uses estimated SKU shipping grams. Counted receiving uses this grouped command; ordinary fixed-weight receiving retains its command. A newly purchased not-started size can be inspected directly in this normal grouped form without an extra Start action.

Core prepares the existing guarded per-size receiving effects and commits them with one immutable weighed receipt, links, audit and group result in a single D1 batch. Any invalid/stale/unauthorized line or missing required effect rejects the complete group. Replays return the original weighed receipt. Weighed replacement uses the existing outstanding-quantity and discrepancy rules. The receiving read model includes the latest five complete weighed receipts with snapshotted Product/week/size names and observed counts; it is explicitly a recent list, not a complete-history metric. The UI retains the original scope/quantities/key during an unknown response, including while the scope header changes. Measured grams record the same goods as those actual counts and never credit a second physical or cycle gram balance.

### Inspected Scheduled surplus (CA-5.4)

`releaseScheduledSurplus` requires scoped `procurement.manage`, cycle/location/pool, current cycle-goods version, positive integer base quantity, explicit inspected-as-sellable confirmation, reason and stable key. Receiving supplies bounded per-balance unused/released quantities and any blocked reason. Unused means accepted receipts minus packed, previously released, disposed and outstanding OPEN paid demand without an immutable packing movement. Missing fulfillment records or operational exceptions do not release that demand.

Core requires cutoff to have passed and protects unresolved original/addition payment commitment for the week, including pending reactions, unapplied creation observations and provider inbox recovery. This is an internal release safeguard, not an operator reconciliation shortcut or a new provider-success definition. A successful release atomically reduces remaining cycle allocation, credits the same physical pool, and writes immutable movement/ledger/audit/result evidence. Rejected/spoiled quantities cannot enter through a release; counted pools credit actual pieces only. Every prerequisite is rechecked in the same D1 batch. Unknown responses retain the original request in the normal form; identical retries return the original release. Supplier overage receiving, un-packing canceled goods and financial refunds remain separate owning operations.

Scheduled packing verifies that both its immutable movement insert and balance update affect every distinct demanded pool. A missing per-pool effect aborts the full fulfillment transaction, including status, audit and success receipt; later surplus calculations cannot treat a partial packing write as completed evidence.

Courier retry uses the existing external booking request. The queue field is now courierPickup (formerly scheduledPickup), covering Scheduled booking and explicit Instant retry. Instant initial booking remains automatic. A current, definitely closed pre-handover attempt permits replacement while the original promise/window remains valid; the original customer-selected provider and charge remain unchanged. Admission of a FAILED-job retry atomically inserts the new numbered attempt and moves job/stop to RETRY_SCHEDULED before provider submission. A lost claim leaves neither effect. Pending create/cancel outcomes and uninspected returned/post-handover goods block replacement. New merchant references distinguish attempts; existing old-event reconciliation remains authoritative. The agreement flow below records revised times and explicit return inspection before replacement.

### Customer-agreed delivery time

`reviseDeliveryPromise` / `POST /api/admin/delivery-promises` accepts location/job, expected job version, a future ISO delivery time, a short record of the customer's agreement and an idempotency key. Core requires current scoped `delivery.manage` and the latest definitively closed attempt; uninspected goods that left custody are excluded from a deadline-only change. It rejects active/unknown/cancel-pending attempts and canceled/terminal Orders. Goods that have left custody require the explicit return inspection described below. Agreement, operational deadline, audit and frozen result commit together. It does not book a courier, change the paid amount, refund or touch stock. Exact authorized replay returns the original result even after the agreed time passes.

The existing queue exposes `canRevisePromise` from Core's current eligibility. Existing courier booking reads the latest agreed deadline in both modes and still enforces preparation, payload, selected Instant provider and attempt exclusivity. Customer Order detail exposes `fulfillment.agreedDeliveryAt` separately from original `promisedAt` / `deliveryWindow`; the agreement note remains internal. Associated notification delivery remains a distinct unfinished acceptance obligation.

For a physically returned order, the same request accepts `returnInspection: { allGoodsSuitableAndPacked: true, note }`. Core exposes `canInspectReturnedGoods` only for the latest definitively closed attempt with departure/return evidence and still-packed paid fulfillment. Staff must confirm all groceries are physically back, inspected, suitable and packed, and record the customer's redelivery agreement. In one guarded transaction, Core retains the separate inspection facts, restores fulfillment to PACKED and Order to FULFILLMENT_READY, records the agreed time, audit and frozen receipt. This never credits inventory, repeats packing consumption, changes charges or creates a refund. The same future deadline may be retained for this return review. Ordinary MARK_PACKED remains restricted to active PACKING; it cannot perform this custody recovery.

Only the inspected attempt qualifies for subsequent courier retry or Scheduled manual assignment. A later failed/returned attempt needs its own inspection; replay of an earlier successful inspection cannot restore custody again. The manual queue exposes its inspection timestamp and says Returned and inspected while retaining the prior handover/cost evidence. Missing or unsuitable groceries remain under review without redelivery through this command; no automatic financial resolution follows.
