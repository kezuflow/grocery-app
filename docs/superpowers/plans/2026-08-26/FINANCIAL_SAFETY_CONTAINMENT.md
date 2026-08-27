# Financial Safety Containment

Status: SUPERSEDED BY PROVIDER-NEUTRAL PAYMENT REACTIONS (2026-08-27).

The former synthetic checkout compatibility path and its Web runtime toggle are removed. Current
containment rules are:

- `PAYMENT_PROVIDER=mock` must be selected explicitly;
- `mock` registers only in `development` and `test`, and every other environment fails closed;
- canonical payment success originates only from a verified provider event;
- payment observations, attempts, reactions, and one-order-per-payment identity are durable;
- duplicate commands/events/redrives cannot create duplicate payments or orders;
- paid-but-uncommitted reactions retry the same commitment and create a reconciliation case after
  bounded failure;
- refund success is never synthesized, and no automatic production refund policy is inferred;
- customer grocery cancellation is absent from the mock-payment MVP.

Acceptance is demonstrated by provider-policy, signed-event, reaction-redrive, refund,
financial-safety, Web payment route, and end-to-end commerce-flow tests. Production payment and
recurring-billing readiness remain open owner decisions.
