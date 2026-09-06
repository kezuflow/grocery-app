# Notification Queues Runbook

Cloudflare Queues transports notification work only. D1 `notification_outbox` is the transactional
source of intent; Queue messages contain only `{ "outboxId": "..." }`. The consumer must not mutate
Orders, Payments, Memberships, Fulfillment, or Delivery state.

## Provisioning

Create the configured source and dead-letter queues before deploying each environment:

```powershell
pnpm --filter @freshmarkets/core exec wrangler queues create freshmarkets-notifications-dev
pnpm --filter @freshmarkets/core exec wrangler queues create freshmarkets-notifications-dlq-dev
pnpm --filter @freshmarkets/core exec wrangler queues create freshmarkets-notifications-staging
pnpm --filter @freshmarkets/core exec wrangler queues create freshmarkets-notifications-dlq-staging
```

`wrangler.jsonc` binds `NOTIFICATION_QUEUE`, registers this Worker as the consumer, caps batches at
10, retries five times, and routes exhausted messages to the environment-specific DLQ. Queue names
must never be shared across development, staging, and production.

## Normal operation

The every-minute scheduled job projects domain facts into D1, conditionally leases due unpublished
rows, and publishes stable outbox identities. A successful publish records transport evidence and
clears the publication lease. The consumer conditionally claims the notification, renders the
approved template, writes attempt evidence, sends through Cloudflare Email Service, and then marks
the outbox row sent.

Each message is handled in its own `try/catch` and explicitly acknowledged or retried. Duplicate
delivery after a completed send is acknowledged without calling the email provider again.

## Recovery and incidents

- `FAILED` publication rows and expired `PUBLISHING` leases are recovered by the next scheduled run.
- A send-provider rejection uses bounded backoff. After the fifth attempt, D1 and the Queue/DLQ retain
  the terminal evidence for operations.
- If an attempt is still `PROCESSING` after its lease, the send outcome is unknown. Core records
  `SEND_OUTCOME_UNKNOWN` and acknowledges the message rather than risking a duplicate customer email.
- A Queue publish failure never rolls back or changes the source domain event. Repair the binding or
  Queue service, then let scheduled recovery republish the same outbox identity.
- Inspect DLQ messages and their matching D1 outbox/attempt rows together. Do not replay raw payloads
  or edit domain rows manually.

Before activation, run the Core notification Queue integration tests and a Wrangler dry-run. In
staging, verify one success, one transient retry, one duplicate delivery, and one exhausted message
visible in the DLQ before enabling customer traffic.
