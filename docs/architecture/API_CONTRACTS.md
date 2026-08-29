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
- `fulfillment.getOptions({ addressId, cartId }) -> FulfillmentOptionView[]`

`MarketplaceProductView` includes customer display data and persisted fixed variants with `skuId`, display/packaging label (`500 g`, `1 pack`), optional `Pack`/`Bunch` merchandising label, integer sell quantity, controlled sell-unit code/display (`G`/`KG`/`PC`), exact integer base-unit consumption, core-resolved media (`src` + `alt`) with ordered customer-facing product details, an approximate assembled-pack contents note, the current SKU/market/location quoteable price, availability messaging, and fulfillment context. Staff packing instructions never appear in any public DTO. It does not expose inventory ledger quantities unless a deliberate customer-facing availability field is defined. Sellable sizes are returned from database configuration, not a hard-coded union.

`catalog.search` applies query/category/activity/availability/price predicates database-side before keyset pagination over `(category sort order, product name, product id)`; results are bounded (`limit` 1–50) and `nextCursor` is an opaque token whose malformed values return `VALIDATION_FAILED`. The complete launch catalog (226 produce products at seed time) is reachable through cursors without truncation. `marketplace.getHome` returns active categories plus bounded category rails (default 8 items per rail, capped at 12) built from one windowed scan and the same eligibility rules as search, never materializing the full catalog into one response.

`FulfillmentOptionView` exposes an opaque option ID, `fulfillmentMode: "INSTANT" | "SCHEDULED"`, customer-facing promise/window/ETA, fee context, and for Scheduled only its configured cadence and selectable cycle/window identity. `WEEKLY` may appear as Scheduled cadence but never as `fulfillmentMode`. It exposes no customer-selectable fulfillment location.

## Serviceability

- `serviceability.resolveCoordinates({ latitude, longitude, addressComponents? }) -> ServiceabilityResult`

`ServiceabilityResult` includes `serviceable`, stable failure reason, market/area/zone display context, active polygon versions, resolution-change detection, and a mode-aware fulfillment-eligibility summary. Internal polygon GeoJSON, location codes, active-mode configuration IDs, and ranking rules are never exposed. Customers do not select a location; Core resolves eligible operations context internally and always re-resolves at checkout.

Saved-address commands are customer-boundary operations:

- `addresses.listMine({ headers }) -> CustomerAddressView[]`
- `addresses.create({ label, recipient, phone, addressJson, latitude, longitude, notes? }) -> CustomerAddressView`
- `addresses.update({ addressId, expectedVersion, changed address fields }) -> CustomerAddressView`

Core derives the customer from the Better Auth session, verifies address ownership,
and never accepts a client-selected customer or principal ID. Address updates require
`expectedVersion`; stale writes return `STALE_VERSION`. Coordinate changes re-run
authoritative serviceability resolution, while service-area, delivery-zone, resolution
version, status, and other serviceability fields are server-derived. The address view
returns the persisted resolver `serviceable` outcome and failure reason. Both are null
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
- `cart.addItem({ skuId, quantity, expectedVersion }) -> CartView`
- `cart.updateQuantity({ itemId, quantity, expectedVersion }) -> CartView`
- `cart.removeItem({ itemId, expectedVersion }) -> CartView`
- `cart.clear({ expectedVersion }) -> CartView`

Cart `quantity` is an integer count of the configured SKU, never kilograms/liters or a floating requested weight. `CartView` repeats the SKU sell-unit and exact base-unit-consumption projection for clarity but remains non-authoritative until Quote. Cart version supports optimistic concurrency. Cart activity alone promises no inventory hold/reservation or capacity.

## Checkout Eligibility and Quote

- `checkout.evaluate({ cartId, addressId, fulfillmentOptionId, promotionCodes? }) -> CheckoutEligibilityView`
- `checkout.refreshQuote({ checkoutAttemptId }) -> CheckoutQuoteView`

The view reports each eligibility dimension, explicit financial components, price/availability changes, resolved serviceability, selected `INSTANT`/`SCHEDULED` option, delivery promise, Instant hold status or Scheduled cycle/capacity status, applied/rejected Promotions by price component, and available alternatives. Sensitive location-selection rules remain internal.

