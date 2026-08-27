# Remediation Decisions

Status: authoritative decisions for Remediation Pass 1.

This record resolves implementation ambiguity without replacing the domain specifications. `AGENTS.md`, `ARCHITECTURE.md`, `DOMAIN_MODEL.md`, `STATE_MACHINES.md`, `DATA_MODEL.md`, and `API_CONTRACTS.md` remain authoritative for their respective subjects.

## Customer Aggregate

- **Decision:** `customer` is the current commerce Customer aggregate and remains the compatibility name for the existing Phase 4 tables.
- **Authority:** `DOMAIN_MODEL.md` and `DATA_MODEL.md` require an application-owned customer linked to the Better Auth user ID.
- **Legacy behavior preserved:** `customer_principal` remains the Phase 1 authentication linkage and is not renamed or deleted in this pass. Existing commerce rows continue to reference `customer`.
- **Migration strategy:** A later corrective migration may consolidate or explicitly link the two records after a data-backfill plan is approved. No destructive rename is part of Pass 1.
- **Consequence:** New commerce commands must resolve the authenticated user to the existing `customer` aggregate; Better Auth records and `customer_principal` are not treated as commerce orders or profiles.

### Phase 4A principal boundary

- **Decision:** The authenticated commerce chain is Better Auth user/session -> `customer_principal` -> `customer`.
- **Authority:** Better Auth owns authentication identity/session records. Core owns principal status, customer provisioning, and commerce authorization.
- **Reconciliation:** The Core resolver uses unique auth-user/principal and principal/customer relationships with idempotent insert/link behavior. The Better Auth user-create hook is eager provisioning only.
- **Access rule:** Principal status is checked on every customer-boundary resolution. Disabled principals are denied even when a customer already exists. Client-supplied customer/principal/auth-user IDs are not accepted as identity inputs.
- **Compatibility:** The historical `customer.auth_user_id` NOT NULL column remains populated but is not an authorization source; no Better Auth identity fields are duplicated into the customer aggregate.

## State Machines

- **Decision:** `docs/architecture/STATE_MACHINES.md` is authoritative for canonical lifecycle vocabulary and legal transitions.
- **Legacy behavior preserved:** Existing RPC method names and persisted legacy status values remain readable during compatibility migration.
- **Migration strategy:** Runtime adapters may translate legacy values temporarily. New commands must not introduce additional status vocabularies.

## RPC Compatibility

- **Decision:** `docs/architecture/API_CONTRACTS.md` is authoritative for target service contracts.
- **Legacy behavior preserved:** Existing methods in `packages/contracts` and routes currently used by Web remain available.
- **Migration strategy:** Canonical commands are introduced behind compatibility adapters; removal or renaming requires an additive deprecation period and client migration.

## Capacity and Pricing

- **Decision:** Capacity is `cycle x delivery zone x fulfillment location`. Price scope is `SKU x market x optional location x price type`.
- **Authority:** `DOMAIN_MODEL.md` and `DATA_MODEL.md`.
- **Legacy behavior preserved:** The current cycle-level capacity and SKU-only price rows remain historical compatibility data until corrective migrations and command paths are ready.
- **Consequence:** No new command may assume cycle-only capacity or one globally authoritative local price.

## Commercial Policy and Cebu Defaults

- **Decision:** Trial duration, minimum basket, default market, fulfillment location, and applicable fees are configuration or persisted policy data, not scattered command constants.
- **Legacy behavior preserved:** MVP defaults remain Metro Cebu, `location-cebu-central`, a 14-day seeded trial, and a PHP 500 minimum basket.
- **Migration strategy:** Pass 1 centralizes these defaults. Trial duration is read from `subscription_offer`; persisted policy tables and zone fees remain later P1/P2 work.

## Payment Boundary

- **Decision:** The current payment boundary is provider-neutral and backed only by an explicitly selected deterministic mock in development/test.
- **Legacy behavior:** The former synthetic checkout compatibility RPC is removed; payment success now enters through the canonical signed-event/reaction path.
- **Migration strategy:** Idempotency, provider event deduplication, recovery, and refund records are added incrementally before any owner-approved production provider integration. No production provider is selected here.

## Migration Policy

- **Decision:** Existing migrations are immutable historical records by default.
- **Authority:** `AGENTS.md`, `DATA_MODEL.md`, and the migration README.
- **Migration strategy:** Corrective schema changes use new numbered migrations. `0005` and `0006` are not rewritten in Pass 1.
