# Provider-Neutral Payments Context Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Establish Payments as the sole owner of provider-neutral financial state, signed/deduplicated provider events, CAS/reconciliation, payment purposes, and non-synthetic refunds without choosing the production vendor.

**Architecture:** Add a focused Payments bounded context inside Core with domain states/purposes, provider ports, D1 repositories, durable provider-event inbox, and durable reaction records. Provider adapters verify/map vendor payloads into canonical observations; Payments applies observations with current-state/version CAS and emits idempotent application reactions for Membership or Orders. A fake adapter proves the port and event behavior but is impossible to register in production.

**Tech Stack:** Cloudflare Worker HTTP webhook ingress, D1, TypeScript, Zod, Vitest Workers pool, shared RPC contracts.

**Spec:** `docs/architecture/ARCHITECTURE.md` Payments ownership; `docs/architecture/DOMAIN_MODEL.md` Payment and Refund; `docs/architecture/STATE_MACHINES.md` Payment Attempt and Refund; `docs/architecture/DATA_MODEL.md` Payments and Refunds; `docs/architecture/API_CONTRACTS.md` Membership Payments and Checkout/Payment/Order Commitment.

## Global Constraints

- Priority: P0 for provider-event identity, canonical state, refund integrity, and fabricated-outcome removal; P1 for full provider-neutral ownership and module structure.
- Depends on Financial Containment and Contracts/Web Boundary plans.
- Applied migrations are immutable; this plan creates only `0016_payments_context.sql` after Plan 03's replacement `0015`.
- Provider payloads and vendor statuses never enter Membership, Orders, shared DTOs, or state columns.
- Provider events never accept `expectedVersion`; handlers load current state and use CAS.
- Browser return state, payment initiation, and unsigned events never produce canonical `SUCCEEDED`.
- Do not select or simulate a production provider. The fake adapter is test-only and must throw if registered outside `test`.

---

## Dependencies and Decision Blockers

- Depends on Plans 02, 03 migration baseline, and 04.
- Production provider selection blocks only the production adapter, exact signature algorithm, and vendor mapping fixtures. It does not block domain state, payment purposes, tables, port, fake-adapter contract tests, inbox deduplication, CAS, or reconciliation.
- Paid-success/downstream-commit recovery policy blocks automatic selection between retry and refund after reaction failure. It does not block durable reaction failure/finance-exception state or manual reconciliation.
- Dunning, cancellation default, and billing-anchor policy do not block Payments infrastructure.

## Migration and Compatibility Impact

- Create: `apps/core/migrations/0016_payments_context.sql`.
- Preserve legacy `payment_attempt`, `payment_event`, and `refund` rows as historical compatibility data.
- Add canonical `payment_intent`, provider mapping, event inbox, reaction, and reconciliation tables. Link new attempts to intents additively; never reinterpret historical synthetic success as provider-confirmed production success.
- Historical synthetic compatibility methods are removed; only the signed-event/reaction path remains.

## Task Impact Matrix

| Task | Depends on | Migration impact | Compatibility impact | Unresolved product-decision blocker |
|---|---|---|---|---|
| 1. Domain/contracts | Plan 04 | None | Canonical purposes/states replace vendor-shaped and synthetic contract fields | Provider selection does not block canonical types |
| 2. Persistence | Task 1 | Creates `0016_payments_context.sql` | Additive mapping/inbox/reaction/refund records preserve existing commerce history | None |
| 3. Intent/adapters | Tasks 1–2 | Uses `0016`; no additional migration | Fake adapter is test-only; production intent creation remains disabled without a configured adapter | Provider selection blocks only a production adapter and exact mapping |
| 4. Event inbox | Tasks 2–3 | Uses `0016`; no additional migration | Narrow webhook route can be enabled only with a signature-validating production adapter | Provider selection blocks production route enablement, not inbox/CAS/retry logic |
| 5. Reconciliation/refunds | Tasks 2–4 | Uses `0016`; no additional migration | Synthetic refunds are replaced by canonical pending/outcome handling | Provider selection blocks real provider refund calls; downstream recovery policy blocks automatic refund-versus-retry resolution |

