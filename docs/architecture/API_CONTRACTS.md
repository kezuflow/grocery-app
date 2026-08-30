# Web to Core Application Contracts

## Contract Principles

This document is authoritative for target Web/Core and provider-ingress application boundary semantics. Contracts live in `packages/contracts` and are shared as source/types within the monorepo. They define RPC method names, input validation, purpose-built DTOs, stable error codes, and pagination. They never export D1 row types, Better Auth table records, provider payloads, or infrastructure handles.

Domain-oriented commands in this document are the contract. Removed broad compatibility RPCs must not be reintroduced as a second business implementation.

Core owns implementation and authorization. Web owns presentation adapters. Contract changes are reviewed as application-interface changes and should prefer additive evolution while both deployments may be temporarily version-skewed during rollout.

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
  | "SUBSCRIPTION_REQUIRED"
  | "ADDRESS_NOT_SERVICEABLE"
  | "FULFILLMENT_MODE_UNAVAILABLE"
  | "CYCLE_CLOSED"
  | "CYCLE_FULL"
  | "INVENTORY_HOLD_EXPIRED"
  | "PRICE_CHANGED"
  | "ITEM_UNAVAILABLE"
  | "MINIMUM_ORDER_NOT_MET"
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
`REFUND_REQUEST` when implemented, plus `renewalInitiationEnabled`. Missing critical capability is
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
- `catalog.getProduct({ slug, addressId? }) -> MarketplaceProductView`
- `catalog.listCategories({ parentId? }) -> CategoryNavigationView`
- `checkout.listFulfillmentOptions({ addressId, addressVersion, cartId, cartVersion }) -> FulfillmentOptionView[]`

`MarketplaceProductView` includes customer display data and persisted fixed variants with `skuId`, display/packaging label (`500 g`, `1 pack`), optional `Pack`/`Bunch` merchandising label, integer sell quantity, controlled sell-unit code/display (`G`/`KG`/`PC`), exact integer base-unit consumption, core-resolved media (`src` + `alt`) with ordered customer-facing product details, an approximate assembled-pack contents note, the current SKU/market/location quoteable price, availability messaging, and fulfillment context. Staff packing instructions never appear in any public DTO. It does not expose inventory ledger quantities unless a deliberate customer-facing availability field is defined. Sellable sizes are returned from database configuration, not a hard-coded union.

`catalog.search` applies query/category/activity/availability/price predicates database-side before keyset pagination over `(category sort order, product name, product id)`; results are bounded (`limit` 1–50) and `nextCursor` is an opaque token whose malformed values return `VALIDATION_FAILED`. The complete launch catalog (226 produce products at seed time) is reachable through cursors without truncation. `marketplace.getHome` returns active categories plus bounded category rails (default 8 items per rail, capped at 12) built from one windowed scan and the same eligibility rules as search, never materializing the full catalog into one response.

`CategoryNavigationView` returns each active category's `code`, `name`, `slug`, and Core-resolved `iconSrc`. `iconSrc` is either a safe `/category-icons/<asset-key>.svg` Web path derived from database configuration or `null`; Web renders its local fallback for null and never reconstructs category taxonomy from hard-coded navigation metadata.

`FulfillmentOptionView` exposes an opaque option ID, `fulfillmentMode: "INSTANT" | "SCHEDULED"`, customer-facing promise/window/ETA, fee context, and for Scheduled only its configured cadence and selectable cycle/window identity. `WEEKLY` may appear as Scheduled cadence but never as `fulfillmentMode`. It exposes no customer-selectable fulfillment location.

## Serviceability

- `geography.searchAddressCandidates({ requestId, query, proximity? }) -> AddressSearchCandidate[]`
- `serviceability.resolveCoordinates({ latitude, longitude, addressComponents? }) -> ServiceabilityResult`

`AddressSearchCandidate` is provider-neutral and contains an opaque session candidate key,
display address, coordinate, structured address components, and nullable accuracy. Search
results exist only for the active interaction and may not be persisted, cached across sessions,
or logged. Candidate selection is not serviceability proof. Core finalizes provider-derived
coordinates under the provider's permanent-storage rules before any saved-address write.

`ServiceabilityResult` includes `serviceable`, stable failure reason, market/area/zone display context, active polygon versions, resolution-change detection, and a mode-aware fulfillment-eligibility summary. Internal polygon GeoJSON, location codes, active-mode configuration IDs, and ranking rules are never exposed. Customers do not select a location; Core resolves eligible operations context internally and always re-resolves at checkout.

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

## Subscription

- `subscriptions.getMine() -> SubscriptionSummary`
- `subscriptions.getOffer() -> MembershipOfferView`
- `subscriptions.startTrial({ idempotencyKey }) -> SubscriptionSummary`
- `subscriptions.beginPaidEnrollment({ offerId, idempotencyKey }) -> SubscriptionSummary`
- `subscriptions.pause({ reason?, idempotencyKey, expectedVersion }) -> SubscriptionSummary`
- `subscriptions.resume({ idempotencyKey, expectedVersion }) -> SubscriptionSummary`
- `subscriptions.cancel({ timing: "IMMEDIATE" | "PERIOD_END", reason?, idempotencyKey, expectedVersion }) -> SubscriptionSummary`

- `checkout.getSubscriptionEligibility() -> { eligible, state, reasonCode?, effectiveUntil? }`

`MembershipOfferView` describes the single paid PHP 299.00/calendar-month offer and contains no trial-entitlement field. `SubscriptionSummary` uses only `PENDING`, `TRIALING`, `ACTIVE`, `PAST_DUE`, `PAUSED`, `CANCELED`, and `EXPIRED`, and exposes `cancelAtPeriodEnd`, `scheduledCancellationAt`, exact UTC `trialStartsAt`/`trialEndsAt`, and aggregate `version`.

`startTrial` resolves the current paid offer and introductory promotion server-side, then succeeds only after Promotions authorizes and atomically consumes the one-calendar-month grant/redemption. Calendar arithmetic follows `DOMAIN_MODEL.md`; an offer field such as `trial_days` is never accepted as authority. `beginPaidEnrollment` may create `PENDING` but cannot create `ACTIVE`; payment-method collection and provider interaction use Payments contracts. These contracts never imply grocery merchandise or delivery is free during a membership trial.

## Recurring Authorization (Payments-owned)

- `payments.beginRecurringAuthorization({ providerCode?, returnUrl, idempotencyKey }) -> { authorizationId, actionType: "REDIRECT" | "SDK" | "NONE", redirectUrl?, clientToken?, expiresAt? }` where Core selects only its explicitly configured provider and an optional `providerCode` is an equality assertion, never a registry-order fallback.
- `payments.completeRecurringAuthorization({ authorizationId }) -> { authorizationId }`

