# Runtime and Persistence Reliability Remediation Implementation Plan

> **Required execution skills:** `superpowers:executing-plans`, `superpowers:test-driven-development`, `superpowers:systematic-debugging`, and `superpowers:verification-before-completion`.

**Goal:** Make the pre-0021 upgrade path data-preserving, deployed runtime configuration fail closed, cart writes concurrency-safe, provider-event retries durable, and repository readiness gates truthful.

**Architecture:** Keep Core as the sole owner of D1 writes and business policy. Historical migration repair preserves identifiers and rebuilds the full referenced table graph under deferred foreign-key checking. Runtime parsing produces one closed typed configuration. Cart and provider-inbox concurrency use D1 uniqueness/conditional claims rather than process memory. Scheduler jobs remain thin dispatchers into application commands.

**Constraints:** Do not change Admin dashboard or Maps surfaces. Do not introduce Queues, Workflows, Durable Objects, public APIs, or raw provider payload storage. Use integer money/quantities, stable idempotency, purpose-built DTOs, and current Cloudflare Worker/D1 capabilities already validated for this program.

---

## Task 1: True Populated Pre-0021 Upgrade Test

**Files:**
- Modify: `scripts/verify-migrations.mjs`
- Inspect: `apps/core/migrations/0016_payments_context.sql` through `0021_instant_mode.sql`

1. Move the representative Scheduled commerce-graph seed boundary from after `0021` to after `0020`.
2. Seed every material parent/child dependency that existed before `0021`: checkout attempt/quote, payment attempt/link, order/items, fulfillment snapshot/record, delivery job, reservation/demand, amendment/refund/exception where schema permits.
3. Snapshot row counts plus identifiers, money, quantities, states, versions, timestamps, and JSON before the upgrade.
4. Run the script and observe failure in `0021_instant_mode.sql` or foreign-key/data checks.
5. Commit only after the test truthfully proves the old migration is unsafe.

Run: `pnpm migration:check`

## Task 2: Repair the Historical 0021 Dependency Graph

**Files:**
- Modify: `apps/core/migrations/0021_instant_mode.sql`
- Modify: `scripts/verify-migrations.mjs`
- Modify: `apps/core/src/checkout/infrastructure/checkout-schema.integration.test.ts`

1. Enumerate inbound/outbound foreign keys for every rebuilt parent.
2. Rebuild affected parent and child tables to their final 0021 schema with deferred foreign-key checking; never drop a referenced parent while a legacy child still points to it.
3. Copy every legacy row without transforming business data beyond the required `fulfillment_mode='SCHEDULED'` projection and new nullable fields.
4. Swap in dependency-safe order; restore all final 0021 indexes/unique constraints.
5. Assert pre/post snapshots are identical, all required indexes exist, and `PRAGMA foreign_key_check` is empty.
6. Add independent populated boundaries for each later table rebuild and make the success message name the exact boundaries.

Run: `pnpm migration:check`

Expected: fresh and true populated pre-0021 upgrades pass with no missing rows or foreign-key violations.

## Task 3: Closed Runtime Configuration

**Files:**
- Create: `apps/core/src/runtime/runtime-configuration.ts`
- Create: `apps/core/src/runtime/runtime-configuration.test.ts`
- Create: `apps/web/lib/runtime/runtime-configuration.ts`
- Create: `apps/web/lib/runtime/runtime-configuration.test.ts`
- Modify: `apps/core/src/auth/service.ts`
- Modify: `apps/core/src/auth/origins.ts`
- Modify: `apps/core/src/payments/mock-policy.ts`
- Modify: `apps/core/src/payments/infrastructure/providers/runtime-providers.ts`
- Modify: `apps/core/src/geography/infrastructure/runtime-route-distance.ts`
- Modify: `apps/core/src/index.ts`
- Modify: `apps/web/lib/auth/proxy.ts`

1. Add RED tests for all five allowed environments plus empty/unknown/`prod`, deployed loopback/HTTP origins, missing/weak secret, partial Google OAuth, mock-provider leakage, and secure-cookie requirements.
2. Implement a closed `RuntimeEnvironment` parser. Omission defaults only through an explicit local-default option.
3. Produce a typed Core readiness/config object once at composition and pass its decisions to Auth, Payments, Geography, Email, and renewal scheduling.
4. Require HTTPS/non-loopback public/auth/trusted origins and secure cookies in preview/staging/production.
5. Require OAuth client ID/secret as a pair; expose readiness booleans/error codes without secret values.
6. Add equivalent Web public-origin/environment parsing and remove silent deployed downgrade paths.

