# Checkout and Financial Safety Remediation Design

**Program:** Full Codebase Remediation — Program 1  
**Priority:** Release blocker  
**Scope:** Membership entitlement, checkout policy, capacity, Payments, recurring authorization, refunds, and provider-event financial reactions

## Objective

Make every path from cart to paid order obey the same membership and commerce policies, and make every interaction with external money safe under retries, timeouts, races, and lost responses.

## 1. Canonical membership entitlement

Membership will expose one application policy:

```ts
type EntitlementDecision = {
  eligible: boolean;
  state: SubscriptionState | null;
  effectiveUntil: number | null;
  reason:
    | "ENTITLED"
    | "NO_SUBSCRIPTION"
    | "TRIAL_ENDED"
    | "GRACE_ENDED"
    | "STATE_NOT_ENTITLED";
};

evaluateSubscriptionEntitlement(
  database: D1Database,
  input: { customerId: string; at: number },
): Promise<EntitlementDecision>;
```

Rules:

- `TRIALING` is eligible only when `trial_ends_at > at`.
- `ACTIVE` is eligible through its current paid period and is never invalidated by a historical `trial_ends_at` value.
- `PAST_DUE` is eligible only when `grace_ends_at > at`.
- `PENDING`, `PAUSED`, `CANCELED`, `EXPIRED`, absent subscriptions, and timestamps exactly at their end instant are ineligible.
- Scheduled cancellation intent does not change entitlement until the effective transition executes.
- The latest active lifecycle aggregate is selected deterministically.

The existing eligibility read model, checkout evaluation, quote creation, payment revalidation, and order commitment must call this policy. Direct subscription-status SQL in those consumers is removed. Tests cover every state, exact time boundaries, `ACTIVE` after trial conversion with a retained historical trial timestamp, and `PAST_DUE` before/at/after grace.

## 2. Authoritative commerce policy and quote composition

Checkout will separate advisory evaluation from an authoritative quote policy without duplicating rules. A shared application service will resolve:

- market and currency;
- fulfillment location and mode;
- current SKU price versions;
- active cart version and sellability;
- membership entitlement;
- minimum basket;
- applicable Promotions benefits and stacking;
- delivery fee;
- mode-specific inventory/capacity evidence; and
- immutable financial components.

The quote is rejected before persistence when the pre-discount merchandise subtotal is below `minimum_basket_minor`. This preserves the current advisory policy and prevents delivery charges from satisfying a merchandise minimum. If the business later approves a post-discount basis, that change requires an explicit versioned commerce-policy field and canonical documentation update rather than an implicit calculation change.

Quote financial snapshots will expose distinct integer components:

```ts
type QuoteFinancialSnapshot = {
  merchandiseSubtotalMinor: number;
  itemDiscountMinor: number;
  orderDiscountMinor: number;
  deliverySubtotalMinor: number;
  deliveryDiscountMinor: number;
  serviceFeeMinor: number;
  taxMinor: number;
  totalMinor: number;
  currency: string;
};
```

For components not yet commercially enabled, the canonical policy explicitly supplies zero; zero is never inferred from missing price/configuration. Missing SKU price remains unavailable and causes quote failure.

The same service powers `evaluateCheckout` and quote creation. Advisory evaluation may return multiple failure reasons; authoritative commands fail with the first stable actionable error but may log the full internal decision set.

## 3. Scheduled capacity acquisition

Paid-order commitment will acquire one Scheduled capacity unit in the same D1 atomic batch as:

- payment-reaction claim;
- order and immutable snapshots;
- fulfillment/delivery initial records;
- inventory reservations or planned demand;
- quote consumption; and
- payment-reaction completion.

The capacity update remains conditional on `allocated < capacity`. An immediately adjacent guard statement forces a constraint failure when the update changed zero rows. That failure rolls back the whole batch and creates a finance exception after rollback. No order, order line, inventory reservation, planned demand, fulfillment record, delivery job, quote consumption, or successful reaction may survive a failed capacity acquisition.

The quote-consumption CAS receives the same treatment: a zero-row update aborts commitment. This protects against two successful payment intents racing for the same quote. The database will additionally enforce at most one committed order for a checkout quote through a persisted quote/attempt identity on the order-payment linkage.

Integration tests execute two paid reactions against one remaining capacity unit and two reactions against one quote. Exactly one commitment succeeds; the losing payment remains visible through a finance exception and reconciliation path.

## 4. Provider customer persistence

Repository methods whose names describe writes will execute their writes and return `Promise<D1Result>` or a domain result. They will not expose an unexecuted `D1PreparedStatement` to callers unless the method name explicitly ends with `Statement` and is used only inside a visible batch.

`upsertProviderCustomer` will execute or be included in the provider-command batch. Tests prove:

- the row exists after first payment and authorization initiation;
- the same provider mapping is reused;
- a second provider cannot overwrite a customer mapping owned by another provider; and
- provider/customer unique conflicts return a stable configuration/reconciliation error.