Establishing a mandate is instrument collection, never payment success; only a provider-confirmed recurring-capable authorization with a stable method identity becomes `ACTIVE`, and entering `TRIALING` requires one. Providers without recurring capability fail closed. These DTOs are provider-neutral seams; no production mandate or automatic renewal charging is currently approved.

## Membership Payments

- `payments.createMembershipPayment({ subscriptionId, paymentMethod, returnUrl, idempotencyKey }) -> PaymentActionView`
- `payments.getMembershipPayment({ subscriptionId }) -> PaymentSummary`
- `payments.recoverMembershipActivation({ subscriptionId, idempotencyKey }) -> SubscriptionActivationResult`

These are Payments-owned operations. A provider-confirmed canonical outcome causes an internal idempotent `ActivateSubscriptionFromPayment`/`RecoverSubscriptionFromPayment` Membership command; the browser cannot request or assert an `ACTIVE` transition directly.

## Cart

- `cart.get() -> CartView`
- `cart.setItem({ cartId, skuId, quantity, expectedVersion, idempotencyKey }) -> CartView`

Cart `quantity` is an integer count of the configured SKU, never kilograms/liters or a floating requested weight; zero removes the line. Every mutation is idempotent and compare-and-swaps the customer-owned active cart version. Identical replay returns the already-applied cart, key reuse with another payload returns `IDEMPOTENCY_CONFLICT`, and stale aggregate state returns `CART_VERSION_CONFLICT`. `CartView` reports each line as `AVAILABLE`, `UNAVAILABLE`, or `PRICE_UNAVAILABLE`; unavailable prices are nullable and are never projected as zero. `checkoutBlocked` plus stable blocking reasons prevents checkout while retaining removable stale lines. Cart activity alone promises no inventory hold/reservation or capacity.

## Checkout Eligibility and Quote

- `checkout.evaluate({ cartId, addressId, cycleId }) -> CheckoutEligibilityView` is a deprecated Scheduled-only compatibility read; current Web uses `listFulfillmentOptions` followed by authoritative `createQuote` and does not call it.
- `checkout.createQuote({ cartId, cartVersion, addressId, fulfillmentOptionId, promotionCodes?, idempotencyKey }) -> CheckoutQuoteView`; the opaque option binds address/cart versions, mode, internal routing, and any Scheduled cycle. Web never submits a location or cycle as fulfillment authority.
- `checkout.refreshQuote({ checkoutAttemptId }) -> CheckoutQuoteView`

The view reports each eligibility dimension, explicit financial components, price/availability changes, resolved serviceability, selected `INSTANT`/`SCHEDULED` option, delivery promise, Instant hold status or Scheduled cycle/capacity status, applied/rejected Promotions by price component, and available alternatives. Sensitive location-selection rules remain internal.

`CheckoutQuoteView` contains `merchandiseSubtotalMinor`, `itemDiscountMinor`, `orderDiscountMinor`, `deliverySubtotalMinor`, `deliveryDiscountMinor`, `serviceFeeMinor`, `taxMinor`, `totalMinor`, and currency. `subtotalMinor`, `discountMinor`, and `deliveryFeeMinor` remain compatibility projections. Item lines snapshot SKU quantity/unit/base consumption and allocated discount. The internal quote snapshot also records provider-neutral route meters, delivery minimum/rate, calculated fee, configuration version, and road-route/driving calculation metadata. Percentage/fixed Order benefits use only the approved merchandise basis; Delivery benefits use only delivery fee.

The authoritative service validates authenticated Customer, subscription, cart, SKU/market/location prices, minimum basket, address coordinates, service area, zone, resolved location and active mode, mode-specific inventory hold or cycle/cutoff/capacity, Promotions eligibility/limits/stacking, provider-neutral route distance, effective delivery-fee configuration, and payment readiness. External route/configuration failure fails closed. For each Order quote it selects at most one merchandise benefit and one delivery benefit; a valid explicit selection wins its component, otherwise highest computed value then stable Promotion ID determines the winner.

Fulfillment-option reads require a Maps-confirmed, active, Core-serviceable Customer address and an owned nonempty active cart at the submitted versions. Both `INSTANT` and `SCHEDULED` are returned as stable customer-facing choices even when unavailable, with a controlled reason and provisional promise/fee context. The option ID is opaque and re-resolved by Core at Quote creation; address/cart/routing/cycle changes fail closed. An identical Quote idempotency replay returns the original immutable Quote even when current routing later changes, while the same key with another option is `IDEMPOTENCY_CONFLICT`.

## Checkout, Payment, and Order Commitment

- `checkout.createAttempt({ cartId, addressId, fulfillmentOptionId, promotionCodes?, idempotencyKey }) -> CheckoutAttemptView`
- `checkout.createPayment({ checkoutAttemptId, expectedQuoteVersion, expectedPriceAcceptanceVersion, expectedCurrency, expectedMerchandiseSubtotalMinor, expectedItemDiscountMinor, expectedOrderDiscountMinor, expectedDeliverySubtotalMinor, expectedDeliveryFeeMinor, expectedDeliveryDiscountMinor, expectedServiceFeeMinor, expectedTaxMinor, expectedTotalMinor, paymentMethod, returnUrl, idempotencyKey }) -> PaymentActionView`
- `checkout.getAttempt({ checkoutAttemptId }) -> CheckoutAttemptView`
- `checkout.recoverCommitment({ checkoutAttemptId }) -> OrderCommitmentResult`

Core receives payment provider webhooks through a signed public webhook handler rather than Web RPC:

- verify signature and timestamp;
- preserve one validated UUID request ID through verification, ingestion logs, and the HTTP response;
- insert `(provider, providerEventId)` into the durable Payments inbox exactly once;
- persist only the bounded provider-neutral observation plus payload hash, never the raw webhook body;
- conditionally lease due `RECEIVED`/`RETRY_REQUIRED` rows so redelivery and scheduled redrive share one application path;
- translate the vendor state into canonical Payments state under the configured payment commitment policy;
- update Payments using handler-side legal-transition and compare-and-swap protection, safely retrying/reconciling concurrent aggregate changes;
- invoke an explicit idempotent Membership or Order application command when the canonical outcome is sufficient;
- commit/recover the Membership activation or Order exactly once;
- enqueue non-critical follow-up.

