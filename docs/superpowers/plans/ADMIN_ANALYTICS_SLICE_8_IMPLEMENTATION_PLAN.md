# Admin Analytics Slice 8 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deliver versioned, capability-scoped Admin Analytics definitions, Overview, and metric-series queries over authoritative Core data, with explicit unavailable states for blocked metrics.

**Architecture:** Analytics is a read-side module inside `apps/core`; it owns metric-definition metadata and rebuildable read calculations but never source lifecycle state. Core resolves IAM/scope, selects a closed metric query from an approved versioned definition, and returns typed DTOs through Web’s thin Service Binding BFF routes. No projection or external analytics service is introduced until measured need exists.

**Tech Stack:** Cloudflare Workers, D1/SQLite migrations, TypeScript, shared `@freshmarkets/contracts`, vinext, Vitest/Cloudflare Worker integration tests, Playwright.

**Spec:** `docs/superpowers/specs/ADMIN_ANALYTICS_SLICE_8_DESIGN.md`

## Global Constraints

- `apps/core` is the sole business, authorization, and D1 authority; `apps/web` uses typed Service Binding calls only.
- Analytics publishes only one approved versioned canonical definition per metric; blocked metrics are unavailable, never guessed.
- Formula metadata is descriptive JSON interpreted by a closed Core registry; clients cannot supply SQL, source columns, or executable formulas.
- Every Analytics query requires `analytics.read`, validates window/timezone/dimensions/version, enforces global/market/location scope, and returns definition version plus source freshness/watermark.
- Purpose-built DTOs only; no D1 rows, Better Auth rows, provider payloads, or source lifecycle mutation through Analytics.
- Money remains integer minor units with explicit currency; quantities remain integer canonical base units and incompatible dimensions are never combined.
- Additive migrations only; use the next available migration after comparing current `main` (`0032_analytics_definitions.sql` unless the current tree advances).
- Preserve unrelated user changes, especially `docs/superpowers/plans/DOORDASH_REFERENCE_FRONTEND_PLAN.md`.
- Run naming, migration, formatting, typecheck, focused/full tests, builds, and diff checks before completion; stop before Slice 9 readiness work.

---

### Task 1: Metric-definition contracts, migration, and closed registry

**Files:**

- Create: `apps/core/migrations/0032_analytics_definitions.sql` (or the next available migration)
- Create: `packages/contracts/src/admin-analytics.ts`
- Modify: `packages/contracts/src/index.ts` to export Analytics contracts
- Create: `apps/core/src/analytics/metric-catalog.ts`
- Create: `apps/core/src/analytics/metric-definitions.ts`
- Create: `packages/contracts/src/admin-analytics.test.ts`
- Create: `apps/core/src/analytics/metric-definitions.test.ts`

**Interfaces:**

- Produce `MetricDefinitionView`, `AnalyticsWindow`, `AnalyticsOverviewView`, `MetricSeriesView`, and request types matching `API_CONTRACTS.md`.
- Produce a closed registry mapping approved metric codes to descriptive definitions and named query keys; blocked definitions carry stable unavailable reasons.
- Produce Core read functions for listing definitions and resolving one approved definition/version without exposing formula JSON internals as executable behavior.

**Steps:**

- [ ] Recheck current migrations and choose the next additive migration number; document the choice in the task report.
- [ ] Write failing contract tests for valid/invalid windows, timezone, metric code/version, availability, dimensions, freshness metadata, and infrastructure-type absence.
- [ ] Add the metric-definition table, uniqueness/index constraints, and immutable seed rows for publishable plus blocked catalog entries.
- [ ] Implement closed catalog parsing and definition DTO mapping; reject unknown or non-approved versions.
- [ ] Run contracts/registry tests, typecheck, migration check, naming check, and touched-file formatting.
- [ ] Commit `feat(analytics): add versioned metric definitions`.

**Acceptance:** Definitions are persisted and versioned; all published names resolve to exactly one approved definition; blocked names return stable unavailability metadata; no arbitrary formula execution or raw schema leaks exist.

### Task 2: Core Analytics authorization, queries, Overview, and metric series

**Files:**

- Create: `apps/core/src/analytics/application/analytics-access.ts`
- Create: `apps/core/src/analytics/application/list-metric-definitions.ts`
- Create: `apps/core/src/analytics/application/get-analytics-overview.ts`
- Create: `apps/core/src/analytics/application/get-metric-series.ts`
- Create: `apps/core/src/analytics/application/metric-queries.ts`
- Create: `apps/core/src/analytics/application/analytics.integration.test.ts`
- Modify: `apps/core/src/index.ts` to expose typed Core service methods and validation schemas
- Modify: any shared admin access/schema module required to preserve existing IAM patterns

**Interfaces:**

- Add `listMetricDefinitions`, `getAnalyticsOverview`, and `getMetricSeries` to the shared Core service contract and Worker implementation.
- Use a normalized half-open UTC window plus explicit IANA timezone and a typed scope selector.
- Return numeric values only for metrics with available authoritative data; otherwise return typed `UNAVAILABLE` with definition/version/reason/freshness fields.

**Steps:**

