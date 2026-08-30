# Customer MVP Completion Report

**Repository:** FreshMarkets  
**Completion date:** 2026-08-31  
**Scope:** Customer MVP and shared Core/Web/contracts only; Admin Dashboard and Maps implementations excluded and preserved

## Outcome

The approved thirteen-slice Customer MVP program is implemented on top of the architecture/security remediation baseline. The customer path now has Core-owned Membership state, Promotion-aware accepted Quotes, provider-confirmed Order commitment, immutable Order follow-up, current-state reorder, typed issue intake, explicit pre-commit abandonment, paid additive Scheduled amendments, durable notification intent, invoice-readiness evidence, and opaque Instant/Scheduled fulfillment selection.

This is local implementation readiness, not production go-live approval. Payment, transactional email, BIR/accounting, and committed-cancellation policies remain external owner/provider gates and fail closed where absent.

## Implemented work

- Membership: one composed customer experience over the paid PHP 299 calendar-month offer, introductory trial authority, recurring authorization readiness, subscription summary, and legal lifecycle actions.
- Promotions: closed rule vocabulary, segment/target eligibility, deterministic selection of at most one merchandise benefit plus one delivery benefit, Quote claims, and commit-time exact-once redemption/application history.
- Checkout: exact monetary components, explicit Promotion feedback, customer acceptance version, idempotent abandonment, and opaque Core-routed fulfillment options bound to confirmed address/cart versions.
- Orders: ownership-scoped immutable detail, privacy-safe multi-context timeline, current-state reorder with skipped reasons, typed issue intake without refund authority, and fail-closed customer cancellation.
- Amendments: one active additive Scheduled-before-cutoff draft, current pricing/availability, dedicated `ORDER_AMENDMENT` Payment intent, and provider-confirmed commitment without mutating the original Order.
- Notifications: closed launch event vocabulary, escaped text/HTML templates, durable outbox/attempts, leases, bounded retry/terminal failure, domain projection, scheduled redrive, and a Cloudflare Send Email binding adapter.
- Invoice readiness: atomic commitment evidence with buyer and exact financial snapshots, internal readiness states, and a customer-safe availability projection without unapproved tax computation or issuance.
- Web: thin same-origin routes and accessible customer Membership, checkout, Order detail/timeline, reorder, issue, abandonment, amendment, and fulfillment-option experiences.

## Persistence and contracts

The only Customer MVP migration is `apps/core/migrations/0047_customer_mvp_completion.sql`. It is additive over the integrated Admin/Maps schema and owns Promotion rules/claims, Order follow-up additions, notification outbox/attempts, and invoice readiness. Fulfillment-mode authority remains explicitly configured through its owning command; unconfigured locations fail closed. Protected Admin/Maps migrations `0041`–`0043` were not edited.

Shared contracts add `MembershipExperienceView`, Promotion Quote feedback/applications, `FulfillmentOptionView`, customer Order detail/timeline/actions, reorder results, customer issue DTOs, amendment draft/payment requests, abandonment results, notification state, and invoice availability. Every customer method derives ownership from the Better Auth session; no customer/location/provider identity is accepted as authority.

## Verification evidence

Focused verification completed during implementation:

- Membership, Promotions, Quote/commit, Order detail, reorder, issues, abandonment, amendments, notification, invoice-readiness, and fulfillment-option Core integration suites passed.
- Contracts and all affected Web route/component suites passed.
- Managed vinext/Workers Playwright passed Promotion checkout, opaque fulfillment selection with Quote invalidation, and the consolidated Membership/post-commit customer journey.
- The browser journey exposed and verified the fix for vinext dynamic customer Order route parameters (`useParams` rather than an undefined client `params` prop).
- Migration verification passes fresh and populated upgrade paths, including `0046 -> 0047`.

Final repository-wide completion gate:

- format, naming, architecture, readiness, migration, catalog, lint, typecheck, frozen install, Core/Web builds, vinext compatibility, dependency audit, and diff checks all pass;
- vinext reports 100% compatibility: 14 supported checks, no partial support, and no issues;
- Vitest passes 1,348 tests across 232 files: Config 2, Domain Shared 2, Validation 2, Contracts 67, Web 486, and Core 789;
- the complete managed Playwright inventory passes 82 tests with the one established Rider empty-state skip;
- dependency audit reports no known vulnerabilities.

## Deliberate limitations and risks

1. Production grocery/recurring payment provider selection, credentials, webhook mapping, refund operations, renewal ownership, and staging acceptance remain unapproved.
2. The notification scheduler, retry model, and Cloudflare Send Email adapter are complete. Deployment still requires `AUTH_EMAIL_FROM` on an onboarded sender domain; the current Cloudflare account listing does not establish a FreshMarkets-branded sender domain. Missing configuration/provider failure stays in durable retry and never changes business outcomes.
3. Invoice readiness is not official invoice issuance. Seller/taxpayer facts, BIR classification, serial allocation, retention, and electronic-invoice integration require owner-approved policy.
4. Committed grocery-order cancellation remains unavailable to customers. Internal/Admin cancellation does not grant customer authority; an approved refund/cutoff/mode policy is required first.
5. The existing Scheduled-only `evaluateCheckout` RPC remains a deprecated compatibility read. Current Web uses `listFulfillmentOptions` and authoritative `createCheckoutQuote`; no customer UI submits a cycle as routing authority.
6. The vinext build continues to report its existing large-chunk advisory. It is not a failed compatibility/build gate, but bundle splitting should be measured in a dedicated Web performance pass.
7. Browser acceptance uses deterministic Web route fixtures for provider-dependent customer continuations, while Core Worker integration tests prove the D1/payment-reaction/outbox/invoice consequences. Production-provider acceptance is still required.
8. Managed Playwright isolates an upstream Wrangler 4.114+ local-proxy restart regression by using the 4.113 controller with the current workerd compatibility-date binary and patched `sharp`/`undici` transitive versions. Production and build tooling remain on Wrangler 4.125.0; remove the E2E alias after Cloudflare closes the upstream regression.

## What the next phase can rely on

- Core remains the only business and D1 authority behind a typed Service Binding.
- Customer selection is an opaque, version-bound fulfillment option; no hub/location authority leaks into Web.
- Paid commitment and amendment commitment require canonical successful Payment outcomes and are replay-safe.
- Order commercial/fulfillment history is immutable; follow-up uses additive records and current-state commands.
- Notification and invoice-readiness seams are durable and independent from source outcomes.
- Production deployment can focus on provider/policy onboarding, operational runbooks, load/performance measurement, and external acceptance rather than redesigning the customer domain spine.