Provider webhook payloads never contain an application `expectedVersion`. Vendor captured/success states map to canonical Payments `SUCCEEDED` for MVP; browser return state and payment initiation do not. The payment provider remains an adapter and its vocabulary is not exposed in Membership or Order DTOs.

Retry availability uses bounded backoff. Expired leases are reclaimable; competing Workers cannot both own an observation. Retry age/attempt exhaustion transitions the inbox row to `RECONCILIATION_REQUIRED` and creates one operationally visible case, so recovery does not depend on the provider sending the event again.

The registered scheduler reclaims provider-inbox work every fifteen minutes and expires due provider redirect/SDK actions every minute. Renewal initiation remains disabled unless the closed runtime configuration explicitly assigns application ownership and a configured provider exists; confirmed payment outcomes, dunning, and grace expiry continue independently of that initiation gate.

Immediately before a new payment creation, Core recalculates current catalog prices, discounts, stock/hold, serviceability, route-based delivery fee, membership entitlement, and fulfillment eligibility without persisting or superseding another Quote. The accepted quote aggregate version, price-acceptance version, currency, `expectedTotalMinor`, and every explicit component must equal the accepted Quote; otherwise Core returns `PRICE_CHANGED` without creating a payment and the browser must request/present a replacement quote for explicit acceptance. Identical payment replay retains the original accepted version and `checkout_quote/<accepted quote id>` as its subject even after the one guarded commitment transition consumes that Quote; a replay with changed accepted components is an idempotency conflict.

Stable financial-safety failures include `TRIAL_ENDED`, `SUBSCRIPTION_GRACE_ENDED`, `MINIMUM_ORDER_NOT_MET`, `CAPACITY_UNAVAILABLE`, `PAYMENT_OUTCOME_UNRESOLVED`, `AUTHORIZATION_OUTCOME_UNRESOLVED`, `PAYMENT_ACTION_EXPIRED`, `AUTHORIZATION_ACTION_EXPIRED`, and `REFUND_AMOUNT_UNAVAILABLE`. Ambiguous provider outcomes preserve their application identity and reconciliation state; clients must not retry under a new identity merely because a response was lost.

`OrderCommitmentResult` is either the existing/new committed order summary or a stable actionable exception. Duplicate requests return the same logical result. If mode-specific inventory/capacity is unavailable before charge, return valid fulfillment alternatives without exposing or asking the customer to select a location. If canonical payment commitment succeeds but the downstream Membership/Order command cannot complete, preserve the payment observation and retry the same idempotent commitment. Bounded failure creates a visible finance/reconciliation exception. A second payment/order and automatic refund are forbidden unless a separately approved recovery command explicitly authorizes them.

`checkout.abandonCheckoutAttempt({ quoteId, expectedVersion, idempotencyKey })` is the sole customer pre-commit abandonment command. It ownership- and version-guards an active Quote, releases its held Instant inventory or Scheduled provisional capacity once, and makes the Quote/attempt terminal without creating an Order, Payment outcome, Refund, or Promotion redemption. Exact replay returns the original result and changed replay fails. Quotes with a Payment that can still succeed fail closed; consumed Quotes are committed-order territory and cannot be canceled through Checkout. Address, cart, promotion, or fulfillment edits discard an accepted Quote through this command, with an explicit restart action as a retryable path; browser unload delivery is not relied upon.

Notifications publish the closed launch vocabulary `ORDER_CONFIRMED`, `PAYMENT_ACTION_REQUIRED`, `PAYMENT_FAILED`, `SCHEDULED_CUTOFF_REMINDER`, `OUT_FOR_DELIVERY`, `DELIVERED`, `DELIVERY_FAILED`, `RENEWAL_PAYMENT_FAILED`, `RENEWAL_ACTION_REQUIRED`, `TRIAL_ENDING`, and `FIRST_PAID_RENEWAL_UPCOMING`. Versioned templates consume bounded provider-neutral facts only. Stable event/type/recipient identity deduplicates D1 outbox intents; scheduler leases, attempt history, capped exponential retry, crash recovery, and terminal failure are operational delivery concerns and never become evidence that the source domain transition succeeded or failed. An unavailable email adapter retains/retries or terminally escalates the intent and never reports delivery.

For `INSTANT`, attempt creation/refresh atomically creates or replaces an expiring exact-base-unit inventory hold; the transaction-local availability guard prevents concurrent carts from holding the same final units, and commitment converts the winning hold into a committed reservation. For `SCHEDULED`, commitment uses the selected cycle/window, cutoff, capacity, and configured reservation/demand policy. The committed result snapshots fulfillment mode, resolved location/zone/service area, distinct cutoff and delivery instants, promise/window/ETA, optional Scheduled cycle identifiers, SKU conversion, Promotions, all monetary components, and the accepted provider-neutral route/delivery-fee calculation.

## Customer Orders and Amendments

- `orders.listMine(page) -> CustomerOrderPage`
- `orders.getMine({ orderId }) -> CustomerOrderDetail`
- `orders.reorder({ orderId, expectedCartVersion, idempotencyKey }) -> ReorderResultView`
- `orders.listIssues({ orderId }) -> CustomerOrderIssueView[]`
- `orders.submitIssue({ orderId, category, description, affectedOrderItemIds, idempotencyKey }) -> CustomerOrderIssueView`
- `orders.getAmendmentEligibility({ orderId }) -> AmendmentEligibilityView`
- `orders.createAmendmentDraft({ orderId, items, idempotencyKey }) -> AmendmentDraftView`
- `orders.payAmendment({ amendmentId, paymentMethod, returnUrl, idempotencyKey }) -> PaymentActionView`

`CustomerOrderDetail` is ownership-scoped and purpose-built from immutable Order snapshots. It contains the public order number and committed instant, exact line/SKU/unit/base-consumption snapshots, an explicit financial source (`CHECKOUT_QUOTE` or `ORDER_TOTAL_ONLY` with unavailable components represented as null), provider-neutral payment/refund summaries, fulfillment mode and promise without location or rider data, additive amendment summaries, customer-safe issue summaries, invoice availability, a deterministic chronological controlled timeline, and Core-derived action availability. It excludes provider identifiers/events/payloads, reconciliation or Audit JSON, staff identity/internal notes, inventory/procurement data, and rider coordinates. A non-owned order returns `NOT_FOUND`; committed customer cancellation is returned unavailable with a controlled reason rather than exposing the internal Admin cancellation command.