Run: `pnpm --filter @freshmarkets/core test -- src/runtime src/auth src/payments/mock-policy.test.ts src/payments/infrastructure/providers/runtime-providers.test.ts src/geography/infrastructure/runtime-route-distance.test.ts`

Run: `pnpm --filter @freshmarkets/web test -- lib/runtime lib/auth/proxy.test.ts`

## Task 4: Active-Cart Database Invariant and Reconciliation

**Files:**
- Create: `apps/core/migrations/0046_cart_and_inbox_reliability.sql` (final integrated number after Maps claimed `0043` and the two financial migrations shifted to `0044`/`0045`)
- Create: `apps/core/src/checkout/infrastructure/cart-reliability-migration.integration.test.ts`
- Modify: `docs/architecture/DATA_MODEL.md`

1. Add RED migration tests proving duplicate active carts are currently possible.
2. Reconcile duplicates deterministically: newest cart wins; merge item quantities from authoritative newest evidence where available; otherwise the winning cart's value wins; older carts become `SUPERSEDED`.
3. Record a safe reconciliation event without customer payloads.
4. Add a partial unique index on one `ACTIVE` cart per customer.
5. Extend the same migration with provider-inbox normalized-observation and lease columns required by Task 6.

Run: `pnpm --filter @freshmarkets/core test -- cart-reliability-migration.integration.test.ts`

Run: `pnpm migration:check`

## Task 5: Versioned Idempotent Cart Aggregate

**Files:**
- Modify: `packages/contracts/src/index.ts`
- Modify: `packages/contracts/src/checkout.test.ts`
- Modify: `apps/core/src/checkout/application/cart.ts`
- Create: `apps/core/src/checkout/application/cart.integration.test.ts`
- Modify: `apps/core/src/index.ts`
- Modify: `apps/web/app/api/commerce/cart/route.ts`
- Modify: `apps/web/lib/storefront/cart-client.ts`
- Modify: `apps/web/components/storefront/marketplace/cart-drawer.tsx`
- Modify: `apps/web/app/cart/page.tsx`

1. Add RED Worker-local tests for concurrent first touch, stale versions, identical replay, conflicting key reuse, zero-quantity removal, inactive SKU/product, unavailable location, missing/expired price, and location price precedence.
2. Change `SetCartItemRequest` to require `cartId`, `expectedVersion`, and `idempotencyKey`.
3. Provision first-touch carts with `INSERT ... ON CONFLICT` against the partial active-cart index, then select the winner.
4. Claim request idempotency and perform item mutation plus version CAS in one transactional batch; a lost CAS leaves no item mutation.
5. Replace zero-price fallback with nullable price plus `AVAILABLE|UNAVAILABLE|PRICE_UNAVAILABLE`; expose `checkoutBlocked` and stable reasons.
6. Update Web callers and rendering so unavailable lines remain removable and never display `₱0.00`.

Run: `pnpm --filter @freshmarkets/core test -- cart.integration.test.ts commerce-flow.integration.test.ts`

Run: `pnpm --filter @freshmarkets/web test -- app/api/commerce/cart lib/storefront/cart-client.test.ts`

## Task 6: Durable Normalized Provider-Inbox Leases

**Files:**
- Modify: `apps/core/src/payments/ports/payment-provider.ts`
- Modify: `apps/core/src/payments/infrastructure/d1/payment-repository.ts`
- Modify: `apps/core/src/payments/application/ingest-provider-event.ts`
- Create: `apps/core/src/payments/application/redrive-provider-inbox.ts`
- Create: `apps/core/src/payments/application/provider-inbox-reliability.integration.test.ts`
- Modify: provider adapters/tests under `apps/core/src/payments/infrastructure/providers/`

1. Add RED tests for same-event transient failure then redelivery, scheduler-only recovery, expired lease recovery, competing workers, payload mismatch, refund CAS recovery, and age/attempt escalation.
2. Persist a bounded normalized provider-neutral observation JSON plus payload hash; never persist raw request bodies.
3. Implement one conditional lease claim for `RECEIVED` and due `RETRY_REQUIRED` rows, including owner/expiry and bounded exponential availability.
4. Make redelivery and scheduler use the same lease/application command.
5. Classify `APPLIED`, `DUPLICATE`, `RETRY_REQUIRED`, `REJECTED`, and `RECONCILIATION_REQUIRED`; escalation opens one reconciliation case.
6. Verify payment/refund transitions, reactions, and totals remain idempotent under repeated leases.

