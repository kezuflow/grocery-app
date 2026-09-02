# Provider Decisions

Status: PAYMONGO ADAPTER IMPLEMENTED; LIVE ACCOUNT ACCEPTANCE PENDING (2026-09-03).

Provider-specific code remains infrastructure behind Core-owned ports. Domain contracts use
canonical payment, route-calculation, and notification vocabulary only.

## Payments

PayMongo Scheduled Subscriptions is the owner-approved recurring-membership direction. A PayMongo
scheduled Plan must exactly match the FreshMarkets Membership price-version amount, PHP currency,
monthly interval, and interval count. Ordinary price changes create a new Plan for new enrollments;
existing paid Subscriptions retain their agreed Plan unless a separately authorized migration is
performed. PayMongo owns invoice generation and charge retries. FreshMarkets never runs a parallel
dunning or renewal-payment retry schedule.

Core registers the production PayMongo adapter when `PAYMENT_PROVIDER=paymongo` and both
`PAYMONGO_SECRET_KEY` and `PAYMONGO_WEBHOOK_SECRET` are present. Test keys are required outside
production and a live key is required in production. The adapter creates Payment Intents, refunds,
Customers, immutable scheduled monthly Plans, and Subscriptions; verifies PayMongo's `te`/`li`
HMAC over the exact raw body; maps payment, refund, subscription, and invoice events; and retrieves
provider subscription truth every fifteen minutes to recover missed delivery. Cloudflare stores
the keys as Worker secrets. Web receives only the matching browser-safe `PAYMONGO_PUBLIC_KEY`;
card data is tokenized directly against PayMongo and never crosses Core or Web server code.

The deterministic `mock` provider remains restricted to explicit `development` and `test`
environments. Production deployment remains fail-closed until the PayMongo account's Subscriptions
and card capabilities are enabled, live credentials and the public webhook endpoint are configured,
and live-mode initial payment, renewal, recovery, exhausted-retry, cancellation, refund, webhook
replay, and reconciliation acceptance has passed.

Every signature-verified webhook is retained exactly once with its bounded raw body, payload hash,
provider event identity/type, signature-verification time, processing attempts, final status, and
reconciliation evidence. Invalid-signature requests are not trusted provider events. Secret keys,
authorization headers, and raw payloads are forbidden from diagnostic logs and ordinary Admin DTOs.

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