`ReorderResultView` reports complete, partial, or no-items-added outcome, current-price additions, controlled skip reasons, and the new ordinary Cart version. Orders reads only historical SKU/quantity/display snapshots and delegates one idempotent, expected-version batch to Checkout's Cart application service. Cart resolves current SKU/product activity, location availability, price, and existing quantity, then applies every eligible merge under one aggregate compare-and-swap. Historical prices, Promotions, address, fulfillment mode, cycle, capacity, and delivery promise never return as current authority; address and fulfillment review are always required.

Customer issue submission accepts one controlled category, a trimmed nonblank description of at most 1,000 characters, and at most 50 affected line identifiers that Core verifies belong to the owned order. Item-specific categories require an affected line and `OTHER` requires meaningful notes. The idempotency key is bound to the complete normalized request; exact replay returns the same issue and changed replay fails with `IDEMPOTENCY_CONFLICT`. Submission creates no refund, payment, order-state, or Admin action. Customer projections collapse internal claimed/investigating work to `IN_REVIEW`, expose only controlled terminal-resolution copy, and never expose staff assignment, internal resolution notes, refund authority, or Admin workflow. Non-owned orders return `NOT_FOUND`.

Customer order DTOs compose original and amendment timelines while preserving separate financial records.

An additive amendment is available only for an owned paid Scheduled order before cutoff under the current location, cycle, availability, capacity, and price context. Creation is expected-order-version guarded, additive-only, permits one active draft/payment attempt, snapshots its own lines and complete financial components, and never rewrites original lines, totals, or payment history. Its payment purpose and subject are `ORDER_AMENDMENT` and the amendment ID; the customer must explicitly accept its exact currency, total, and version. Initiation/browser return never commits. Provider-confirmed canonical success applies the separately auditable inventory or planned-demand delta once; terminal payment failure marks only the amendment failed, while a post-payment mutation race creates a bounded finance exception for reconciliation.

Paid Order commitment also creates one internal invoice-readiness record from the same provider-confirmed transaction. The record copies exact accepted financial components and bounded buyer facts; it does not calculate tax. Missing approved seller/tax configuration yields `PENDING_TAX_CONFIGURATION`, which the customer projection presents as not ready without an identifier. Only separately supplied complete policy facts may reach `READY_FOR_ISSUANCE`; `ISSUED` additionally requires the controlled official identifier and issuance instant.

Customer grocery-order cancellation is not exposed in the mock-payment MVP. Any future customer command requires a separately approved payment/refund policy. Internal scoped operations commands are not customer authority.

## Admin Foundation, Audit, and Application IAM

- `admin.context.get() -> AdminContextView`
- `admin.scopes.list() -> AdminScopeOptionView[]`
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

Admin context derives the active Staff principal, canonical capability vocabulary, and global/market/location scopes from the Better Auth session plus Application IAM. It returns only permitted navigation and scope-selector options. Web never manufactures a capability or infers authorization from navigation visibility.

Audit queries require `audit.read`, enforce resource scope, use bounded keyset pagination, and return sanitized purpose-built DTOs rather than raw JSON rows. Credential, bearer-token, cookie, authorization, provider-payload, and secret values are redacted recursively. Staff invitations never accept a password; Better Auth retains credentials, verification, and session authority. Roles with active assignments cannot be silently deleted, and session revocation is an explicit audited operation.

### Implemented Admin Foundation service (Slice 1, 2026-08-27)

`packages/contracts/src/admin-foundation.ts` publishes the closed canonical dot-form capability vocabulary (`adminCapabilityCodes`), the derived `Capability` type, `isAdminCapability`, and the `AdminFoundationService` surface implemented by Core:

- `getAdminContext` returns `AdminContextView`: staff principal identity, canonical capabilities, assigned global/market/location scopes, Core-provided navigation, and environment. Navigation uses the closed workspace codes `overview`, `orders`, `catalog`, `inventory`, `procurement`, `fulfillment`, `delivery`, `customers`, `memberships`, `payments`, `promotions`, `analytics`, `staff`, `audit`, and `settings`; a workspace appears only when its read or manage capability is held, and `overview` is always present for active Staff. Web renders these items verbatim and never infers permissions from their visibility.
- Phase 12 extends each permitted navigation entry with a closed section code and optional parent code, and adds stable subview codes for the approved Product, Category, Order, Customer Privacy, Procurement/Receiving, Payment, Staff/Role, and Settings destinations. Core emits every visible parent and child; Web may group and collapse those entries but never manufactures an unauthorized route.
- `listAdminScopes` returns `AdminScopeOptionView` entries (market or location, with ids, codes, names, currency, and timezone) only for active markets/locations reachable by the caller's global, market, or location assignment. Geometry and location-ranking rules are never exposed.
- `listAdminAuditEvents` and `getAdminAuditEvent` require `audit.read`, enforce resource scope in Core, bound `limit` to 1–100 (default 50), and page by a descending `(occurred_at, id)` opaque base64url cursor; malformed cursors return `VALIDATION_FAILED`. Audit detail parses `details_json`/`before_json`/`after_json` into structured objects and recursively redacts case-insensitive keys `password`, `token`, `secret`, `cookie`, `authorization`, `accessToken`, `refreshToken`, `idToken`, and `providerPayload` to `"[REDACTED]"`; invalid historical JSON becomes an empty object with a safe warning. Raw JSON strings and raw rows are never exposed.

Migration `0026_admin_foundation.sql` seeds the canonical capability rows with stable `perm_<domain>_<action>_v1` ids and maps historical colon-form assignments additively. Historical colon-form permission rows and assignments remain compatibility data; new source and DTOs use canonical dot-form capabilities only.

### Implemented Staff & Access service (Slice 2, 2026-08-27)

`packages/contracts/src/admin-staff-access.ts` publishes `AdminStaffAccessService` — `listAdminStaff`, `getAdminStaff`, `listAdminStaffInvitations`, `inviteAdminStaff`, `revokeAdminStaffInvitation`, `updateAdminStaff`, `changeAdminStaffAccess`, `setAdminStaffRoles`, `setAdminStaffScopes`, `revokeAdminStaffSessions`, `listAdminRoles`, `getAdminRole`, `createAdminRole`, `updateAdminRole`, `setAdminRoleCapabilities`, `archiveAdminRole`, and `listCapabilityDefinitions`.

