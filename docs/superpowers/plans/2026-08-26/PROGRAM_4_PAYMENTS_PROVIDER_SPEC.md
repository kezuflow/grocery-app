# Program 4 — Production Payment Provider Readiness: Spec & Plan

Status: SELF-REVIEWED (2026-08-26). Implements the recorded PayMongo selection
(`PROVIDER_DECISIONS.md`) behind the existing `ports/payment-provider.ts` abstraction. No
canonical domain change; vendor vocabulary never leaves the adapter.

## Design

### Runtime registration (`payments/infrastructure/providers/runtime-providers.ts`)

`buildProviderRegistry(env)` becomes the single construction point used by the entrypoint
fetch/webhook path and the scheduling context: it registers `PayMongoProvider` when
`PAYMONGO_SECRET_KEY` is configured (plus `PAYMONGO_WEBHOOK_SECRET_TEST` / `_LIVE`), keeps the
fake provider test-only, and returns an empty registry otherwise so every path fails closed with
the existing `PAYMENT_PROVIDER_UNCONFIGURED` behavior.

### PayMongoProvider (`payments/infrastructure/providers/paymongo-provider.ts`)

Implements `code: "paymongo"` over plain `fetch`:

- `createPayment` — `POST /v1/checkout_sessions` (one redirect flow covering cards, GCash,
  Maya): amount/currency passthrough, `reference_number` derived from our idempotency key,
  `Idempotency-Key` header sent, success maps to `{actionType:"REDIRECT", redirectUrl}` from
  `checkout_url`. Never returns canonical success.
- `verifyAndParseEvent` — parses `Paymongo-Signature` (`t`, `te`, `li`), computes
  HMAC-SHA256 over `{t}.{rawBody}` with Web Crypto against the environment-matching secret,
  timing-safe compare, replay-window check on `t`; then maps event types
  (`payment.paid|failed|expired`, `refund.paid|failed`) into `VerifiedProviderEvent`
  (kind payment/refund, canonical state, amount, currency, references, payload hash).
  Failures return the port's typed reasons only.
- `getPayment` — `GET /v1/payments/{id}` mapped to `ProviderPaymentView`
  (`paid→SUCCEEDED`, `failed→FAILED`, `awaiting/expired→PROCESSING/EXPIRED`…).
- `requestRefund` — `POST /v1/refunds` with `Idempotency-Key`; returns the provider refund
  reference; only provider observation ever marks refund success downstream.

Errors map to stable `errorCode`s (`PROVIDER_HTTP_*`, `PROVIDER_REJECTED`); raw bodies are never
logged or persisted.

### Recurring authorization boundary

The mandate-establishment flow for trial signups (D2) stays OUT of this program: PayMongo's
Card-Vaulting/setup semantics require written vendor confirmation (recorded external blocker).
Program 3 owns the authorization port shape when it implements enrollment consumption; building
it now would guess the contract. Ruling recorded per autonomy policy item 6.

## Plan

- Slice 1 (single architectural slice): adapter + runtime registration + entrypoint/scheduler
  switch to `buildProviderRegistry` + wrangler/config documentation (secrets via
  `wrangler secret put`; no values in source) + tests:
  - signature accept/reject/tamper/stale-timestamp;
  - event-type mapping incl. refund kind and unknown-type rejection;
  - createPayment/getPayment/requestRefund against stubbed `fetch`: auth header, idempotency
    forwarding, response mapping, HTTP-failure mapping;
  - registry: configured → `paymongo` resolvable; unconfigured → fail-closed unchanged;
  - existing suites stay green (fake provider untouched, sandbox policy unaffected).
- Verification: targeted tests + full `pnpm check` + `check:vinext` (webhook route untouched but
  entrypoint composition changes) + `git diff --check`.

## External go-live blockers recorded (not code defects)

PayMongo account/KYC, feature enablement (Subscriptions + Card Vaulting), live/test keys,
webhook endpoint registration, written Maya/setup-intent confirmation.