## 5. Payment command idempotency and ambiguous outcomes

### Claim order

Application intent and idempotency identity persist before the external provider call. Recurring authorization adopts the same ordering as payment and refund commands.

### Provider result classification

Provider adapters return explicit definitive rejection as a typed result. A thrown exception, timeout, connection reset, response-parse failure, or accepted-provider/local-persistence failure is ambiguous.

- Definitive rejection may transition an intent to `FAILED` or an authorization command to failed.
- Ambiguous outcomes stay `INITIATED` or `PROCESSING`, record a reconciliation case, and return `PAYMENT_OUTCOME_UNRESOLVED` or `AUTHORIZATION_OUTCOME_UNRESOLVED`.
- Retrying uses the same provider idempotency identity or an adapter lookup; it never creates a new identity merely because the first response was lost.

### Recoverable client actions

A new provider-action persistence seam stores only the browser action required to continue an accepted session:

- action type;
- redirect URL or browser client token;
- expiry instant;
- provider and provider reference;
- payment intent or authorization identity; and
- active/expired/consumed state.

It never enters admin/customer order projections or logs. It is cleared or marked consumed when the provider reports a terminal outcome and is expired by scheduled cleanup. D1 encryption at rest and short expiry protect the intentionally browser-delivered token.

Idempotent replay returns the same still-valid action. If it expired, Core asks an adapter to resume/lookup the existing provider session where supported; otherwise it returns a stable `PAYMENT_ACTION_EXPIRED` response that preserves the existing intent and directs an explicit recovery command. Replay never reports `REDIRECT` with a null URL or `SDK` with a null token.

### Checkout payment revalidation

The caller's quote identity remains the payment subject. Revalidation creates an internal decision/snapshot comparison, not a second user-visible quote that supersedes the original before replay. The application checks an existing payment command by idempotency key before rejecting the quote's current lifecycle state, so a lost successful response can be replayed after quote consumption or supersession.

Tests simulate a provider timeout after acceptance, a lost browser response followed by replay, concurrent identical authorization calls, an expired client action, and persistence failure after provider acceptance.

## 6. Refund budget reservation

Refundable value is:

```text
captured amount
- sum(SUCCEEDED refunds)
- sum(REQUESTED, APPROVED, PROCESSING, ESCALATED refunds)
```

`REJECTED` and definitively `FAILED` refunds release their reservation. `ESCALATED` remains reserved until an explicit reconciliation command resolves it, because the provider outcome may have moved money.

Refund claim uses one guarded `INSERT ... SELECT` (or equivalent atomic statement) that succeeds only when the requested amount fits the remaining refundable value. Provider communication occurs only after this claim. Two concurrent full-refund requests therefore produce one provider request and one `REFUND_AMOUNT_UNAVAILABLE` result.

Refund reconciliation updates both refund state and the payment intent's `SUCCEEDED`, `PARTIALLY_REFUNDED`, or `REFUNDED` state from canonical totals. Tests cover sequential outstanding refunds, concurrent requests, partial completion, rejection release, ambiguous escalation, and final totals.

## 7. Provider inbox financial retry

Program 2 owns the generic inbox lease/redrive infrastructure. Program 1 supplies idempotent handlers for payment and refund observations so replaying a claimed inbox record cannot duplicate attempts, reactions, orders, membership transitions, or refunds.

The inbox stores a provider-normalized safe observation sufficient for retry. Raw provider secrets and unrestricted payloads are not persisted. Integrity remains protected by `(provider, providerEventId)` and payload hash.

## Contract changes

- Add stable errors for membership expiry/grace, minimum basket, capacity conflict, unresolved provider outcome, expired provider action, and unavailable refund amount.
- Add explicit financial components to quote and order snapshots.
- Preserve compatibility adapters only at the Core boundary while Web migrates; remove them in the same program once no caller remains.
- No provider reference, payload, action token, or reconciliation JSON enters ordinary customer order DTOs.

## Observability

Structured events include request ID, command scope, domain identity, provider code, attempt count, and safe outcome category. They exclude cookies, authorization headers, action URLs/tokens, raw webhook bodies, customer address contents, and provider payloads.

Metrics required for launch readiness:

- capacity acquisition conflict count;
- unresolved payment/authorization/refund outcomes;
- provider command replay count;
- expired client-action count;
- refund-budget rejection count; and
- payment-reaction finance-exception age.

## Verification and acceptance

Before this program is complete:

- Every behavior above has a test observed failing before production code.
- Membership, quote, payment, commitment, refund, provider-inbox, and concurrency integration suites pass under `@cloudflare/vitest-pool-workers`.
- A browser test proves a lost/repeated checkout-payment request returns the same usable action.
- The Core dry-run build, Web build, typecheck, lint, migration verification, and complete repository test suite pass.
- Canonical domain, state-machine, data-model, API-contract, MVP-scope, implementation-plan, and implementation-status documents agree with the executable behavior.