- Authorization: every Staff & Access query/command requires `staff.read` (reads) or `staff.manage` (commands) **plus a global scope** in Core. Staff administration is a central concern; market/location-scoped principals receive `FORBIDDEN`.
- Staff reads compose application IAM identities with roles, canonical capabilities, scopes, and a single Better-Auth display `email`; no Better Auth row is returned as a Staff DTO.
- Commands take caller-stable `idempotencyKey`s and `expectedVersion` where concurrent mutation is possible, require a reason for access changes/revocation/archive, and append `audit_event` rows (closed action vocabulary `STAFF.*`/`ROLE.*`) with before/after snapshots and `correlation_id = requestId`. Identical replay returns the authoritative result; hash conflicts return `IDEMPOTENCY_CONFLICT`.
- `setAdminStaffRoles`/`setAdminStaffScopes` replace atomically; every statement in their D1 batch carries the caller's version predicate so a concurrent change makes the whole batch read back as `STALE_VERSION`. Archived roles fail closed on assignment.
- `revokeAdminStaffSessions` deletes the authentication authority's own session rows for the linked user (the minimal Better Auth build exposes no administrative revoke API), leaving no application-side session state.
- Invitation lifecycle for MVP: `inviteAdminStaff` creates one durable `PENDING` record per normalized email with 14-day expiry; acceptance/provisioning of a new identity is an explicitly deferred later flow.

### Implemented Customer CRM service (Slice 3, 2026-08-27)

`packages/contracts/src/admin-customers.ts` publishes `AdminCustomerService` (`listAdminCustomers`, `getAdminCustomer`, `listCustomerInvitations`, `inviteCustomer`, `changeCustomerAccess`, `revokeCustomerSessions`, `requestCustomerClosure`) and `AdminPrivacyService` (`listPrivacyRequests`, `applyPrivacyAction`).

- Authorization: `customers.read` (reads) or `customers.manage` (commands) **plus a global scope** in Core; customer identity is global for MVP and scoped principals receive `FORBIDDEN`.
- `AdminCustomerSummary` composes the display `email`, `phone`, commerce-access status from the `customer_principal` gate, current `subscriptionState`, committed `orderCount`/`lastOrderAt`, aggregate `version`, and `createdAt`. Lifetime spend/AOV are excluded until their canonical metric definitions are approved. `AdminCustomerDetail` adds the ten most recent sanitized Audit summaries for the account.
- `changeCustomerAccess` disables/restores commerce access through the `customer_principal` gate with the customer aggregate's version guard; `revokeCustomerSessions` deletes the authentication authority's session rows (same mechanism as the Staff service).
- `requestCustomerClosure` opens an auditable privacy request; `applyPrivacyAction` enforces the closed lifecycle `SUBMITTED -> VERIFYING|APPROVED|REJECTED`, `VERIFYING -> APPROVED|REJECTED|ESCALATED`, `APPROVED -> PROCESSING`, `PROCESSING -> COMPLETED|ESCALATED`, `ESCALATED -> PROCESSING` and returns `ILLEGAL_TRANSITION` otherwise. Completion records resolution only — no order, payment, refund, redemption, ledger, or audit history is ever deleted, and retention-backed anonymization remains gated on approved policy.
- `admin.customers.update` is explicitly deferred: no application-owned mutable customer profile field is approved in `DATA_MODEL.md` (support notes and segments remain unapproved good-to-haves).
- Customer invitations mirror the staff invitation lifecycle (one `PENDING` record per normalized email, 14-day expiry, no password input); acceptance/provisioning is deferred with the staff deferral.
- Material commands are idempotent, version-guarded where concurrent mutation is possible, reason-gated, and audited (`CUSTOMER.*`/`PRIVACY.*` closed vocabulary).

### Implemented Promotions service (Slice 4, 2026-08-27)

`packages/contracts/src/admin-promotions.ts` publishes `AdminPromotionsService` (`listAdminPromotions`, `getAdminPromotion`, `createAdminPromotion`, `updateAdminPromotion`, `changeAdminPromotionStatus`, `previewAdminPromotion`, `grantAdminPromotion`, `listPromotionGrants`, `listPromotionRedemptions`).

- Authorization: `promotions.read` (reads/preview) or `promotions.manage` (commands) **plus a global scope** in Core.
- Manageable benefits in this slice are exactly `ORDER_FIXED_DISCOUNT` and `ORDER_PERCENT_DISCOUNT` over the rebuilt `promotion` definition table (`DRAFT -> ACTIVE -> INACTIVE`, `DRAFT|INACTIVE -> ARCHIVED` terminal, `ILLEGAL_TRANSITION` otherwise; only `DRAFT` definitions change). `MEMBERSHIP_FEE_WAIVER` stays exclusively owned by the introductory-trial authority; delivery benefits are schema-ready but deferred until Quote consumes them. No delete path exists.
- Preview is read-only and deterministic (status/window/minimum-subtotal policy, fixed or `ceil(subtotal x percent / 100)` computation capped at the subtotal) and never claims usage or writes a redemption.
- Grants create targeted `promotion_grant` rows (`benefit_code` = promotion code, `customer_id` persisted, `max_redemptions >= 1`) for ACTIVE promotions only. `INTRO_TRIAL` and `LEGACY_TRIAL_HISTORY` are reserved system membership codes and are excluded from this surface. Exactly one grant may exist for a promotion/customer: an identical idempotent retry replays the original grant, while a distinct command conflicts without creating a duplicate. Redemptions are read-only inspections joined by promotion code.
- Material commands are idempotent, version-guarded, reason-gated, and audited (`PROMOTION.CREATED/UPDATED/ACTIVATED/DEACTIVATED/ARCHIVED/GRANTED`).

### Implemented Catalog and Inventory services (Slice 5, 2026-08-27)

`packages/contracts/src/admin-catalog.ts` publishes `AdminCatalogService` (`listAdminCategories`, `createAdminCategory`, `getAdminCategory`, `updateAdminCategory`, `setAdminCategoryStatus`, `listAdminUnits`, `createAdminUnit`, `listAdminProducts`, `createAdminProduct`, `getAdminProduct`, `updateAdminProduct`, `setAdminProductStatus`, `uploadAdminProductMedia`, `updateAdminProductMedia`, `removeAdminProductMedia`, `createAdminSku`, `updateAdminSku`, `setAdminSkuAvailability`, `setAdminSkuPrice`) and `AdminInventoryReadService` (`listAdminInventory`, `getAdminInventoryLedger`).

