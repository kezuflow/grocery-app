# Runtime and Persistence Reliability Remediation Design

**Program:** Full Codebase Remediation — Program 2  
**Priority:** Release hardening  
**Scope:** Migration chain, environment validation, carts, provider inbox retry, scheduler, and configuration readiness

## Objective

Make upgrades and retries truthful: a populated database must survive migrations, deployed environments must fail closed, mutable carts must be concurrency-safe, and provider events marked retryable must actually be retried.

## 1. Safe populated migration chain

### Historical migration repair

`0021_instant_mode.sql` will be rewritten so a database paused immediately before `0021` can contain real Scheduled checkout attempts, quotes, orders, order items, fulfillment snapshots/records, delivery jobs, payment links, reservations, committed demand, amendments, refunds, and exceptions.

The repair will rebuild the complete foreign-key dependency graph rather than dropping a referenced parent while assuming children are empty. The migration will:

1. enable deferred foreign-key checking using the D1-supported SQLite mechanism;
2. create replacement tables with final `0021` schemas and final indexes;
3. copy parent and child rows without changing identifiers, amounts, quantities, timestamps, statuses, versions, or JSON snapshots;
4. rebuild every child foreign key that SQLite redirects during table rename;
5. swap replacement tables in dependency-safe order;
6. restore indexes and uniqueness constraints; and
7. finish with `PRAGMA foreign_key_check` returning no rows.

Databases that already recorded `0021` as applied do not rerun it and are unaffected. Future databases upgrading from pre-0021 receive the corrected migration. No later migration is used to conceal a broken earlier upgrade step.

### Verification matrix

`scripts/verify-migrations.mjs` will run at least these independent databases:

- empty database through all migrations;
- populated database through `0020`, insert a representative Scheduled commerce graph, then apply `0021` and the remainder;
- populated database through the migration immediately before every later table rebuild, then apply the remaining chain;
- current schema constraint tests for duplicate payments, active carts, price windows, refund budgets, and provider inbox leases.

For populated upgrades, the script snapshots row counts and business-significant fields before the migration and compares them after final apply. The success message names the exact tested upgrade boundaries; it does not describe post-0021 insertion as a populated 0021 upgrade.

## 2. Fail-closed runtime configuration

A shared runtime parser will accept only:

```ts
type RuntimeEnvironment = "development" | "test" | "preview" | "staging" | "production";
```

Unknown, empty, or misspelled configured values fail startup. An omitted value defaults to `development` only in local test/dev entrypoints that explicitly request that default; generic deployed parsing never silently downgrades.

Rules by environment:

- `development` and `test` may use deterministic local secrets and loopback HTTP origins.
- `preview`, `staging`, and `production` require `BETTER_AUTH_SECRET`, HTTPS `BETTER_AUTH_URL`, HTTPS trusted origins, secure cookies, and a non-loopback `PUBLIC_APP_ORIGIN`.
- Google OAuth requires both client values or neither.
- Payment provider configuration is explicit. Mock is valid only in development/test.
- Renewal initiation has its own explicit feature/ownership setting and defaults off in every deployed environment until an approved provider and policy are configured.
- Required provider/geography/email bindings report readiness without exposing secrets.

Core and Web each validate configuration once at composition/startup and reuse the typed result. Tests cover all five environments, missing values, typo values such as `prod`, loopback leakage, partial OAuth configuration, mock provider leakage, and secure-cookie behavior.

## 3. Cart aggregate correctness

### Database invariant

The next available migration adds a partial unique index ensuring at most one `ACTIVE` cart per customer. Existing duplicates are reconciled deterministically before the index:

- newest active cart remains active;
- items from older active carts merge by SKU using the most recently updated authoritative quantity where timestamp evidence exists, otherwise the newest cart wins;
- older carts become `SUPERSEDED` rather than being deleted; and
- an audit/domain event records automatic reconciliation without customer-sensitive payloads.

### Commands

Cart writes become explicit commands:

```ts
type SetCartItemRequest = AuthenticatedRequest & {
  cartId: string;
  skuId: string;
  quantity: number;
  expectedVersion: number;
  idempotencyKey: string;
};
```

