# Program 4 — Payment Provider Readiness

Status: SUPERSEDED BY MOCK-MVP DECISION (owner reconciliation 2026-08-27).

The deterministic `mock` adapter is the only approved provider. It lives behind the
provider-neutral Payments port and supports deterministic payment success, failure, expiry, signed
event/reaction, reconciliation, authorization, and refund simulations. Runtime selection is
explicit (`PAYMENT_PROVIDER=mock`) and only `development`/`test` may register it.

Acceptance for the mock-MVP slice requires:

- Web → Core payment creation uses the populated runtime registry;
- duplicate commands/events cannot duplicate canonical payments or orders;
- paid-but-uncommitted reactions retry the same idempotent order commitment and escalate bounded
  failure without inventing an automatic refund;
- webhook signatures and provider-event identity are verified and deduplicated;
- missing/unsupported provider configuration and mock usage outside allowed environments fail
  closed;
- repository docs make no production-payment or production-recurring readiness claim.

Production provider selection and integration are separate future owner decisions. This spec does
not reserve a vendor, retry policy, webhook scheme, instrument capability, or go-live configuration.
