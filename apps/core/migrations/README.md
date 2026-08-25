# Core D1 migrations

Phase 1 adds the Better Auth-supported identity tables and application-owned customer/staff authorization tables in `0001_phase1_auth.sql`. `0002_better_auth_issuer.sql` adds the Better Auth 1.7 account issuer column and issuer/account identity index required for credential and OAuth account ownership.

Phase 2 adds organization, market, fulfillment-location, capability, versioned service-area/delivery-zone, and zone-to-location eligibility tables in `0003_phase2_geography.sql`. It seeds the local bootstrap Metro Cebu geography. Replace the bootstrap polygon with an approved versioned boundary before production launch; do not mutate a deployed polygon version in place.

Phase 3 adds the global catalog, units, shared product inventory pools, fixed SKUs, versioned prices, and location availability in `0004_phase3_catalog.sql`.

Phases 4-13 use `0005_mvp_commerce_operations.sql` for customer/application state, subscriptions, addresses, delivery cycles, carts, sandbox payment attempts, committed order snapshots, inventory reservations, committed procurement demand, procurement/receiving, fulfillment, and delivery records. D1 triggers guard cycle capacity and stocked reservations.

Phase 14 uses `0006_phase14_promotions_audit.sql` for the deliberately small promotion seam, audit/domain events, refunds/amendments, supplier and exception records, and delivery batches/stops. Production provider credentials and provider-specific webhook behavior remain external launch work.

Every D1 schema change uses a numbered Wrangler migration. Better Auth-owned tables must remain compatible with Better Auth's supported schema/adapter workflow; application tables remain separately owned by Core. Do not edit deployed rows manually as part of application behavior.

For the combined local Web/Core stack, apply local migrations from `apps/core` and use `apps/core/.wrangler/state`; the root `dev:stack` script uses that stable persistence directory so Web rebuilds do not erase the local D1 database.

Email verification and password-reset delivery are exposed through the Core email-delivery port. Development logs the generated URLs for test capture; production requires a configured transactional delivery provider before launch.