## Task Acceptance Matrix

| Task | Acceptance criteria |
|---|---|
| 1. Domain/contracts | Canonical provider-neutral purposes, payment/refund states, transitions, ports, and reactions compile without vendor or Membership/Order lifecycle leakage |
| 2. Persistence | `0016` applies fresh/upgrade and uniquely owns provider mappings, event inbox identity, reactions, refunds, and reconciliation state |
| 3. Intent/adapters | Application commands create/replay intents by purpose and idempotency; production cannot use the fake adapter or start without a configured real adapter |
| 4. Event inbox | Signature is verified before trust; `(provider, providerEventId)` deduplicates durably; CAS conflict is retryable/reconcilable; no webhook `expectedVersion` exists |
| 5. Reconciliation/refunds | Missing/out-of-order events and refund attempts remain canonical, auditable, idempotent, and non-synthetic with unresolved automation left disabled |

## Task 1: Canonical Payments domain and contracts

**Files:**
- Create: `apps/core/src/payments/domain/payment.ts`
- Create: `apps/core/src/payments/domain/payment.test.ts`
- Create: `apps/core/src/payments/ports/payment-provider.ts`
- Modify: `packages/contracts/src/payments.ts`
- Modify: `packages/contracts/src/core-service.ts`
- Test: `packages/contracts/src/core-service.test.ts`

**Interfaces:**
- Produces: `PaymentPurpose = "MEMBERSHIP_ENROLLMENT" | "MEMBERSHIP_RENEWAL" | "GROCERY_CHECKOUT" | "ORDER_AMENDMENT"`
- Produces canonical `PaymentState` from Plan 04
- Produces: `PaymentProvider` with `createPayment`, `verifyAndParseEvent`, `getPayment`, and `requestRefund`
- Produces: `ProviderPaymentObservation { provider, providerEventId, providerReference, observedAt, canonicalState, amountMinor, currency, payloadHash }`
- Produces: `PaymentCommitmentPolicy { isSufficient(state: PaymentState): boolean }`, with MVP policy true only for canonical `SUCCEEDED`

- [ ] **Step 1: Write failing transition/policy tests**

```ts
expect(transitionPayment("INITIATED", "PROCESSING")).toBe("PROCESSING");
expect(transitionPayment("PROCESSING", "SUCCEEDED")).toBe("SUCCEEDED");
expect(() => transitionPayment("FAILED", "SUCCEEDED")).toThrow("ILLEGAL_TRANSITION");
expect(mvpPaymentCommitmentPolicy.isSufficient("SUCCEEDED")).toBe(true);
expect(mvpPaymentCommitmentPolicy.isSufficient("PROCESSING")).toBe(false);
```

Add compile fixtures proving the provider observation has no `expectedVersion` and Membership/Order DTOs contain no vendor state.

- [ ] **Step 2: Run focused tests and prove failure**

Run: `pnpm --filter @freshmarkets/core exec vitest run --config vitest.config.ts src/payments/domain/payment.test.ts && pnpm --filter @freshmarkets/contracts test`

Expected: FAIL because the Payments domain and port do not exist.

- [ ] **Step 3: Implement the minimal domain and port**

Encode only transitions approved by `STATE_MACHINES.md`. `PaymentProvider.verifyAndParseEvent` consumes raw HTTP body/headers and returns a verified observation or a stable verification error; callers cannot construct a trusted observation from browser JSON.

- [ ] **Step 4: Run focused tests and typecheck**

Run: `pnpm --filter @freshmarkets/core exec vitest run --config vitest.config.ts src/payments/domain/payment.test.ts && pnpm --filter @freshmarkets/contracts test && pnpm typecheck`

Expected: all commands exit 0.

- [ ] **Step 5: Commit domain and contracts**