`CheckoutQuoteView` contains `merchandiseSubtotalMinor`, `itemDiscountMinor`, `orderDiscountMinor`, `deliveryFeeMinor`, `deliveryDiscountMinor`, `serviceFeeMinor`, `taxMinor`, `finalTotalMinor`, and currency. Item lines snapshot SKU quantity/unit/base consumption and allocated discount. The internal quote snapshot also records provider-neutral route meters, delivery minimum/rate, calculated fee, configuration version, and road-route/driving calculation metadata. Percentage/fixed Order benefits use only the approved merchandise basis; Delivery benefits use only delivery fee.

The authoritative service validates authenticated Customer, subscription, cart, SKU/market/location prices, minimum basket, address coordinates, service area, zone, resolved location and active mode, mode-specific inventory hold or cycle/cutoff/capacity, Promotions eligibility/limits/stacking, provider-neutral route distance, effective delivery-fee configuration, and payment readiness. External route/configuration failure fails closed. For each Order quote it selects at most one merchandise benefit and one delivery benefit; a valid explicit selection wins its component, otherwise highest computed value then stable Promotion ID determines the winner.

## Checkout, Payment, and Order Commitment

- `checkout.createAttempt({ cartId, addressId, fulfillmentOptionId, promotionCodes?, idempotencyKey }) -> CheckoutAttemptView`
- `checkout.createPayment({ checkoutAttemptId, expectedTotalMinor, paymentMethod, returnUrl, idempotencyKey }) -> PaymentActionView`
- `checkout.getAttempt({ checkoutAttemptId }) -> CheckoutAttemptView`
- `checkout.recoverCommitment({ checkoutAttemptId }) -> OrderCommitmentResult`

Core receives payment provider webhooks through a signed public webhook handler rather than Web RPC:

- verify signature and timestamp;
- insert `(provider, providerEventId)` into the durable Payments inbox exactly once;
- translate the vendor state into canonical Payments state under the configured payment commitment policy;
- update Payments using handler-side legal-transition and compare-and-swap protection, safely retrying/reconciling concurrent aggregate changes;
- invoke an explicit idempotent Membership or Order application command when the canonical outcome is sufficient;
- commit/recover the Membership activation or Order exactly once;
- enqueue non-critical follow-up.

Provider webhook payloads never contain an application `expectedVersion`. Vendor captured/success states map to canonical Payments `SUCCEEDED` for MVP; browser return state and payment initiation do not. The payment provider remains an adapter and its vocabulary is not exposed in Membership or Order DTOs.

Immediately before payment creation, Core recalculates current catalog prices, discounts, stock, serviceability, route-based delivery fee, and fulfillment eligibility. `expectedTotalMinor` must equal the recalculated total; otherwise Core returns `PRICE_CHANGED` without creating a payment and the browser must present a replacement quote for explicit acceptance.

`OrderCommitmentResult` is either the existing/new committed order summary or a stable actionable exception. Duplicate requests return the same logical result. If mode-specific inventory/capacity is unavailable before charge, return valid fulfillment alternatives without exposing or asking the customer to select a location. If canonical payment commitment succeeds but the downstream Membership/Order command cannot complete, preserve the payment observation and retry the same idempotent commitment. Bounded failure creates a visible finance/reconciliation exception. A second payment/order and automatic refund are forbidden unless a separately approved recovery command explicitly authorizes them.

For `INSTANT`, attempt creation/refresh atomically creates or replaces an expiring exact-base-unit inventory hold and commitment converts it into a committed reservation. For `SCHEDULED`, commitment uses the selected cycle/window, cutoff, capacity, and configured reservation/demand policy. The committed result snapshots fulfillment mode, resolved location/zone/service area, promise/window/ETA, optional Scheduled cycle identifiers, SKU conversion, Promotions, all monetary components, and the accepted provider-neutral route/delivery-fee calculation.

## Customer Orders and Amendments

- `orders.listMine(page) -> CustomerOrderPage`
- `orders.getMine({ orderId }) -> CustomerOrderDetail`
- `orders.getAmendmentEligibility({ orderId }) -> AmendmentEligibilityView`
- `orders.createAmendmentDraft({ orderId, items, idempotencyKey }) -> AmendmentDraftView`
- `orders.payAmendment({ amendmentId, paymentMethod, returnUrl, idempotencyKey }) -> PaymentActionView`

