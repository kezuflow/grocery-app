# Provider Decisions

Status: OWNER-APPROVED RECONCILIATION (2026-08-27).

Provider-specific code remains infrastructure behind Core-owned ports. Domain contracts use
canonical payment, route-calculation, and notification vocabulary only.

## Payments

The deterministic `mock` provider is the only approved and registered payment provider. Selection
is explicit through `PAYMENT_PROVIDER=mock`; registry insertion order is never a selection rule.
The provider supports deterministic success, failure, expiry, signed event/reaction,
reconciliation, authorization, and refund simulations for automated tests. It is allowed only in
explicit `development` and `test` environments and fails closed everywhere else.

No production grocery or recurring payment provider is selected. Production recurring mandates,
automatic renewal charging, retry ownership, and provider-specific automatic refunds are not
implemented or approved. Membership state machines, authorization records, and scheduling seams
remain provider-neutral testable foundations; they are not production-operational claims.

A successful canonical payment observation is durable even if downstream order commitment fails.
Core retries the same idempotent commitment, cannot create a second payment or order, and escalates
bounded failures to a visible reconciliation exception. No automatic real-provider refund policy is
inferred.

## Transactional authentication email

Verification and password-reset email uses Cloudflare Email Service through Core's `EMAIL`
`send_email` binding and the existing auth-email delivery port. Web and domain code never receive
the binding. `AUTH_EMAIL_FROM` is deployment configuration with no source-controlled production
default. Missing binding or sender configuration fails closed. Tests inject fake delivery/binding
adapters, and logs contain neither recipient addresses nor bearer URLs.

External domain onboarding and sender provisioning remain deployment work and are intentionally
not configured by the repository.

## Route distance

Delivery pricing uses a provider-neutral Geography route-distance port. The approved Core-only
adapter calls Mapbox Directions with the stable `mapbox/driving` profile and reads
`routes[0].distance` in meters. `MAPBOX_ACCESS_TOKEN` is a Core secret. There is no browser token,
traffic-based profile, straight-line fallback, or fabricated fee.

Missing configuration, timeout, non-success HTTP response, `NoRoute`, empty routes, invalid
coordinates, and malformed responses fail checkout with stable application errors. Persisted quote
and order snapshots contain provider-neutral road-route/driving metadata, never vendor vocabulary.