- Authorization: catalog surfaces require `catalog.read`/`catalog.manage` plus a global scope; inventory reads require `inventory.read` plus operational scope over the requested location (global, its market, or that exact location). The guarded `inventory.adjust` command keeps its existing capability + scope + idempotency + version guards.
- No schema change was required: the surface composes the existing catalog/price/availability/inventory tables. Prices are inserted as new `price_version` rows (version increments, market-scoped `STANDARD`, location NULL); history is never rewritten and zero amounts fail closed.
- SKU creation validates that the sellable unit's dimension matches the product pool's base-unit dimension; SKU updates and availability upserts are version-guarded (`sku_location_availability` inserts use `expectedVersion 0`). Product status toggles are reason-gated, audited, and guarded on current status.
- Phase 12 Category and Product authoring adds guarded hierarchy, identity, ordered customer details, inventory-pool base-unit context, lifecycle, recent Audit, and Core-derived actions without exposing raw rows. Product and Category lifecycle has no generic delete command. Bulk import remains deferred; purchase/receiving surfaces belong to Procurement/Receiving.
- Category and Product lists apply query/status predicates in Core before bounded keyset pagination; cursors are opaque and scoped to the active filter set. Product detail accepts an explicit Admin-authorized market/location pricing target and returns that resolved `pricingContext`; location price and availability override market defaults without Web inventing a target or currency.
- `uploadAdminProductMedia({ productId, bytes, mimeType, altText, isPrimary, sortOrder, expectedProductVersion, idempotencyKey })`, `updateAdminProductMedia({ productId, mediaId, altText, isPrimary, sortOrder, expectedProductVersion, idempotencyKey })`, and `removeAdminProductMedia({ productId, mediaId, expectedProductVersion, idempotencyKey })` return `AdminProductMediaView`. Upload accepts only signature-matching JPEG, PNG, or WebP bytes up to 5 MiB. Core generates `products/{productId}/{mediaId}` keys, stores bytes through its `PRODUCT_MEDIA` binding, maintains at most one active primary, orders active reads by primary/sort/id, increments the Product version, and commits D1 mutation, Audit, and idempotency together. Failed D1 attachment deletes the just-uploaded object; removal deactivates D1 before R2 deletion. Web parses multipart but cannot submit an object key or access R2 directly.

## Admin Orders and Payments

- `admin.orders.list(filters, page) -> AdminOrderListPage`
- `admin.orders.get({ orderId }) -> AdminOrderDetail`
- `admin.orders.cancel({ orderId, reason, resolution, expectedVersion, idempotencyKey }) -> AdminOrderDetail`
- `admin.orders.recordExceptionResolution(...)`
- `admin.payments.getOverview() -> AdminPaymentOverview`
- `admin.payments.list(filters, page) -> AdminPaymentPage`
- `admin.payments.get({ paymentIntentId }) -> AdminPaymentDetail`
- `admin.payments.refund({ paymentIntentId, amountMinor, reason, idempotencyKey }) -> AdminRefundView`
- `admin.payments.listReconciliationCases(filters, page) -> AdminReconciliationPage`
- `admin.payments.resolveReconciliationCase({ caseId, reason, idempotencyKey }) -> AdminReconciliationCaseView`

Admin order detail composes immutable checkout financial and item snapshots with Payments, amendments, fulfillment, delivery, exception, merged timeline, allowed-action, and Audit projections; it is not a raw join response. Historical orders without an authoritative checkout quote explicitly return an `ORDER_TOTAL_ONLY` financial source with unavailable component amounts rather than fabricating a breakdown. Payment detail composes canonical attempts, refunds, provider-safe event metadata, downstream reactions, reconciliation cases, allowed actions, and Audit. Provider references, provider event identifiers, payload hashes/payloads, idempotency records, and reconciliation detail JSON do not leave Core. `CANCEL` and `REQUEST_REFUND` are returned only when both lifecycle policy and the caller's capability authorize the command.

Refund availability subtracts every non-failed refund reservation (`PENDING`, `APPROVED`, or `SUCCEEDED`) before accepting another request. The guarded refund mutation, Audit event, and idempotency completion share one atomic D1 batch, so concurrent requests cannot over-refund or record a false success. Reconciliation resolution is an explicit confirmed Admin command; downstream payment-reaction redrive remains Core-owned scheduled work rather than a second Admin retry authority.

Operational command/read contracts publish the canonical Fulfillment (`NOT_STARTED` through `COMPLETED`, with `SHORTED` resolution) and Delivery Job (`UNASSIGNED` through `DELIVERED`, with explicit failure/retry/escalation) states and command actions. Core derives `allowedActions`; the former `START|PACK|SHORTAGE` and `DISPATCH|DELIVER|FAIL` shortcuts are not accepted. Procurement aggregation computes committed demand and usable inventory inside its version-guarded command and permits only one active requirement per cycle/location/pool. Order issues have no `REOPEN` action: `RESOLVED` is terminal and further work requires a new linked issue.

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
- `admin.catalog.setPrice({ skuId, marketId, locationId?, amountMinor, currency, validFrom, expectedVersion?, idempotencyKey }) -> SkuPriceView`
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
- `admin.promotions.listRedemptions({ promotionId, cursor? }) -> PromotionRedemptionPage`
- `admin.promotions.grant({ promotionId, customerId, idempotencyKey }) -> PromotionGrantView`
- `admin.fulfillment.getModeConfiguration({ locationId }) -> FulfillmentModeConfigurationView`
- `admin.fulfillment.activateMode({ locationId, fulfillmentMode, cadence?, configuration, expectedVersion, idempotencyKey }) -> FulfillmentModeConfigurationView`

`AdminCustomerSummary` contains only authorized Customer/profile display data plus location, Order count, last Order, lifetime-spend/AOV fields only when their canonical metric definitions are approved, Membership/trial state, and creation date. Detail composes scoped addresses, Orders, Membership, Promotion/redemption, Payments summary, delivery, support-visible, and audit read models. Better Auth rows are not the Customer contract. Customer "delete" is represented by the privacy/account-closure lifecycle: access may be disabled and eligible application fields may later be anonymized, but required Order, Payment, Refund, redemption, inventory-ledger, and Audit history is never hard-deleted by a generic Customer command.

Unit and SKU commands accept integer quantities only and validate dimension compatibility. `PACK`, `BUNCH`, and `TRAY` are labels, not universal conversion codes. Promotion definitions accept only the closed benefit/rule types and validated parameters from `DOMAIN_MODEL.md`; no code/expression payload exists. All Admin operations require the capability and resource scope named by Application IAM.

## Admin Memberships and Customer Issues