Run: `git add apps/core/src/payments/domain apps/core/src/payments/ports packages/contracts/src/payments.ts packages/contracts/src/core-service.ts packages/contracts/src/core-service.test.ts && git commit -m "feat(payments): define canonical payment domain"`

## Task 2: Additive Payments persistence

**Files:**
- Create: `apps/core/migrations/0016_payments_context.sql`
- Create: `apps/core/src/payments/infrastructure/payment-schema.integration.test.ts`

**Interfaces:**
- Produces: `payment_intent(id, purpose, subject_type, subject_id, customer_id, amount_minor, currency, status, idempotency_key, version, created_at, updated_at)`
- Produces: `payment_provider_customer`, `payment_provider_method`
- Produces: `payment_provider_event_inbox` unique on `(provider, provider_event_id)`
- Produces: `payment_reaction(id, payment_intent_id, reaction_type, subject_type, subject_id, status, idempotency_key, attempts, last_error_code, available_at, created_at, updated_at)`
- Produces: `payment_reconciliation_case(id, payment_intent_id, category, status, details_json, created_at, resolved_at)`
- Adds nullable `payment_intent_id` to legacy `payment_attempt` for forward writes

- [ ] **Step 1: Write failing schema tests**

Assert every table/column/index exists, duplicate `(provider, providerEventId)` fails, negative amount fails, and duplicate reaction idempotency fails. Assert a payment intent purpose outside the closed values fails its `CHECK` constraint.

- [ ] **Step 2: Run schema tests and prove failure**

Run: `pnpm --filter @freshmarkets/core exec vitest run --config vitest.config.ts src/payments/infrastructure/payment-schema.integration.test.ts`

Expected: FAIL because migration `0016` and canonical tables do not exist.

- [ ] **Step 3: Create the additive migration**

Use integer minor units, explicit currency, integer versions defaulting to 1, UTC millisecond instants, closed `CHECK` constraints, and the unique identities listed above. Do not add provider fields to `subscription` or `grocery_order`.

- [ ] **Step 4: Apply fresh migrations and rerun tests**

Run: `pnpm --filter @freshmarkets/core exec vitest run --config vitest.config.ts src/payments/infrastructure/payment-schema.integration.test.ts`

Expected: all tests pass and migrations `0001`–`0016` apply in order.

- [ ] **Step 5: Commit Payments persistence**

Run: `git add apps/core/migrations/0016_payments_context.sql apps/core/src/payments/infrastructure/payment-schema.integration.test.ts && git commit -m "feat(payments): add provider neutral persistence"`

## Task 3: Payment-intent creation and provider adapter registry

**Files:**
- Create: `apps/core/src/payments/application/create-payment.ts`
- Create: `apps/core/src/payments/application/create-payment.integration.test.ts`
- Create: `apps/core/src/payments/infrastructure/d1/payment-repository.ts`
- Create: `apps/core/src/payments/infrastructure/providers/provider-registry.ts`
- Create: deterministic mock provider infrastructure (renamed to `mock-payment-provider.ts` by the 2026-08-27 reconciliation)
- Test: `apps/core/src/payments/infrastructure/providers/provider-contract.test.ts`
- Modify: `apps/core/src/index.ts` to compose/delegate only
- Modify: `packages/contracts/src/payments.ts`
- Modify: `packages/contracts/src/core-service.ts` after methods work

**Interfaces:**
- Consumes: `CreatePaymentCommand { purpose, subjectType, subjectId, customerId, amountMinor, currency, paymentMethod, returnUrl, idempotencyKey, requestId }`
- Produces: `PaymentActionView { paymentIntentId, state, actionType, redirectUrl, clientToken, expiresAt }` with mutually exclusive safe action fields
- Produces: `ProviderRegistry.get(providerCode): PaymentProvider`
- Fake adapter code: `fake`, registered only when `ENVIRONMENT === "test"`

- [ ] **Step 1: Write failing creation/replay/provider tests**