Run: `pnpm --filter @freshmarkets/core test -- provider-inbox-reliability.integration.test.ts ingest-provider-event.integration.test.ts refund.integration.test.ts reconciliation.integration.test.ts`

## Task 7: Scheduler Ownership, Action Expiry, and Renewal Gate

**Files:**
- Create: `apps/core/src/scheduling/jobs/provider-inbox-redrive.ts`
- Create: `apps/core/src/scheduling/jobs/provider-action-expiry.ts`
- Modify: `apps/core/src/scheduling/job-registry.ts`
- Modify: `apps/core/src/scheduling/run-scheduled-jobs.integration.test.ts`
- Modify: `apps/core/src/scheduling/jobs/membership-renewals.ts`
- Modify: `apps/core/src/membership/application/process-membership-renewals.ts`
- Modify: `apps/core/src/scheduling/types.ts`

1. Add scheduler integration tests for inbox-only recovery and provider-action expiry.
2. Add an explicit typed renewal-initiation ownership flag, default off in deployed environments.
3. When initiation is disabled, continue grace expiry/confirmed-outcome reconciliation but create no provider charge.
4. Return `SUCCEEDED|SKIPPED|FAILED` plus affected/escalated counts and safe error codes from job projections.
5. Keep job modules policy-free; they call application commands only.

Run: `pnpm --filter @freshmarkets/core test -- run-scheduled-jobs.integration.test.ts process-membership-renewals.integration.test.ts`

## Task 8: Truthful Tooling, Storefront Assertion, and Dependency Advisory

**Files:**
- Modify: `apps/core/scripts/generate-produce-catalog.ts`
- Modify: `apps/web/tests/storefront-home.spec.ts`
- Modify: root/package manifests and `pnpm-lock.yaml` only as needed for the patched transitive dependency

1. Add a generator test/check proving catalog generation applies only through its owned schema boundary rather than every later migration.
2. Run `pnpm catalog:check` RED against the current coupled generator, then fix the boundary without changing generated catalog content.
3. Align Playwright: cards assert product name/price; quick view asserts fixed variants.
4. Trace the esbuild advisory to the owning package. Prefer an owner-package upgrade; otherwise add the narrowest compatible pnpm override to `>=0.24.3` and verify both builds/tooling.
5. Run `pnpm audit --json` and assert no remaining known vulnerable esbuild version.

Run: `pnpm catalog:check`

Run: `pnpm --filter @freshmarkets/web exec playwright test tests/storefront-home.spec.ts`

Run: `pnpm audit --json`

## Task 9: Canonical Documentation and Full Program Verification

**Files:**
- Modify: `docs/architecture/ARCHITECTURE.md`
- Modify: `docs/architecture/DOMAIN_MODEL.md`
- Modify: `docs/architecture/STATE_MACHINES.md`
- Modify: `docs/architecture/DATA_MODEL.md`
- Modify: `docs/architecture/API_CONTRACTS.md`
- Modify: `docs/product/PRODUCT_SCOPE.md`
- Modify: `docs/product/IMPLEMENTATION_PLAN.md`
- Modify: `docs/product/IMPLEMENTATION_STATUS.md`

1. Document the repaired upgrade boundary, typed environment/readiness policy, one-active-cart invariant, cart availability DTO, normalized inbox lease lifecycle, scheduler ownership gate, and tooling/dependency fixes.
2. Run focused suites from Tasks 1–8.
3. Run repository-wide gates: `pnpm format:check`, `pnpm naming:check`, `pnpm migration:check`, `pnpm catalog:check`, `pnpm lint`, `pnpm typecheck`, `pnpm test`, Core/Web builds, targeted Playwright, and `pnpm audit --json`.
4. Inspect for raw provider payload persistence, silent runtime defaults, zero-price cart coalescing, unguarded active-cart inserts, and scheduler-owned domain transitions.
5. Commit only with fresh evidence and record any unrelated Admin/Maps integration drift separately.

---

## Program acceptance

- A database populated through `0020` survives `0021` and the full chain with identical business data and zero foreign-key violations.
- All deployed environments reject unknown/insecure configuration; no typo downgrades to development.
- One active cart exists per customer; every mutation is idempotent/version-guarded and missing price is explicit.
- Provider inbox retries recover without provider redelivery and cannot be double-applied by competing workers.
- Renewal initiation cannot charge unless explicitly owned/enabled.
- Catalog, migration, audit, dependency, type, test, build, vinext, and targeted browser gates are green.