- `admin.memberships.list(filters, page) -> AdminMembershipPage`
- `admin.memberships.get({ subscriptionId }) -> AdminMembershipDetail`
- `admin.memberships.pause({ subscriptionId, reason, expectedVersion, idempotencyKey }) -> AdminMembershipDetail`
- `admin.memberships.resume({ subscriptionId, reason?, expectedVersion, idempotencyKey }) -> AdminMembershipDetail`
- `admin.memberships.cancel({ subscriptionId, timing: "IMMEDIATE" | "PERIOD_END", reason, expectedVersion, idempotencyKey }) -> AdminMembershipDetail`
- `admin.memberships.recover({ subscriptionId, idempotencyKey }) -> AdminMembershipDetail`
- `admin.memberships.listExceptions(filters, page) -> MembershipExceptionPage`
- `admin.orderIssues.list(filters, page) -> OrderIssuePage`
- `admin.orderIssues.get({ issueId }) -> OrderIssueDetail`
- `admin.orderIssues.applyAction({ issueId, action, reason?, expectedVersion, idempotencyKey }) -> OrderIssueDetail`

Membership Admin commands invoke the canonical Membership state machine and never patch a state, fabricate a trial, or assert payment success. Recovery consumes provider-confirmed canonical Payments truth. Order-issue actions control intake/triage state only; they never implicitly authorize a Refund or Credit.

## Inventory

- `admin.inventory.list({ locationId, query?, availability?, cursor? }) -> InventoryAvailabilityPage`
- `admin.inventory.getLedger({ locationId, inventoryPoolId, cursor? }) -> InventoryLedgerPage`
- `admin.inventory.adjust({ locationId, inventoryPoolId, quantityBase, reason, expectedVersion, idempotencyKey }) -> InventoryAvailabilityView`

Adjustments require capability, location scope, exact base-unit quantity, reason, and audit. There is no generic `setStock` contract.

## Procurement and Receiving

- `admin.procurement.getRequirements({ cycleId, destinationLocationId }) -> ProcurementRequirementView`
- `admin.procurement.aggregateDemand({ cycleId, idempotencyKey }) -> ProcurementRunView`
- `admin.procurement.approveRequirement({ runId, expectedVersion, ... }) -> ProcurementRunView`
- `admin.procurement.placePurchaseOrder(...) -> PurchaseOrderView`
- `admin.receiving.start({ purchaseOrderId, idempotencyKey }) -> ReceivingSessionView`
- `admin.receiving.recordLine({ sessionId, skuId, acceptedBase, rejectedBase, reason?, expectedVersion, idempotencyKey }) -> ReceivingSessionView`
- `admin.receiving.complete({ sessionId, expectedVersion, idempotencyKey }) -> ReceivingSessionView`
- `admin.procurement.resolveException(...) -> ProcurementRunView`

## Fulfillment

- `admin.fulfillment.getWorkQueue({ fulfillmentMode?, cycleId?, locationId, state?, cursor? }) -> FulfillmentQueueView`
- `admin.fulfillment.startPicking({ taskId, expectedVersion, idempotencyKey })`
- `admin.fulfillment.recordPicked(...)`
- `admin.fulfillment.recordShortage(...)`
- `admin.fulfillment.markPacked(...)`
- `admin.fulfillment.handOff(...)`

Every command validates location scope and legal transition.

## Delivery Operations

- `admin.delivery.getOperationsSummary({ fulfillmentMode?, cycleId?, locationId? }) -> DeliveryOperationsSummary`
- `admin.delivery.listExceptions(filters, page) -> DeliveryExceptionQueue`
- `getDeliveryMap({ headers, requestId, locationId, fulfillmentMode, cycleId, statuses?, riderId?, cursor? }) -> DeliveryMapView`
- `getDeliveryMapDetail({ headers, requestId, locationId, fulfillmentMode, cycleId, jobId, expectedVersion }) -> DeliveryMapDetail`
- `getEligibleRiders({ headers, requestId, locationId, fulfillmentMode, cycleId, cursor? }) -> EligibleRiderPage`
- `previewDeliveryBatchRoute({ headers, requestId, locationId, fulfillmentMode, cycleId, orderedDeliveries }) -> BatchRoutePreview`
- `createAndAssignDeliveryBatch({ headers, requestId, locationId, fulfillmentMode, cycleId, riderId, orderedDeliveries, idempotencyKey }) -> DeliveryBatchView`
- `admin.delivery.reorderStops(...) -> DeliveryBatchView`
- `admin.delivery.rescheduleJob(...) -> DeliveryJobView`
- `admin.delivery.resolveFailure(...) -> DeliveryJobView`

`DeliveryMapPin` contains only job/order/batch identities, nullable coordinate,
fulfillment mode/cycle, status, purpose-built Rider display identity, aggregate
version, and Core-derived `{ selectable, reason }`. `DeliveryMapView` is a
bounded scoped pin collection. `DeliveryMapDetail` separately returns protected
display address, recipient/contact, structured instructions, version, and
Core-derived legal actions. Its `orderNumber` is nullable during the current
implementation sequence because the physical Orders table has not yet landed
the canonical persisted human-readable number; Core returns null and never
substitutes the Order UUID. `EligibleRiderView` contains canonical Rider
identity plus open batch/delivery counts. None exposes raw snapshot JSON,
polygon GeoJSON, provider data/tokens, Better Auth records, or ranking rules.

`DeliveryMapView` and `EligibleRiderPage` are bounded keyset pages ordered only
by immutable canonical `delivery_job.id` and `rider_identity.id` respectively;
mutable Rider display names never participate in continuation. Each page
exposes an opaque context-and-revision-bound `nextCursor`, explicit `complete`,
an opaque `projectionRevision`, and authoritative `totalCount`. Delivery pages
also expose `generatedAt` as the filtered projection's stable source watermark,
not the wall-clock time of an individual page call. Core hashes bounded ordered
evidence for every field that affects the filtered delivery projection or the
eligible Rider/workload projection before and after each page read. A cursor
whose revision no longer matches returns typed `STALE_VERSION`; this is
application revision evidence and does not claim a cross-request D1 snapshot.

Thin Admin Web adapters follow continuations only within explicit ceilings:
20 Core pages of at most 250 entries and 5,000 total delivery entries, or 10
Core pages of at most 200 entries and 2,000 total Riders. They reject an
oversized physical page array before traversing or validating its entries and
return a complete set only after revision, watermark,
count, strict DTO shape, uniqueness, monotonic immutable-ID progress, cursor,
and completion evidence all agree. Repeated or uniquely changing cursors with
no entity progress, empty non-terminal pages, duplicate/regressing IDs,
malformed entries, mixed revisions/watermarks, contradictory completion, and
any call/page/item overflow fail closed with no partial response. Eligible Rider
workload counts and their revision evidence are computed from set-based grouped
batch and delivery aggregates joined by canonical Rider ID. After a
complete immutable-ID traversal, Web may sort the Rider result by display name
and Rider ID for presentation. The operational tradeoff is deliberate: very
large or concurrently changing contexts require an Admin refresh instead of
silently presenting a partial or mixed-generation queue.

