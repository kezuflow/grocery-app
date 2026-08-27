# Core D1 migrations

> **Non-authoritative migration guide.** Numbered tracked migration files are the historical schema record; this README may lag them and does not define target architecture. The canonical target data model is `docs/architecture/DATA_MODEL.md`, while `docs/product/IMPLEMENTATION_STATUS.md` describes current implementation. Untracked or draft migrations are not accepted merely by existing in the working tree.

Phase 1 adds the Better Auth-supported identity tables and application-owned customer/staff authorization tables in `0001_phase1_auth.sql`. `0002_better_auth_issuer.sql` adds the Better Auth 1.7 account issuer column and issuer/account identity index required for credential and OAuth account ownership.

Phase 2 adds organization, market, fulfillment-location, capability, versioned service-area/delivery-zone, and zone-to-location eligibility tables in `0003_phase2_geography.sql`. It seeds the local bootstrap Metro Cebu geography. Replace the bootstrap polygon with an approved versioned boundary before production launch; do not mutate a deployed polygon version in place.

Phase 3 adds the global catalog, units, shared product inventory pools, fixed SKUs, versioned prices, and location availability in `0004_phase3_catalog.sql`.

Phases 4-13 use `0005_mvp_commerce_operations.sql` for customer/application state, subscriptions, addresses, delivery cycles, carts, historical mock payment attempts, committed order snapshots, inventory reservations, committed procurement demand, procurement/receiving, fulfillment, and delivery records. Its historical D1 capacity/inventory triggers were later dropped by tracked migration `0008` after equivalent Core command foundations were introduced.

Phase 14 uses `0006_phase14_promotions_audit.sql` for the deliberately small promotion seam, audit/domain events, refunds/amendments, supplier and exception records, and delivery batches/stops. Production provider credentials and provider-specific webhook behavior remain external launch work.

Remediation Pass 1 adds `0007_remediation_foundations.sql` as an append-only corrective migration. It adds optimistic-concurrency columns to mutable operational records and the shared `idempotency_records` table. The migration does not claim the related workflows are complete and does not rewrite `0005` or `0006`.

Remediation Pass 2 adds `0008_commerce_invariant_foundations.sql` and
`0009_commerce_policy_and_holds.sql`. These append-only migrations introduce
cycle-zone-location capacity, capacity allocations, checkout attempts and quote
snapshots, payment-event deduplication records, inventory ledger entries,
persisted market/zone commercial policy, and pre-commit inventory holds. `0008`
also drops the four historical capacity/inventory triggers after equivalent Core
command behavior is introduced.

Remediation Pass 3 adds `0010_commerce_defaults_and_pricing_scope.sql`, which
persists default market/location/offer selection and adds canonical market,
location, and price-type scope columns to price versions.

`0011_phase4a_customer_principal_boundary.sql` links the commerce customer
aggregate to the application-owned customer principal while retaining the
legacy authentication column for compatibility.

`0012_price_scope_guards.sql` enforces valid market/location and price-type
scope for future price-version writes.

`0013_phase4b_customer_addresses.sql` adds owner/status/version indexes for
Core-authoritative customer address reads and optimistic updates. Address
ownership remains enforced by the authenticated customer resolver and the
conditional update predicate.

`0014_phase4b_address_serviceability_outcome.sql` persists the exact Core
serviceability boolean and existing resolver failure reason. Existing rows remain
nullable and are exposed as unresolved rather than being inferred from stored
service-area and delivery-zone codes.

`0015`-`0021` add receiving integrity, provider-neutral Payments, Membership/Promotions, checkout/order snapshots, scheduled jobs, renewal test seams, and first-class Instant mode. `0022_delivery_pricing_reconciliation.sql` is an append-only correction that restores quote/order indexes lost by the `0021` table rebuilds, restores one-order-per-payment enforcement, and adds versioned market/location delivery pricing plus quote/order delivery-calculation snapshots. Fresh and populated-`0021` upgrades run through `pnpm migration:check`.

Every D1 schema change uses a numbered Wrangler migration. Better Auth-owned tables must remain compatible with Better Auth's supported schema/adapter workflow; application tables remain separately owned by Core. Do not edit deployed rows manually as part of application behavior.

For the combined local Web/Core stack, apply local migrations from `apps/core` and use `apps/core/.wrangler/state`; the root `dev:stack` script uses that stable persistence directory so Web rebuilds do not erase the local D1 database.

Email verification and password-reset delivery use the Core auth-email port and Cloudflare Email Service `EMAIL` binding. Local tests inject fakes; bearer URLs and recipients are never logged. Production fails closed until `AUTH_EMAIL_FROM` and an onboarded sender are configured outside source.

`0026_admin_foundation.sql` seeds the closed canonical dot-form admin capability vocabulary with stable `perm_<domain>_<action>_v1` identifiers, maps historical colon-form assignments to canonical equivalents additively (legacy rows and assignments are preserved as compatibility data), grants `role_operations_admin` canonical operational read/manage capabilities and `role_operations_viewer` only canonical operational read capabilities, and adds nullable `market_id`, `location_id`, `reason`, `before_json`, `after_json`, and `correlation_id` Audit query columns plus their list indexes. `details_json` is retained for compatibility.

`0027_staff_administration.sql` adds the Staff & Access administration persistence: the application-owned `staff_invitation` table (status lifecycle, one `PENDING` invitation per normalized email, unique idempotency keys), `staff_identity.version` for optimistic concurrency, and role administration metadata (`role.description`, `role.status ACTIVE|ARCHIVED`, `role.version`). Historical rows are preserved and backfilled with defaults.

`0028_customer_crm.sql` adds the Customer CRM persistence: the application-owned `customer_invitation` table (one `PENDING` invitation per normalized email, unique idempotency keys) and the `privacy_request` queue (closed request-type and status vocabularies, staff assignment, resolution recording). No hard-deletion surface exists; closure completion records resolution only.