Cover same-key/same-payload replay, same-key/different-payload conflict, amount/currency validation, missing provider, fake adapter blocked in production, and provider output mapped to canonical `REQUIRES_ACTION` rather than success.

- [ ] **Step 2: Run focused tests and prove failure**

Run: `pnpm --filter @freshmarkets/core exec vitest run --config vitest.config.ts src/payments/application/create-payment.integration.test.ts src/payments/infrastructure/providers/provider-contract.test.ts`

Expected: FAIL because creation/repository/registry modules do not exist.

- [ ] **Step 3: Implement intent creation**

Persist the application intent before calling the provider. Persist provider attempt/action after the provider returns. If the external call succeeds but D1 persistence fails, create a reconciliation case keyed by the provider reference on retry/reconciliation; never mark `SUCCEEDED` from the create response.

- [ ] **Step 4: Run focused tests and typecheck**

Run: `pnpm --filter @freshmarkets/core exec vitest run --config vitest.config.ts src/payments/application/create-payment.integration.test.ts src/payments/infrastructure/providers/provider-contract.test.ts && pnpm typecheck`

Expected: all tests pass.

- [ ] **Step 5: Commit payment creation**

Run: `git add apps/core/src/payments apps/core/src/index.ts packages/contracts/src/payments.ts packages/contracts/src/core-service.ts && git commit -m "feat(payments): create idempotent payment intents"`

## Task 4: Signed provider-event inbox, CAS, and reactions

**Files:**
- Create: `apps/core/src/payments/application/ingest-provider-event.ts`
- Create: `apps/core/src/payments/application/ingest-provider-event.integration.test.ts`
- Create: `apps/core/src/payments/http/provider-webhook.ts`
- Test: `apps/core/src/payments/http/provider-webhook.test.ts`
- Modify: `apps/core/src/payments/infrastructure/d1/payment-repository.ts`
- Modify: `apps/core/src/index.ts` HTTP routing only

**Interfaces:**
- Consumes: `ingestProviderEvent(providerCode, rawRequest): Promise<ProviderEventResult>`
- Produces: `ProviderEventResult { provider, providerEventId, processingStatus, paymentIntentId, canonicalState }`
- Produces reaction types: `ACTIVATE_MEMBERSHIP`, `RECOVER_MEMBERSHIP`, `COMMIT_ORDER`, `COMMIT_AMENDMENT`
- Inbox processing states: `RECEIVED | APPLIED | DUPLICATE | RETRY_REQUIRED | RECONCILIATION_REQUIRED | REJECTED`

- [ ] **Step 1: Write failing webhook/inbox tests**

Cover invalid signature, unique first event, exact duplicate, same provider event ID with different payload hash, out-of-order observation, concurrent application command changing payment version, and a sufficient canonical outcome producing exactly one pending reaction.

- [ ] **Step 2: Run focused tests and prove failure**

Run: `pnpm --filter @freshmarkets/core exec vitest run --config vitest.config.ts src/payments/application/ingest-provider-event.integration.test.ts src/payments/http/provider-webhook.test.ts`

Expected: FAIL because the signed ingress/inbox handler does not exist.

- [ ] **Step 3: Implement verify-first durable ingestion**

Verify signature/timestamp through the selected adapter before trusting IDs/state. Insert inbox identity once, resolve the application intent by provider reference, conditionally transition canonical Payment using the current stored version, and write the reaction in the same D1 batch as the successful transition. On CAS conflict, mark `RETRY_REQUIRED`; on missing/ambiguous mapping, create a reconciliation case. Do not accept an `expectedVersion` field from the payload.

- [ ] **Step 4: Run duplicate/concurrency tests repeatedly**

Run: `1..3 | ForEach-Object { pnpm --filter @freshmarkets/core exec vitest run --config vitest.config.ts src/payments/application/ingest-provider-event.integration.test.ts }`

Expected: every run passes; one inbox row and one reaction exist for duplicate delivery.