- [ ] Write failing integration tests for unauthenticated, missing capability, existing out-of-scope location, invalid timezone/window, unknown metric/version, blocked metric, empty denominator, and read-only behavior.
- [ ] Implement access resolution requiring `analytics.read` before source reads and reusing existing global/market/location scope rules.
- [ ] Implement named SQL query functions for the approved metric formulas whose source fields exist: order/customer counts and rates, refund amount, membership counts, promotion redemptions/discounts, fulfillment/picking/packing/delivery times, late delivery/cancellation, stockout and inventory adjustment metrics.
- [ ] Ensure each query applies window/timezone/scope predicates before aggregation, preserves currency/base-unit dimensions, and computes a source watermark/freshness value.
- [ ] Return explicit unavailable results for blocked or insufficiently instrumented metrics; never substitute another timestamp or status.
- [ ] Compose Overview from the same metric registry/query results so definition versions and values cannot diverge from individual series.
- [ ] Run focused Core tests, full Core typecheck, and touched-file formatting.
- [ ] Commit `feat(analytics): add scoped analytics read models`.

**Acceptance:** Core serves all required Analytics query methods with IAM/scope enforcement, canonical version metadata, deterministic formulas, explicit unavailable states, and no mutation path.

### Task 3: Thin Web BFF routes and Analytics workspace

**Files:**

- Create: `apps/web/app/api/admin/analytics/definitions/route.ts`
- Create: `apps/web/app/api/admin/analytics/overview/route.ts`
- Create: `apps/web/app/api/admin/analytics/metrics/[metricCode]/route.ts`
- Create: `apps/web/app/admin/analytics/page.tsx`
- Create: `apps/web/app/api/admin/analytics/analytics-routes.test.ts`
- Modify: `apps/web/tests/admin-operations.spec.ts` only if shared Admin boundary coverage is needed; otherwise create `apps/web/tests/admin-analytics.spec.ts`

**Interfaces:**

- Routes parse URL/query parameters and forward cookies/headers through `coreClient`; they do not calculate metrics or access D1.
- The page consumes only typed RPC responses and Core-provided permitted scope/location context.

**Steps:**

- [ ] Write failing route tests for malformed windows/timezones/metric codes, missing required parameters, and exact Core delegation.
- [ ] Implement GET BFF routes with stable request IDs, validation envelopes, and forwarded auth headers.
- [ ] Build the responsive Analytics workspace with definition/version/freshness context, numeric summaries, unavailable cards/rows, loading, empty, forbidden, validation, and error states.
- [ ] Ensure the UI never displays blocked metrics as zero and does not perform client-side formula calculations.
- [ ] Add Playwright coverage that mocks Core context/scopes and Analytics responses so the protected page renders representative numeric and unavailable states; keep the unauthenticated boundary test intact.
- [ ] Run Web route/component/Playwright-list tests, typecheck, build, and touched-file formatting.
- [ ] Commit `feat(analytics): add admin analytics workspace`.

**Acceptance:** Web exposes only same-origin typed BFF routes and a capability-aware Analytics page with explicit unavailable/freshness/error states and no raw-row leakage.

### Task 4: Reconciliation, documentation, and Slice 8 stop gate

**Files:**

- Modify: `apps/core/src/analytics/application/analytics.integration.test.ts` and/or focused metric test files
- Modify: `packages/contracts/src/admin-analytics.test.ts`
- Modify: `docs/product/IMPLEMENTATION_STATUS.md`
- Modify: `docs/superpowers/plans/ADMIN_CRM_ANALYTICS_PROGRAM_MAP.md` active-plan/status section
- Create: `.superpowers/sdd/ADMIN_ANALYTICS_SLICE_8_IMPLEMENTATION_PLAN/progress.md` (gitignored execution ledger)

**Steps:**

- [ ] Add seeded reconciliation fixtures for every publishable metric and assert formula result, definition version, timezone/window boundaries, dimensions, and watermark.
- [ ] Add blocked-metric assertions for every required unavailable code and stable canonical reason.
- [ ] Add Core scope tests for global, market, permitted location, and existing forbidden location; verify no source mutation occurs.
- [ ] Add Web tests for loading, empty, unavailable, error, and permission states and ensure blocked values are never rendered as numeric zero.
- [ ] Update descriptive implementation status only after contracts and canonical docs agree; do not alter locked metric definitions in status prose.
- [ ] Run full contracts/Core/Web tests, typechecks, Core/Web builds, naming, migration, lint, touched-file formatting, `git diff --check`, and Playwright listing/runnable gates.
- [ ] Perform a final whole-branch review against the Slice 8 spec and this plan.
- [ ] Commit `test(analytics): reconcile metric definitions` and any approved documentation commit.
- [ ] Push `main` and stop before Slice 9 readiness work.

**Acceptance:** Every published metric reconciles to one versioned definition; blocked metrics remain unavailable; all Analytics reads are scoped and read-only; required browser/error states are covered; Slice 8 is pushed and no Slice 9 work begins.

## Stop Gate

Before claiming Slice 8 complete:

- [ ] Task commits are present on `main` and pushed to `origin/main`.
- [ ] Contracts/Core/Web focused and full tests pass (with any environment-gated E2E limitation explicitly reported).
- [ ] Contracts/Core/Web typechecks and builds pass.
- [ ] `pnpm naming:check` and `pnpm migration:check` pass.
- [ ] Touched files pass `oxfmt --check`; `git diff --check` passes.
- [ ] No raw D1/Better Auth/provider types or mutation paths appear in Analytics contracts/UI.
- [ ] Blocked metrics return typed unavailable results with canonical reasons; no accounting/renewal assumptions were invented.
- [ ] Final review is clean or residual findings are explicitly parked with a ruling.
- [ ] Slice 9 readiness/performance/security work has not begun.
