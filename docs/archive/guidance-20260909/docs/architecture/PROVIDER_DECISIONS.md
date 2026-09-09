# Provider Decisions

Status: TARGET PROVIDER POLICY APPROVED; CAPABILITIES AND PAYLOADS MUST BE REVERIFIED DURING THEIR IMPLEMENTATION PHASES (2026-09-05).

Provider-specific code remains infrastructure behind Core-owned ports. Domain contracts use
canonical payment, external-delivery, and notification vocabulary only.

## Delivery

Lalamove v3 is the first activation target for Cebu external delivery and the initial Scheduled checkout-pricing provider. Core uses direct Worker
`fetch` and Web Crypto rather than the provider's older Node SDK. Every call is HMAC-SHA256 signed
over the exact documented timestamp/method/path/body form; API credentials stay in Core secrets.
The adapter quotes immediately before order creation, forwards returned stop IDs and required
contact/instruction data, converts provider price strings to integer currency minor units, and
quarantines any ambiguous mutating outcome. Signed webhook status observations are deduplicated by
Lalamove `eventId` and cannot regress a newer observation.

FreshMarkets omits Lalamove `item` objects, dimensions, thermal-bag requests, perishable,
temperature-sensitive, and keep-dry metadata. The internal `BAG`/`BOX` classification is not sent.
Customer destination instructions may be combined into labeled recipient remarks only when no
separate documented field exists; store pickup instructions never enter recipient remarks.
FreshMarkets requests no COD/autodeduct, purchase service, channel-partner attribution, or
single-drop route optimization. The accepted customer delivery charge and final Lalamove payable
are separate immutable facts; FreshMarkets absorbs increases and retains decreases.

`DELIVERY_PROVIDERS` is the ordered closed registry for customer-visible Instant partners;
`DELIVERY_PROVIDER` remains a temporary single-provider compatibility selector. Instant customers
select an opaque option that binds one enabled external provider/service. Scheduled customers never
select a courier: Lalamove supplies the checkout quotation and store operations later choose an
enabled external adapter plus immediate or supported scheduled pickup. Move It is not in the registry because no public developer API contract has
been verified. GrabExpress remains implemented but disabled pending provider access for Cebu.

Production Lalamove activation requires the PH/Cebu service key to be confirmed from authenticated
`GET /v3/cities`, a funded production wallet and production credentials, sender/contact readiness,
resolvable Order weight, exact webhook registration, and sandbox/live acceptance. Source-controlled
configuration must never be treated as evidence that these operational gates passed.

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

Application runtimes use PayMongo sandbox credentials during development and expose no mock provider,
simulation RPC, route, or page. Deterministic fakes remain test-only. Production deployment remains fail-closed until the PayMongo account's Subscriptions
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

## Customer delivery pricing

Customer delivery pricing comes from the selected enabled external courier's verified quotation,
never an internal per-kilometer or route-distance fee formula. Mapbox routing may support unrelated
presentation or diagnostic needs but is not a Quote price authority and never selects the owning
store. Provider capability, quotation, booking, status, cancel, and webhook behavior must be
reverified against official Lalamove and Grab documentation during their implementation phases.