- [ ] **Step 5: Commit provider ingress**

Run: `git add apps/core/src/payments apps/core/src/index.ts && git commit -m "feat(payments): ingest provider events idempotently"`

## Task 5: Reconciliation and non-synthetic refund lifecycle

**Files:**
- Create: `apps/core/src/payments/application/reconcile-payment.ts`
- Create: `apps/core/src/payments/application/request-refund.ts`
- Test: `apps/core/src/payments/application/reconciliation.integration.test.ts`
- Test: `apps/core/src/payments/application/refund.integration.test.ts`
- Modify: `apps/core/src/payments/infrastructure/d1/payment-repository.ts`
- Modify: `packages/contracts/src/payments.ts`
- Modify: `packages/contracts/src/core-service.ts`

**Interfaces:**
- Consumes: `ReconcilePaymentCommand { paymentIntentId, idempotencyKey, actorId, requestId }`
- Consumes: `RequestRefundCommand { paymentIntentId, amountMinor, reason, idempotencyKey, actorId, requestId }`
- Produces: canonical `RefundView` with `REQUESTED | APPROVED | PROCESSING | SUCCEEDED | REJECTED | FAILED | ESCALATED`
- Guarantees: only verified provider observation or provider lookup can produce `SUCCEEDED`

- [ ] **Step 1: Write failing reconciliation/refund tests**

Cover lost webhook recovered by provider lookup, duplicate reconciliation, refund amount above captured amount, duplicate refund request, provider request failure, and verified refund event transition to `SUCCEEDED`. Assert the initial refund command never writes `SUCCEEDED`.

- [ ] **Step 2: Run focused tests and prove failure**

Run: `pnpm --filter @freshmarkets/core exec vitest run --config vitest.config.ts src/payments/application/reconciliation.integration.test.ts src/payments/application/refund.integration.test.ts`

Expected: FAIL because reconciliation/refund applications do not exist.

- [ ] **Step 3: Implement explicit lifecycle**

Create refund identity before provider side effect; transition to `PROCESSING` after accepted provider request. Apply `SUCCEEDED` only from verified event/reconciliation observation. On ambiguous failure, record reconciliation required rather than retrying with a new identity.

- [ ] **Step 4: Run focused tests and source scan**

Run: `pnpm --filter @freshmarkets/core exec vitest run --config vitest.config.ts src/payments/application/reconciliation.integration.test.ts src/payments/application/refund.integration.test.ts && rg -n "refund.*SUCCEEDED|status='SUCCEEDED'" apps/core/src`

Expected: tests pass; any success write is inside verified provider-event/reconciliation application code, never a generic order command.

- [ ] **Step 5: Commit reconciliation/refunds**

Run: `git add apps/core/src/payments packages/contracts/src/payments.ts packages/contracts/src/core-service.ts && git commit -m "feat(payments): reconcile payments and refunds"`

## Final Acceptance Gate

- [ ] Run: `pnpm --filter @freshmarkets/core test && pnpm --filter @freshmarkets/contracts test`
- [ ] Run: `pnpm typecheck && pnpm lint && pnpm format:check`
- [ ] Run: `pnpm naming:check && pnpm -r build`
- [ ] Apply migrations `0001`–`0016` from a fresh database.
- [ ] Run: `rg -n "expectedVersion" apps/core/src/payments packages/contracts/src/payments.ts`
- [ ] Confirm provider-event DTOs/handlers have no `expectedVersion`; client/admin reconciliation commands may have stable idempotency but load payment version internally.
- [ ] Confirm no fake adapter can register outside test and no Membership/Order type contains provider status/reference fields.
- [ ] Confirm `git status --short` lists only files declared above.

**Acceptance criteria:** Payments has one canonical owner; provider events are signed/deduplicated; canonical transitions are CAS-protected; sufficient outcomes create one durable explicit reaction; refunds cannot be synthesized; reconciliation exposes ambiguity; production-provider selection remains the only adapter-specific blocker.
