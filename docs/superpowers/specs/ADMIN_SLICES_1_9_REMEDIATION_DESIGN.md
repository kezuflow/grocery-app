# Admin Slices 1–9 Canonical Remediation Design

**Date:** 2026-08-29  
**Status:** Approved direction, pending implementation-plan review  
**Source review:** `docs/reviews/ADMIN_SLICES_1_9_REVIEW.md`

## Purpose

Remediate every actionable finding from the Admin Slices 1–9 review without creating a second architecture or preserving contradictory legacy behavior. The work restores canonical command integrity, catalog and operations truth, explicit Admin scope behavior, complete operational workflows, dimension-safe analytics, and evidence-based readiness.

## Governing decisions

1. `RESOLVED` remains terminal for Admin order issues; `REOPEN` is removed.
2. Fulfillment and delivery adopt the complete canonical lifecycles in `STATE_MACHINES.md` rather than retaining the simplified Slice 7 models.
3. A cycle/location/inventory-pool has at most one active procurement requirement. Additional demand revises the guarded aggregate.
4. A SKU/market/location/price-type precedence key has at most one effective price at an instant. A successor atomically closes its predecessor.
5. A customer has at most one grant for a promotion. An identical retry replays; a materially different retry conflicts.
6. Multi-scope Admin users explicitly select a scope. Scoped queries and commands reject ambiguity instead of choosing the first assignment.
7. Analytics never combines currencies or canonical base units into one scalar. Missing ambiguous dimensions produce an unavailable result.
8. A mandatory readiness gate is `FAILED` or `BLOCKED` when it fails, is unprovisioned, or lacks usable evidence; it is never reported as passed.
9. Catalog contracts and storage migrate to canonical units, SKU sell quantities, and sourcing values. No permanent dual vocabulary is introduced.
10. The audit detail page is completed rather than removing navigation to it.

## Architecture

### Command integrity

Material Admin commands use one consistent D1 transaction/batch boundary:

1. Normalize and validate the request.
2. Resolve identity, capability, and explicit scope.
3. Claim a stable idempotency key using a hash of the complete canonical command.
4. Apply the expected-version or uniqueness guard.
5. Perform the authoritative mutation and dependent effects.
6. Append the required audit event.
7. Mark idempotency as succeeded with the mutated aggregate ID and result type.

No audit or successful idempotency record may survive a failed mutation, and no successful mutation may omit its required audit record. A replay with the same hash returns the original aggregate result. A replay with a different hash returns `IDEMPOTENCY_CONFLICT` without mutation or audit.

The pattern applies first to order cancellation, privacy actions, staff and role mutation, session revocation, promotion grants, membership changes, and operational commands. Tests inject stale versions, duplicate keys, changed payloads, and write failures.

### Catalog and pricing truth

Canonical unit definitions store `canonicalBaseCode`, positive integer `conversionNumerator`, and positive integer `conversionDenominator`. Core rejects cross-dimension conversions. `PACK`, `BUNCH`, and similar merchandising labels remain copy and never become global units.

SKU creation requires a positive integer `sellQuantity`, controlled sell-unit ID, and positive integer base consumption. Read models expose the persisted values and aggregate versions used by Admin commands.

Sourcing values become exactly `STOCKED`, `PLANNED`, `ON_DEMAND`, and `MIXED`. Existing `PLANNED_PROCUREMENT` data maps to `PLANNED`; `HYBRID` maps to `MIXED`. Contracts, migrations, seed generation, queries, tests, and UI change together.

Price replacement is versioned and atomic. Before inserting a successor, Core closes the currently active row for the same SKU, market, optional location, and price type at the successor's `validFrom`. Overlap is rejected. Selection orders by precedence and effective version deterministically; it never combines `MAX(version)` with unrelated non-aggregated columns.

### Procurement and operational lifecycles

Procurement generation moves demand calculation and aggregate guarding into one command boundary. Storage enforces the chosen active-requirement uniqueness key. Concurrent writers cannot both create requirements for the same demand context.

Fulfillment and delivery contracts, tables, transitions, queues, permitted actions, and Admin screens migrate together to the canonical state machines. Existing simplified states are migrated explicitly. No state is reinterpreted silently at read time.

Receiving exceptions use persisted UTC timestamps for age and cursor ordering rather than SQLite `rowid`.

### Admin scope and workflow behavior

The Admin context fails visibly when scope loading fails. Users with more than one allowed scope must select a global, market, or location scope before opening scoped surfaces. The selection is retained for the browser session and sent explicitly to Core. Core verifies the selected scope is assigned and adequate for the capability.

Staff management gains working invitation revocation, staff status/profile editing, role assignment, and geography-validated scope assignment. Audit navigation gains the existing detail API's page with permission, loading, empty, and error states.

Every paginated Core contract gains reachable Web pagination while preserving filters and selected scope. Command controls allocate one idempotency key per operator intent, retain it through ambiguous retry, disable duplicate submission, show stale-version recovery, and use an impact confirmation for destructive actions.

