# PayMongo Setup and Acceptance Runbook

The repository contains the production adapter, but no live-money claim is valid until this runbook
has been completed against the owner-approved PayMongo account.

## Account capabilities

Ask PayMongo to enable Scheduled Subscriptions and card payments/card vaulting for the account.
The current FreshMarkets browser flow accepts cards. Maya subscription support can be added only
after its customer flow is separately implemented and accepted; do not enable a method merely
because the account exposes it.

## Runtime configuration

For local test-mode development, keep Core's source-controlled default on `mock` and place the
test credentials and `LOCAL_PAYMENT_PROVIDER=paymongo` in the Git-ignored `apps/core/.dev.vars`. Put only
browser-safe public keys in Web's local Worker variables, then start the stack with
`pnpm dev:stack`. This runs real PayMongo test-sandbox API calls, so test Customers, Plans,
Subscriptions, Payments, and Refunds appear in the PayMongo test dashboard. Automated Core tests
override the provider back to `mock` and never call PayMongo.

Until a webhook endpoint has been registered, use the explicit `local-webhook-not-configured`
sentinel for `PAYMONGO_WEBHOOK_SECRET`; it permits outbound test API calls but cannot verify inbound
events. Replace it with the webhook's real test signing secret before webhook acceptance testing.

For direct Core webhook/tunnel testing, start `pnpm dev:core`; Core listens on Wrangler's local port
and can then be exposed through a temporary HTTPS tunnel.

The repository also defines isolated `staging` Worker environments. Staging deploys Web and Core
as `freshmarkets-web-staging` and `freshmarkets-core-staging`; Web binds to Core and Core owns the
staging D1 database, product-media bucket, scheduled jobs, and PayMongo webhook. Web is served from
the `freshmarkets.ph` Custom Domain while the Core `workers.dev` URL remains the PayMongo test
webhook endpoint. Do not reuse unrelated Workers, Pages projects, databases, buckets, tunnels, or
custom domains from the account.

Set `PAYMENT_PROVIDER=paymongo` in the deployed Core environment. Add the server credentials
interactively as Cloudflare Worker secrets from `apps/core`; never put their values in source,
command history, tickets, or logs:

```text
pnpm exec wrangler secret put PAYMONGO_SECRET_KEY --config wrangler.jsonc --env <environment>
pnpm exec wrangler secret put PAYMONGO_WEBHOOK_SECRET --config wrangler.jsonc --env <environment>
```

Use `sk_test_` outside production and `sk_live_` in production. Core rejects a key whose mode does
not match the runtime environment. Configure Web's browser-safe `PAYMONGO_PUBLIC_KEY` with the
matching `pk_test_` or `pk_live_` value. The public key may reach the browser; the secret and
webhook keys must never do so.

## Webhook endpoint

Register the public Core URL ending in `/webhooks/payments/paymongo`. Subscribe to:

- `payment.paid`
- `payment.failed`
- `payment.refunded`
- `payment.refund.updated`
- `subscription.activated`
- `subscription.past_due`
- `subscription.unpaid`
- `subscription.updated`
- `subscription.invoice.created`
- `subscription.invoice.finalized`
- `subscription.invoice.paid`
- `subscription.invoice.payment_failed`
- `subscription.invoice.updated`

Copy the endpoint's signing secret into `PAYMONGO_WEBHOOK_SECRET`. Core verifies the `te` signature
for test keys or `li` for live keys, enforces a five-minute timestamp tolerance, hashes the exact
raw request body, retains every verified delivery, and deduplicates business processing by provider
event ID. Invalid signatures create neither receipt nor inbox evidence.

## Acceptance

Complete all cases in test mode, then repeat a controlled live smoke test:

1. One-time order card payment, 3DS return, signed success, and exactly-once order commitment.
2. Full and partial refund with signed refund observation and settlement reconciliation.
3. New paid membership: Customer, exact-price monthly Plan, Subscription, first invoice, 3DS, and
   signed `active` transition.
4. Renewal success without any FreshMarkets charge attempt.
5. Renewal failure to `past_due`, provider retry recovery to `active`, and exhausted retries to
   non-entitled `unpaid`.
6. Immediate cancellation and period-end cancellation. PayMongo cancellation is immediate when
   invoked; FreshMarkets delays that API call until the requested effective period end. Confirm any
   already-open invoice behavior with Finance because PayMongo documents it as still collectible.
7. Duplicate delivery, out-of-order delivery, temporary endpoint outage, inbox redrive, and
   provider-state reconciliation after a missed event.
8. Secret rotation and signature-mode verification without exposing raw payloads or credentials.

If any provider outcome is ambiguous, keep the local aggregate pending and resolve the visible
reconciliation case. Never create a second charge under a new idempotency key merely because the
first response was lost.
