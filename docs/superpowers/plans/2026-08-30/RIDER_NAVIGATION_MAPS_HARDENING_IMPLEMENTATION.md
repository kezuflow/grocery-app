# Rider Navigation and Maps Hardening Implementation Plan

**Status:** Completed and integrated on `main` at `98c2378` on 2026-08-30. The unchecked task boxes below are retained as the original execution plan, not as outstanding work.

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Present ordered rider batches, open the current destination in Google Maps, preserve safe delivery lifecycle retries, and harden the complete maps program for production.

**Architecture:** Core resolves the authenticated canonical rider and returns only assigned batch projections with Core-derived actions. Web builds a keyless Google Maps universal URL from immutable current-stop coordinates; navigation does not mutate FreshMarkets state.

**Tech Stack:** TypeScript 7, React 19, vinext, Cloudflare Workers Service Bindings, D1, Google Maps URLs, Vitest, Playwright.

**Spec:** `docs/superpowers/specs/2026-08-30/MAPS_ADDRESS_DISPATCH_RIDER_DESIGN.md`

## Global Constraints

- Complete and verify the address and Admin dispatch implementation plans first.
- Riders may read and act only on batches assigned to their active canonical rider identity.
- Navigate opens only the current unfinished delivery and never changes batch/job/order state.
- Use immutable stop coordinates and instructions, not the customer's current saved address.
- Preserve explicit idempotent delivery commands and legal state transitions.
- No embedded navigation, whole-batch Google waypoints, live GPS, automatic refunds, or proof expansion.
- Do not disturb unrelated Admin Catalog work.

---

### Task 1: Rider Batch Contracts and Core Read Model

**Files:**

- Modify: `packages/contracts/src/delivery-maps.ts`, `packages/contracts/src/core-service.ts`
- Create: `apps/core/src/delivery/application/get-rider-batches.ts`
- Modify: `apps/core/src/index.ts`
- Test: contracts and `get-rider-batches.integration.test.ts`

**Interfaces:**

- Produces `RiderBatchList`, `RiderBatchView`, `RiderDeliveryView`, and `getRiderBatches`.

- [ ] Write contract tests for batch identity/status/version, current delivery, ordered upcoming deliveries, immutable address/contact/instructions, job/stop versions, and allowed actions.
- [ ] Write integration tests for unauthenticated, non-rider, inactive rider, assigned rider, another rider's batch, mixed completed/open stops, and malformed historical snapshot fallback.
- [ ] Run focused tests; expect failures for missing types/query.
- [ ] Implement the query by canonical rider ID, order stops by sequence, and select the first unfinished stop as current.
- [ ] Retain the historical `riderJobs` RPC as a compatibility projection until Web migration is complete.
- [ ] Re-run focused tests; expect exit 0.
- [ ] Commit with `git commit -m "feat(delivery): expose assigned rider batches"`.

### Task 2: Google Maps URL Builder

**Files:**

- Create: `apps/web/lib/maps/google-maps-url.ts`
- Test: `apps/web/lib/maps/google-maps-url.test.ts`

**Interfaces:**

- Produces `googleMapsNavigationUrl(coordinate: Coordinate): string`.

- [ ] Write exact tests requiring base `https://www.google.com/maps/dir/`, `api=1`, `destination=latitude,longitude`, `travelmode=driving`, `dir_action=navigate`, and no origin.
- [ ] Add invalid/non-finite/out-of-range coordinate tests.
- [ ] Run the test; expect failure because the helper is missing.
- [ ] Implement with the platform `URL` and `URLSearchParams` APIs; throw a typed validation error for invalid coordinates.
- [ ] Re-run the test; expect exit 0.
- [ ] Commit with `git commit -m "feat(rider): add google maps navigation links"`.

### Task 3: Rider Batch API and Mobile Workflow

**Files:**