Customer order summaries use committed orders and canonical commitment time only. Invalid filters return validation errors. Reserved benefit codes, including `INTRO_TRIAL`, cannot be created through Admin Promotions.

### Analytics

The analytics page sends its selected scope explicitly. Metric definitions require a currency or base-unit dimension whenever more than one value occurs in the requested window/scope. If the dimension is absent and the source contains multiple values, the metric returns unavailable with a stable reason. Single-dimension results retain that dimension in the response metadata.

The canonical metric-definition version is incremented wherever semantics change. Multi-currency and mass/volume/count fixtures prove that no mixed scalar is published.

### Readiness evidence

Readiness validation runs against actual route names and an authenticated, capability-scoped staff fixture. It records reproducible results for required type, naming, migration, lint, formatting, unit/integration, Worker-local, browser, security, and performance gates.

Performance evidence covers representative Admin list, detail, operations-queue, and analytics routes. Reports record LCP, INP, CLS, network/request observations, fixture/environment details, and limitations. Missing prerequisites are reported as blocked.

The Worker readiness launcher resolves Windows executables without combining an argument array with `shell: true`.

## Migration strategy

1. Add forward-only D1 migrations for canonical unit fields/tables, SKU sell quantities, sourcing values, price constraints/indexes, procurement uniqueness/versioning, operational timestamps, and lifecycle state changes.
2. Backfill deterministic values from existing data and fail migration validation when a row cannot be mapped safely.
3. Change shared contracts and Core behavior in the same landing sequence so no deployment exposes mismatched RPC shapes.
4. Update Web consumers after Core DTOs expose versions, allowed actions, dimensions, and explicit scopes.
5. Remove legacy enum acceptance after stored data and callers have migrated; no indefinite compatibility branch remains.

Migrations never edit already-applied migration files. Historical order, price, fulfillment, and delivery snapshots remain immutable.

## Error behavior

- Stale aggregate versions return `STALE_VERSION` with no mutation, audit, or idempotency success.
- Reused keys with changed canonical input return `IDEMPOTENCY_CONFLICT`.
- Missing or unauthorized selected scope returns the existing authorization/validation error shape and never falls back to another scope.
- Constraint races return a stable conflict and allow a safe read/retry.
- Mixed-dimension metrics return unavailable rather than zero or a combined value.
- UI preserves operator input for recoverable failures and clearly distinguishes retry, refresh, permission, and validation outcomes.

## Testing strategy

Every behavioral fix follows red-green-refactor. Focused integration tests cover:

- cancellation keys reused across orders, versions, and reasons;
- stale privacy/staff/role/promotion/operations writes with audit and idempotency assertions;
- concurrent price and procurement writers;
- unit conversion and SKU quantity invariants across mass, volume, and count;
- sourcing migrations and exhaustive canonical enum handling;
- promotion reserved codes and duplicate grants;
- complete legal and illegal fulfillment, delivery, and issue transitions;
- explicit scope selection and multi-scope rejection;
- committed-only customer summaries;
- multi-currency and multi-base-unit analytics;
- pagination beyond the first page and stable ambiguous retries.

Authenticated Playwright coverage exercises at least one successful command and one capability/scope denial for each Admin slice. Final validation runs the repository's complete required gate set plus Worker-local integration and representative browser performance collection.

## Delivery sequence

1. Command integrity and critical concurrency defects.
2. Canonical catalog, SKU, sourcing, and price migration.
3. Promotions, customer summaries, issue lifecycle, and input normalization.
4. Canonical procurement, fulfillment, delivery, and exception queues.
5. Explicit scope selection and missing Admin workflows.
6. Pagination, retry UX, confirmations, and audit detail.
7. Dimension-safe analytics.
8. Authenticated end-to-end and readiness evidence.
9. Descriptive documentation reconciliation after canonical behavior and tests agree.

Each stage must leave contracts, Core, Web, migrations, and focused tests internally consistent. A later stage does not begin while an earlier stage's focused tests fail.

## Non-goals

- No public HTTP API, microservice split, Durable Object, Workflow, Queue, KV, or direct Web-to-D1 access.
- No change to locked membership, payment commitment, checkout, inventory-base-unit, order snapshot, or promotion-stacking rules.
- No raw CRUD Admin information architecture.
- No broad unrelated storefront redesign or DoorDash reference-plan changes.
- No production data edits outside forward migrations and application commands.

## Acceptance criteria

The remediation is complete only when:

1. All 30 review findings are either fixed with evidence or explicitly superseded by an approved canonical-document change.
2. Critical replay and concurrency regression tests pass and demonstrate no false audit or duplicate authoritative state.
3. Contracts, migrations, Core, Web, and canonical documentation use one consistent unit, sourcing, scope, and lifecycle model.
4. Every material Admin command has stable idempotency, concurrency protection, and atomic audit evidence.
5. All paginated records and authorized workflows are operable through Web.
6. Analytics publishes no mixed-currency or mixed-base-unit scalar.
7. Authenticated Admin browser journeys run in the validation environment.
8. Every required repository/readiness gate exits successfully; blocked or unavailable evidence prevents a pass verdict.