Customer order DTOs compose original and amendment timelines while preserving separate financial records.

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

`packages/contracts/src/admin-catalog.ts` publishes `AdminCatalogService` (`listAdminCategories`, `createAdminCategory`, `listAdminUnits`, `createAdminUnit`, `listAdminProducts`, `getAdminProduct`, `setAdminProductStatus`, `createAdminSku`, `updateAdminSku`, `setAdminSkuAvailability`, `setAdminSkuPrice`) and `AdminInventoryReadService` (`listAdminInventory`, `getAdminInventoryLedger`).

- Authorization: catalog surfaces require `catalog.read`/`catalog.manage` plus a global scope; inventory reads require `inventory.read` plus operational scope over the requested location (global, its market, or that exact location). The guarded `inventory.adjust` command keeps its existing capability + scope + idempotency + version guards.
- No schema change was required: the surface composes the existing catalog/price/availability/inventory tables. Prices are inserted as new `price_version` rows (version increments, market-scoped `STANDARD`, location NULL); history is never rewritten and zero amounts fail closed.
- SKU creation validates that the sellable unit's dimension matches the product pool's base-unit dimension; SKU updates and availability upserts are version-guarded (`sku_location_availability` inserts use `expectedVersion 0`). Product status toggles are reason-gated, audited, and guarded on current status.
- Deferred: media administration (canonical R2 `product_media` remains a deferred migration; binaries stay public Web assets), bulk import, product/sku detail authoring, and purchase/receiving surfaces.

## Admin Orders and Payments

- `admin.orders.list(filters, page) -> AdminOrderListPage`
- `admin.orders.get({ orderId }) -> AdminOrderDetail`
- `admin.orders.cancel({ orderId, reason, resolution, expectedVersion, idempotencyKey }) -> AdminOrderDetail`
- `admin.orders.recordExceptionResolution(...)`
- `admin.payments.list(filters, page) -> PaymentOperationsPage`
- `admin.payments.refund({ paymentId, amountMinor, reason, idempotencyKey }) -> RefundView`
- `admin.payments.reconcile({ paymentId, idempotencyKey }) -> ReconciliationResult`

Admin order detail is an operational read model combining order, payment, demand/reservation, fulfillment, delivery, and audit summaries; it is not a raw join response.

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
- `admin.delivery.createBatch({ cycleId, zoneId, locationId, jobIds, idempotencyKey }) -> DeliveryBatchView`
- `admin.delivery.assignRider({ batchId, riderId, expectedVersion, idempotencyKey }) -> DeliveryBatchView`
- `admin.delivery.reorderStops(...) -> DeliveryBatchView`
- `admin.delivery.rescheduleJob(...) -> DeliveryJobView`
- `admin.delivery.resolveFailure(...) -> DeliveryJobView`

Cycle identity is required only for Scheduled operations. Instant delivery read models group by location/promise/deadline and rider assignment without inventing a cycle.

## Rider Operations

- `rider.listAssignments() -> RiderAssignmentList`
- `rider.getBatch({ batchId }) -> RiderBatchView`
- `rider.markEnRoute({ jobId, expectedVersion, idempotencyKey })`
- `rider.markArrived({ stopId, occurredAt, expectedVersion, idempotencyKey })`
- `rider.markDelivered({ stopId, occurredAt, proofMetadata?, expectedVersion, idempotencyKey })`
- `rider.markFailed({ stopId, reasonCode, notes?, occurredAt, expectedVersion, idempotencyKey })`

Core verifies that the rider is assigned to the job. Client-supplied timestamps are recorded as reported metadata where useful; Core records authoritative receipt time.

## Analytics Queries

- `admin.analytics.listMetricDefinitions({ category?, status? }) -> MetricDefinitionView[]`
- `admin.analytics.getOverview({ window, timezone, dimensions? }) -> AnalyticsOverviewView`
- `admin.analytics.getMetric({ metricCode, definitionVersion?, window, timezone, dimensions? }) -> MetricSeriesView`

Analytics contracts return definition code/version, formula description, source watermark/freshness, currency/base-unit dimensions, and null/unavailable reason when a required accounting or renewal policy is unresolved. They never expose a metric under an unapproved formula, mix currencies or quantity dimensions silently, or provide mutation methods for source context state. `analytics.read` is required.

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