- Create: `apps/web/app/api/rider/batches/route.ts`
- Modify: `apps/web/app/api/rider/jobs/route.ts` to mark the historical job-list adapter deprecated while preserving its behavior through the Web migration
- Modify: `apps/web/app/rider/page.tsx`
- Test: route/component tests and `apps/web/tests/rider-jobs.spec.ts`

**Interfaces:**

- Consumes Task 1 read model and Task 2 URL helper.
- Produces current-delivery-first mobile UI with upcoming sequence.

- [ ] Write route tests proving session forwarding and no client rider ID.
- [ ] Write component/Playwright tests for empty batches, current/upcoming ordering, immutable contact/instructions, Navigate URL/target/rel, En Route/Arrived/Delivered/Failed actions, action refresh, and next-delivery advancement.
- [ ] Run focused tests; expect failures for missing batch UI.
- [ ] Implement the thin route and rebuild the rider page around batch cards; use a direct anchor/button activation for Google Maps.
- [ ] Keep lifecycle buttons driven only by Core `allowedActions`.
- [ ] Re-run focused tests; expect exit 0.
- [ ] Commit with `git commit -m "feat(rider): add ordered batch workflow"`.

### Task 4: Connection-loss and Idempotency Recovery

**Files:**

- Create: `apps/web/lib/rider/rider-command-intent.ts`
- Modify: `apps/web/app/rider/page.tsx`
- Test: `apps/web/lib/rider/rider-command-intent.test.ts`, rider component tests

**Interfaces:**

- Produces a command-intent store keyed by `{jobId}:{action}` that retains one idempotency key until terminal success or a definitive stale/conflict response.

- [ ] Write tests for key creation, same-action retry reuse, different-action isolation, success clearing, stale clearing/refresh, and network-error retention.
- [ ] Run focused tests; expect failure because the intent store is missing.
- [ ] Implement the store using session storage with an in-memory fallback and no address/contact payload.
- [ ] Integrate pending, retry, and recovered-result announcements into the rider UI.
- [ ] Re-run focused tests; expect exit 0.
- [ ] Commit with `git commit -m "feat(rider): preserve delivery command retries"`.

### Task 5: Observability, Security, and Runbook

**Files:**

- Modify: existing observability/provider adapters without changing domain ownership
- Create: `docs/runbooks/MAPS_AND_DISPATCH.md`
- Test: provider logging tests and security-boundary integration tests

**Interfaces:**

- Produces PII-safe provider telemetry and a production setup/recovery runbook.

- [ ] Write tests proving logs include operation, duration/result/error code but exclude query/address/contact/coordinates/tokens.
- [ ] Extend security-boundary tests for customer address ownership, Admin scope, rider isolation, and public-vs-server Mapbox token separation.
- [ ] Run focused tests; expect failures for missing telemetry/runbook assertions.
- [ ] Implement safe telemetry and document public token origins, Core token setup, permanent-geocoding account requirement, approved polygon deployment, CSP, provider outage behavior, rollback, and manual smoke tests.
- [ ] Re-run focused tests; expect exit 0.
- [ ] Commit with `git commit -m "docs(maps): add production operations runbook"`.

### Task 6: Whole-Program Acceptance

- [ ] Run all maps/address/delivery/rider contract, unit, integration, component, and Playwright tests.
- [ ] Run `pnpm format:check`, `pnpm naming:check`, `pnpm migration:check`, `pnpm lint`, `pnpm typecheck`, and `pnpm test`.
- [ ] Run `pnpm --filter @freshmarkets/web check:vinext` and `pnpm -r build`.
- [ ] Run `git diff --check` and inspect the complete maps-program diff against the spec.
- [ ] Confirm no temporary Mapbox persistence, raw DTO leakage, customer hub selection, automatic optimization, live tracking, whole-batch Google navigation, or unrelated Admin Catalog edits.
- [ ] Update canonical documentation/status records only where implementation evidence requires a descriptive update.
- [ ] Request a whole-program code review, address material findings, and re-run affected verification before reporting completion.
