# Program 3 — Renewal / Trial Conversion / Dunning

Status: SUPERSEDED / OPEN (owner reconciliation 2026-08-27).

The existing implementation supplies provider-neutral membership states, recurring-authorization
records, calendar helpers, payment-purpose routing, idempotency, and mock-tested scheduler seams.
Those foundations may be retained.

No production recurring mandate or automatic renewal charge is approved or implemented. There is
no selected provider retry owner, production instrument matrix, live authorization semantics, or
approved automatic-refund behavior. Consequently this program is not complete and must not be
described as blocked only on external configuration.

Before resuming this program, obtain owner approval for:

1. the production payment provider and supported recurring instruments;
2. setup-without-payment/mandate semantics for the introductory trial;
3. provider-versus-application retry ownership and observable retry schedule;
4. reconciliation and manual/automatic refund policy for ambiguous or downstream failures;
5. membership-cancellation customer UX and effective timing.

Until then, production environments fail closed and automated tests use the explicit deterministic
`mock` provider. Mock success proves state-machine behavior only, not production billing readiness.