The command claims idempotency, validates ownership, SKU/product/location availability, and aggregate version, then mutates the item and increments the cart version atomically. A zero quantity removes the item. Replaying the same request returns the same cart version/result; changing payload under the same key returns `IDEMPOTENCY_CONFLICT`; stale versions return `CART_VERSION_CONFLICT`.

First-touch cart provisioning uses `INSERT ... ON CONFLICT` against the active-cart invariant and then selects the winner, so concurrent `getCart` calls return one identity.

### Price representation

Cart lines no longer coalesce missing prices to zero. A line carries explicit availability and nullable price:

```ts
type CartLineAvailability = "AVAILABLE" | "UNAVAILABLE" | "PRICE_UNAVAILABLE";
```

Unavailable lines remain visible and removable but do not contribute a guessed amount. The cart read model exposes whether checkout is blocked and why. Web renders “Unavailable” instead of ₱0.00.

Tests cover first-touch races, stale-tab writes, duplicate requests, conflicting payloads, inactive products, missing price, price expiry, and multi-location price context.

## 4. Durable provider inbox processing

### Persisted normalized observation

After signature verification, adapters produce a bounded provider-neutral observation containing only controlled fields required for payment/refund state application. The inbox persists that normalized JSON plus payload hash. Raw bodies and unrestricted provider payloads are not persisted.

### Lease and retry lifecycle

Inbox rows gain processing lease metadata:

- `attempts`;
- `available_at`;
- `lease_owner`;
- `lease_expires_at`;
- `last_error_code`; and
- terminal/escalated timestamps.

A handler atomically claims a `RECEIVED` or due `RETRY_REQUIRED` row. Same-event delivery with the same payload hash may reclaim a due retry row; a different hash is rejected and escalated. A scheduler job also claims due rows so recovery does not depend on provider redelivery.

Outcomes:

- successful application → `APPLIED`;
- already-observed domain result → `DUPLICATE`;
- transient CAS/provider dependency problem → `RETRY_REQUIRED` with bounded exponential delay;
- invalid normalized data/integrity problem → `REJECTED`;
- attempt/age threshold exceeded → `RECONCILIATION_REQUIRED` plus a reconciliation case.

Payment and refund handlers remain idempotent under repeated leases. Tests cover same-event transient failure followed by successful redelivery, scheduler-only recovery, lease expiration, competing workers, payload mismatch, refund conflict recovery, and escalation thresholds.

## 5. Scheduler ownership and readiness

The scheduler registry remains a transport dispatcher. It adds explicit jobs for inbox redrive, provider-action expiry, notification outbox delivery (Program 4), and any required reconciliation cleanup. Job modules call application commands; they contain no domain transition policy.

Membership renewal initiation checks the typed runtime ownership setting. When disabled, it may still execute grace-expiry and confirmed-outcome reconciliation that do not create provider charges, but it cannot initiate a new charge.

Recent-run projections distinguish `SUCCEEDED`, `SKIPPED`, `FAILED`, and partial/escalated outcomes with affected counts and safe error codes.

## 6. Repository verification gates

- `catalog:check` must compare the manifest against a generator input schema that is independent of later unrelated migrations. The generator will build against the precise schema boundary it owns rather than applying every subsequent migration before regeneration.
- The storefront Playwright assertion for variant labels will be aligned with the approved marketplace presentation: product cards assert name/price, while quick view asserts fixed variants.
- Formatting checks remain repository-wide but active external work is integrated before the remediation branch is landed.
- The transitive vulnerable esbuild path will be removed by upgrading the owning package or applying a tested package-manager override to a compatible patched version. Production and developer builds must pass afterward.
- Dependency updates are limited to fixes required by this program; routine unrelated upgrades are not bundled.

## Verification and acceptance

- A true populated pre-0021 upgrade passes with identical business data and no foreign-key violations.
- Runtime configuration tests prove fail-closed behavior for every deployed environment.
- Concurrent cart/inbox tests run under the Worker-local D1 runtime rather than a mock repository.
- Scheduled redrive demonstrates recovery after the original provider request is gone.
- Naming, catalog, migration, audit, typecheck, test, build, vinext, and relevant Playwright gates all pass.
- Canonical data, API, architecture, state-machine, product-plan, and implementation-status documents are updated with the implemented behavior.
