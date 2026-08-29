# Provider Webhook Replay Runbook

## Prerequisites

- Obtain the provider event identity from the provider dashboard and the
  affected payment/order identifiers from Core's purpose-built read models.
- Use the provider's signed replay facility or approved operator tooling; do
  not paste signed payloads or credentials into tickets or source files.

## Procedure

1. Check the payment and inbox/event history in Admin Payments and capture the
   request reference for the investigation.
2. Confirm the event is not already recorded as processed. Provider event
   identity is `(provider, providerEventId)`; duplicate delivery must be safe.
3. Request a replay through the provider's dashboard or approved support
   channel to the configured Core path `/webhooks/payments/<provider>`.
4. Confirm Core's structured response and inspect the payment reconciliation
   read model. A browser return or payment initiation is not payment success.
5. If the payment remains stuck, allow the scheduled reconciliation/redrive
   job to handle it and use `FAILED_JOB_RUNBOOK.md` for an exhausted run.
6. Record the outcome, event identity, UTC time, and request reference without
   storing provider payloads or secrets.
