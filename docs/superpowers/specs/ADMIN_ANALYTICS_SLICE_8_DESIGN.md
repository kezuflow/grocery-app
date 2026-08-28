# Admin Analytics Slice 8 Design

**Status:** Proposed for implementation after user approval

## Goal

Deliver the required Admin Analytics read surfaces: versioned metric definitions, a scoped
Overview, and individual metric series. Analytics remains a read-side concern inside Core and
publishes only metrics with one approved canonical definition.

## Scope

### Included

- Core-owned `analytics.read` authorization with global, market, and location scope handling.
- A versioned metric-definition catalog persisted in D1 and exposed through a purpose-built DTO.
- `admin.analytics.listMetricDefinitions`.
- `admin.analytics.getOverview`.
- `admin.analytics.getMetric`.
- Thin Web BFF routes and an `/admin/analytics` workspace with loading, empty, unavailable,
  forbidden, validation, and error states.
- Read-side reconciliation tests proving each published metric is calculated from its definition,
  honors timezone/window/scope, and carries definition version plus freshness/watermark metadata.

### Deferred

- Promotion and operations-specific Analytics dashboards.
- Analytics exports and export status polling.
- New data-lake, Queue, Durable Object, or external analytics infrastructure.
- Publication of blocked accounting, renewal, cohort, denominator, substitution, or cost-basis
  metrics.

## Canonical metric policy

Each published metric has exactly one active approved definition. The definition records its code,
version, display name, formula description, source tables/events, event-time field, reporting
timezone policy, dimensions, inclusion/exclusion rules, rounding policy, and empty-denominator
behavior. Queries select a definition first and return that same definition version in every
metric result; they never calculate a metric from UI-specific formulas.

The initial catalog publishes only definitions whose source data and business rules are already
authoritative in the canonical documents. The following approved metrics are included when their
source fields exist: order count, refund amount, new customers, active customers, repeat customer
rate, orders per customer, active members, trialing members, promotion redemptions, discount
spend, promotion-influenced order revenue, fulfillment time, picking time, packing time, delivery
time, late-delivery rate, cancellation rate, out-of-stock rate, stockouts, and inventory
adjustments/shrinkage. A metric whose required event instrumentation is absent is returned as
`unavailable` with a stable reason rather than inferred from a different timestamp or status.

The required-but-blocked catalog remains visible in definitions with `availability: "UNAVAILABLE"`:
GMV, revenue/net sales, AOV, refund rate, trial-to-paid conversion, MRR, churn, promotion
redemption rate, substitution rate, and inventory turnover. Their DTOs include the canonical
blocking reason from `DOMAIN_MODEL.md`; no placeholder numeric value is emitted.

## Data model

Add one additive migration for `metric_definition` (or the repository's established plural table
naming) with:

- stable primary key;
- unique `(code, version)`;
- display name, formula JSON, source contract version, event-time field, timezone policy,
  inclusion/exclusion JSON, rounding policy, status, and nullable approval timestamp;
- indexes supporting active approved definition lookup by code and status.

Seed immutable definition rows for the initial catalog. Definitions are application-owned metadata,
not arbitrary executable SQL or user-authored scripts. Formula JSON is descriptive and interpreted
by named Core query functions selected from a closed registry. No definition may contain executable
code, table names supplied by a client, or an authority to mutate source state.

No projection table is required initially. Queries read authoritative normalized tables through
bounded, indexed statements and return a source watermark derived from the newest relevant source
event/row included in the calculation. A rebuildable projection may be proposed only after a
measured query need.

## Contracts and Core application

Add shared contracts for:

- `MetricDefinitionView`: code, version, display name, category, formula description, availability,
  unavailable reason, source watermark/freshness, dimensions, and approval metadata.
- `AnalyticsWindow`: inclusive start/exclusive end instants plus an explicit IANA timezone.
- `AnalyticsOverviewView`: window, timezone, scope, definition versions, freshness metadata, and
  a bounded array of metric summary values or unavailable reasons.
- `MetricSeriesView`: metric identity/definition, window, dimensions, ordered points, numeric or
  unavailable values, and freshness metadata.

All list/query inputs validate window ordering, timezone, metric code, definition version, bounded
dimensions, and cursor/limit where applicable. Core resolves the staff principal from the forwarded
session, requires `analytics.read`, and checks requested global/market/location scope before any
source query. Web never accesses D1 directly.

Each metric has a named query function under the Analytics application module. Functions accept a
normalized window/scope and return a typed result; they do not accept arbitrary SQL, source column
names, or client formulas. Currency and base-unit dimensions remain explicit and are never summed
across incompatible contexts.

## Web surface

Add same-origin BFF routes:

- `GET /api/admin/analytics/definitions`
- `GET /api/admin/analytics/overview`
- `GET /api/admin/analytics/metrics/:metricCode`

Add `/admin/analytics` using the existing capability-aware Admin shell. The page is decision-first:
definition/availability state, selected reporting window and timezone, a compact metric summary,
and links to the individual series. It must clearly distinguish numeric results from unavailable
metrics and show definition version/freshness. It must not render decorative cards for blocked
metrics or invent values.

## Error and freshness behavior

- Unauthenticated callers receive `UNAUTHENTICATED`; missing capability or scope receives
  `FORBIDDEN`/`NOT_FOUND` according to existing Core access policy.
- Malformed windows, timezones, dimensions, cursors, and definition versions receive
  `VALIDATION_FAILED` with a request ID.
- A blocked metric is a successful typed response with `availability: "UNAVAILABLE"` and a stable
  reason, not a generic server error.
- Freshness is explicit. A query reports the source watermark and computed age relative to the
  request time; absence of a usable watermark is represented as unavailable rather than zero.

## Testing and acceptance

- Contract tests cover every Analytics input/DTO and ensure no D1/provider types leak.
- Core tests cover authentication, capability, global/market/location scope, invalid windows and
  timezones, definition-version consistency, blocked metrics, empty denominators, currency/base-unit
  separation, and read-only source ownership.
- Reconciliation tests calculate each published metric from seeded authoritative rows and verify
  the result against its definition version and source watermark.
- Web route tests cover BFF validation and Core delegation.
- Playwright covers the Analytics permission boundary and representative Overview rendering with
  numeric and unavailable metrics, including loading, empty, and error states.
- Stop gate runs contracts/Core/Web tests and typechecks, builds, naming/migration/format/diff
  checks, and stops before Slice 9 readiness work.

## Architectural constraints

- Core remains the sole business, authorization, and D1 authority.
- Analytics owns no Customer, Order, Payment, Membership, Promotion, Inventory, Fulfillment, or
  Delivery lifecycle state.
- No public REST/CORS API, raw-table DTO, client-side metric calculation, arbitrary formula
  scripting, or unapproved metric publication.
- Existing unrelated storefront changes remain untouched.