Every authorized open row remains in `DeliveryMapView`. When the immutable stop
has no authoritative coordinate, the pin and detail coordinate are null, Web
renders no map marker, selection is `{ selectable: false, reason:
"MISSING_COORDINATE" }`, and detail exposes no batch-assignment action. Core
never fabricates a coordinate, and assignment still requires a non-null
authoritative coordinate.

Map selectability also requires reciprocal canonical job/stop evidence: the
stop must exist and its status, batch, and sequence must match the job's
assignment evidence. A mismatch is projected as the non-selectable
`STOP_ASSIGNMENT_INCOHERENT` exception rather than advertised as assignable.

Every `orderedDeliveries` entry is `{ jobId, expectedVersion }`; its array is the
manual route order. Preview and assignment accept no origin or destination
coordinates. `BatchRoutePreview` is a provider-neutral, non-authoritative
GeoJSON LineString/meters/seconds/legs result with an explicit warning outcome;
it never optimizes and warning results do not block assignment.

Before any route-provider call, preview applies the same scoped open/selectable
and reciprocal job/stop policy as the dispatch map. Terminal jobs, active-batch
conflicts, missing or incoherent stops, unresolved context, missing coordinates,
and stale versions are authoritative rejections; provider warning semantics
apply only after this policy succeeds.

`createAndAssignDeliveryBatch` accepts one to 24 unique jobs, one canonical
Rider ID, and a caller-stable idempotency key. Core requires `delivery.manage`
plus location scope and atomically validates common location/mode/cycle, legal
job states, active Rider, coordinates, expected versions, and conflicting
assignment before creating/readying/assigning the batch, stops, jobs, events,
and audit. Identical replay returns the original result; a changed request hash
returns `IDEMPOTENCY_CONFLICT`; a stale job returns `STALE_VERSION`; every
failure leaves all selected jobs and batch records unchanged. Map/detail/rider
reads require `delivery.read` plus location scope. Cycle identity is required
for `SCHEDULED` and must be null for `INSTANT`.

Rider `preferred_location_id` is descriptive and never an assignment scope or
eligibility guard. Candidate reads and assignment require an active canonical
Rider and retain Rider version guards, while Admin capability plus market or
location scope authorizes the target operation.

The superseded two-step `createBatch`/`assignRider` target is not a second
dispatch authority. The currently implemented compatibility assignment by
authentication user ID and raw-snapshot rider reads remain only until their
callers migrate; the map workspace may not use them, and they must be removed
with the compatibility surface.

## Rider Operations

- `getRiderBatches({ headers, requestId }) -> RiderBatchList`
- `rider.listAssignments() -> RiderAssignmentList`
- `rider.getBatch({ batchId }) -> RiderBatchView`
- `rider.markEnRoute({ jobId, expectedVersion, idempotencyKey })`
- `rider.markArrived({ stopId, occurredAt, expectedVersion, idempotencyKey })`
- `rider.markDelivered({ stopId, occurredAt, proofMetadata?, expectedVersion, idempotencyKey })`
- `rider.markFailed({ stopId, reasonCode, notes?, occurredAt, expectedVersion, idempotencyKey })`

`getRiderBatches` derives the active canonical Rider from the authenticated
session and accepts no client Rider identity. It returns only that Rider's
assigned operational batches in their exact `INSTANT` or `SCHEDULED` context.
Each batch identifies the first unfinished immutable stop as
`currentDelivery`, returns later unfinished stops as an ordered
`upcomingDeliveries` projection, and includes only Core-derived legal actions.
Destination coordinates, display address, recipient/contact data, and delivery
instructions come from the immutable stop snapshot rather than the customer's
current saved address. The historical `riderJobs` projection remains a
deprecated compatibility read while callers migrate; it is not a second Rider
authorization or sequencing authority.

Core verifies that the rider is assigned to the job. Client-supplied timestamps are recorded as reported metadata where useful; Core records authoritative receipt time. Web may build a keyless Google Maps universal URL only for the current delivery's immutable coordinate. It supplies no origin or waypoints, and navigation itself causes no FreshMarkets state transition.

## Analytics Queries

- `admin.analytics.listMetricDefinitions({ category?, status? }) -> MetricDefinitionView[]`
- `admin.analytics.getOverview({ window, timezone, dimensions? }) -> AnalyticsOverviewView`
- `admin.analytics.getMetric({ metricCode, definitionVersion?, window, timezone, dimensions? }) -> MetricSeriesView`

Analytics contracts return definition code/version, formula description, source watermark/freshness, currency/base-unit dimensions, and null/unavailable reason when a required accounting or renewal policy is unresolved. They never expose a metric under an unapproved formula, mix currencies or quantity dimensions silently, or provide mutation methods for source context state. `analytics.read` is required.

Metric-definition lifecycle filters use `APPROVED|BLOCKED|SUPERSEDED`; unversioned reads resolve the latest definition, while an explicitly requested superseded version returns a typed unavailable result. Overview dimensions apply only to metrics declaring that dimension and never remove unrelated metrics. Dimension-sensitive scalar reads return the effective currency/base unit in their DTO or a stable unavailable reason when the source window contains more than one.

## Contract Testing

- Compile both deployments against the shared contract package.
- Run schema/validation tests for every input and DTO.
- Test that no contract imports infrastructure/D1/provider types.
- Test authentication cookie and redirect preservation end to end.
- Test every command for unauthenticated, unauthorized, out-of-scope, invalid-transition, stale-version, and duplicate-idempotency behavior.
- Test provider ingress separately for signature failure, duplicate/out-of-order `(provider, providerEventId)`, canonical-state mapping, compare-and-swap conflict, safe retry, and reconciliation; do not fabricate webhook `expectedVersion` values.
- Test fulfillment-mode DTOs so `INSTANT` never requires a cycle and `SCHEDULED` never treats `WEEKLY` as its mode; verify committed snapshots survive configuration changes.
- Test controlled unit dimensions, integer SKU consumption, absence of universal packaging conversion, nonzero SKU/context pricing, deterministic Promotion component stacking, and complete Quote/Order financial components.
- Test every Admin/Analytics query for capability/scope enforcement, no Better Auth/raw-row Customer leakage, definition-version consistency, and read-only source ownership.
- During deployment, maintain compatibility for any interval in which Web and Core versions may differ.
