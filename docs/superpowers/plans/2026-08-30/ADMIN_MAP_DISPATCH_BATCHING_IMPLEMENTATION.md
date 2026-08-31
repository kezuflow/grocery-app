# Admin Map Dispatch and Batching Implementation Plan

**Status:** Completed and integrated on `main` at `98c2378` on 2026-08-30. The unchecked task boxes below are retained as the original execution plan, not as outstanding work.

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Show scoped delivery pins, rectangle-select eligible deliveries, manually sequence them, preview the route, and atomically create and assign a rider batch.

**Architecture:** Delivery owns map projections, batches, stops, rider assignment, and lifecycle transitions inside Core. Web renders provider-neutral map DTOs through the Plan 1 Mapbox foundation; Mapbox Directions previews the submitted order but never optimizes or authorizes it.

**Tech Stack:** TypeScript 7, React 19, vinext, Cloudflare Workers Service Bindings, D1, Mapbox GL JS 3.29.0, Mapbox Directions v5, Vitest, Playwright.

**Spec:** `docs/superpowers/specs/2026-08-30/MAPS_ADDRESS_DISPATCH_RIDER_DESIGN.md`

## Global Constraints

- Complete and verify `docs/superpowers/plans/2026-08-30/MAPBOX_ADDRESS_FLOW_IMPLEMENTATION.md` first.
- Read the canonical Delivery, Rider, Admin, IAM, state-machine, data, and API documents before editing.
- Use migration `0043_delivery_batches_and_map_stops.sql` and preserve all historical jobs, batches, stops, snapshots, and proofs.
- Core derives selectability and validates all assignment decisions; Web sends identities and expected versions only.
- One batch contains one to 24 deliveries from one location and compatible mode/cycle context.
- Route preview follows manual order and is non-authoritative/non-blocking.
- No live tracking, route optimization, customer hub selection, or new Cloudflare resource.
- Do not disturb unrelated Admin Catalog work.

---

### Task 1: Delivery Map and Batch Contracts

**Files:**

- Create: `packages/contracts/src/delivery-maps.ts`
- Modify: `packages/contracts/src/index.ts`, `packages/contracts/src/core-service.ts`, canonical API/data/state documents
- Test: `packages/contracts/src/delivery-maps.test.ts`, `packages/contracts/src/core-service.test.ts`

**Interfaces:**

- Produces the only DTOs later tasks may expose to Web.

- [ ] Write tests for the exact interface relationships:

```ts
export type DeliveryMapPin = {
  jobId: string;
  orderId: string;
  batchId: string | null;
  coordinate: Coordinate;
  fulfillmentMode: "INSTANT" | "SCHEDULED";
  cycleId: string | null;
  status: string;
  rider: { riderId: string; displayName: string } | null;
  version: number;
  selection: { selectable: boolean; reason: string | null };
};
export type OrderedDeliveryVersion = { jobId: string; expectedVersion: number };
export type CreateAndAssignDeliveryBatchRequest = AuthenticatedRequest & {
  locationId: string;
  fulfillmentMode: "INSTANT" | "SCHEDULED";
  cycleId: string | null;
  riderId: string;
  orderedDeliveries: ReadonlyArray<OrderedDeliveryVersion>;
  idempotencyKey: string;
};
```

- [ ] Add and test `DeliveryMapView`, `DeliveryMapDetail`, `EligibleRiderView`, `BatchRoutePreview`, and `DeliveryBatchView`.
- [ ] Add Core methods `getDeliveryMap`, `getDeliveryMapDetail`, `getEligibleRiders`, `previewDeliveryBatchRoute`, and `createAndAssignDeliveryBatch`.
- [ ] Run focused contract tests; expect failure before implementation and exit 0 after it.
- [ ] Update canonical contracts/state/data documents to describe the atomic orchestration through legal transitions.
- [ ] Commit with `git commit -m "feat(contracts): add dispatch map contracts"`.

### Task 2: Canonical Delivery Batch Migration

**Files:**

- Create: `apps/core/migrations/0043_delivery_batches_and_map_stops.sql`
- Modify: delivery schema mappings where present
- Test: `apps/core/src/delivery/infrastructure/delivery-map-migration.integration.test.ts`

**Interfaces:**

- Produces canonical rider, batch, stop, and event persistence consumed by all later tasks.

- [ ] Write a migration test starting from compatibility rows for Scheduled and Instant jobs, an existing batch/stop, and proof JSON.
- [ ] Assert nullable cycle for Instant, mode/location/zone/rider/version/timestamps on batches, immutable coordinates/contact/instructions/status/version on stops, and append-only delivery events.
- [ ] Assert each legacy job has exactly one stop after migration and historical JSON/proof data is unchanged.
- [ ] Run the migration test; expect failure because migration `0043` does not exist.
- [ ] Implement a forward-only SQLite rebuild where existing NOT NULL/foreign-key shapes require it; copy rows before replacing tables and restore indexes/constraints.
- [ ] Add active-context and rider/open-batch indexes without making Rider or Batch own Order state.
- [ ] Run the migration test and `pnpm migration:check`; expect exit 0.
- [ ] Commit with `git commit -m "feat(delivery): add canonical dispatch batches"`.

### Task 3: Scoped Delivery Map and Rider Reads

**Files:**

- Create: `apps/core/src/delivery/application/get-delivery-map.ts`
- Create: `apps/core/src/delivery/application/get-delivery-map-detail.ts`
- Create: `apps/core/src/delivery/application/get-eligible-riders.ts`
- Test: matching integration tests

**Interfaces:**

- Consumes migration `0043` and Task 1 DTOs.
- Produces authorized projections with no raw snapshot JSON or Better Auth row leakage.

- [ ] Write integration fixtures spanning two locations, two cycles, Instant, assigned/unassigned/retry/terminal jobs, and active/inactive riders.
- [ ] Assert location plus `delivery.read` scope, mode/cycle filtering, all open pins, assigned visibility, Core-derived selectability, and protected detail access.
- [ ] Assert rider candidates are canonical active riders in scope and include open workload counts.
- [ ] Run focused tests; expect failures for missing queries.
- [ ] Implement purpose-built SQL/projection mapping and stable ordering; parse snapshots only in Core.
- [ ] Re-run focused tests; expect exit 0.
- [ ] Commit with `git commit -m "feat(delivery): add scoped dispatch map reads"`.

### Task 4: Non-optimizing Mapbox Route Preview

**Files:**

- Create: `apps/core/src/geography/ports/route-preview.ts`
- Create: `apps/core/src/geography/infrastructure/mapbox-route-preview.ts`
- Create: `apps/core/src/delivery/application/preview-delivery-batch-route.ts`
- Test: matching unit/integration tests

**Interfaces:**

- Produces `RoutePreviewPort.preview({ origin, orderedDestinations })` returning provider-neutral geometry/meters/seconds/legs.

- [ ] Write adapter tests asserting `mapbox/driving`, origin first, submitted destination order unchanged, `geometries=geojson`, and a maximum of 25 total coordinates.
- [ ] Write application tests proving coordinates are loaded from authoritative fulfillment/stops, not accepted from the client.
- [ ] Cover no route, timeout, malformed geometry, and provider unavailability as warning-class results.
- [ ] Run focused tests; expect failures for missing port/adapter/service.
- [ ] Implement the separate adapter without changing the delivery-fee `RouteDistancePort`.
- [ ] Re-run focused tests; expect exit 0.
- [ ] Commit with `git commit -m "feat(delivery): preview manual delivery routes"`.

### Task 5: Atomic Create-and-Assign Command

**Files:**

- Create: `apps/core/src/delivery/application/create-and-assign-delivery-batch.ts`
- Create: `apps/core/src/delivery/infrastructure/d1-delivery-dispatch-repository.ts`
- Modify: Delivery state-machine/domain service and Core entrypoint validation
- Test: `apps/core/src/delivery/application/create-and-assign-delivery-batch.integration.test.ts`

**Interfaces:**

- Consumes ordered job/version pairs and canonical rider ID.
- Produces one assigned `DeliveryBatchView` or a stable all-or-nothing error.

- [ ] Write tests for one and 24 deliveries, empty/25 selections, mixed location/mode/cycle, duplicate jobs, terminal/assigned jobs, inactive rider, wrong scope, missing coordinates, stale versions, idempotent replay, idempotency conflict, and concurrent assignment.
- [ ] Assert no batch/stop/job mutation remains after any failed validation or CAS guard.
- [ ] Assert the successful transaction records sequences 1..N, legal batch/job transitions, rider assignment, events, and audit metadata.
- [ ] Run the focused integration test; expect failure because the command is missing.
- [ ] Implement preflight reads plus one guarded D1 batch transaction and existing idempotency/audit patterns.
- [ ] Wire `delivery.manage` plus location authorization in Core; never accept rider auth user IDs as canonical assignment input.
- [ ] Re-run focused tests; expect exit 0.
- [ ] Commit with `git commit -m "feat(delivery): create and assign delivery batches"`.

### Task 6: Web APIs and Pure Selection Geometry

**Files:**

- Create: `apps/web/app/api/admin/delivery-map/route.ts`
- Create: `apps/web/app/api/admin/delivery-map/detail/route.ts`
- Create: `apps/web/app/api/admin/delivery-map/route-preview/route.ts`
- Create: `apps/web/app/api/admin/delivery-batches/route.ts`
- Create: `apps/web/lib/maps/delivery-selection.ts`
- Test: route tests and `delivery-selection.test.ts`

**Interfaces:**

- Produces `pinsInsideBounds(pins, bounds)` with inclusive boundaries and thin typed adapters.

- [ ] Write route tests for required location/mode/cycle, permission error forwarding, idempotency key, 1..24 entries, and expected versions.
- [ ] Write pure geometry tests for inside/outside/boundary, reversed drag corners, duplicate coordinates, and ineligible pins.
- [ ] Run focused Web tests; expect failures for missing routes/helper.
- [ ] Implement thin Service Binding adapters and inclusive coordinate filtering; do not put domain eligibility in Web.
- [ ] Re-run focused tests; expect exit 0.
- [ ] Commit with `git commit -m "feat(admin): add dispatch map adapters"`.

### Task 7: Admin Dispatch Map Workspace

**Files:**

- Create: `apps/web/components/admin/delivery/dispatch-map.tsx`
- Create: `apps/web/components/admin/delivery/selected-deliveries-drawer.tsx`
- Create: `apps/web/components/admin/delivery/delivery-order-list.tsx`
- Modify: `apps/web/app/admin/delivery/page.tsx`
- Test: component tests and `apps/web/tests/admin-delivery-map.spec.ts`

**Interfaces:**

- Consumes Plan 1 map foundation, Task 1 DTOs, and Task 6 adapters.
- Produces synchronized map/list selection and the final atomic command UX.

- [ ] Write tests for filters, all open pins, clusters/legend, assigned styling, Select Area activation/cancel, map/table synchronization, 24 limit, selection clearing, protected detail, pointer and keyboard ordering, preview warning, rider workload, submit, success refresh, and stale conflict recovery.
- [ ] Run focused tests; expect failures for missing components/workspace behavior.
- [ ] Implement a zero-pitch/bearing dispatch map, geographic rectangle bounds, accessible table checkboxes, selected drawer, route LineString, and non-color status labels.
- [ ] Submit one `createAndAssignDeliveryBatch` command only after explicit review.
- [ ] Keep the table workflow functional when Mapbox fails to load.
- [ ] Re-run component and Playwright tests; expect exit 0.
- [ ] Commit with `git commit -m "feat(admin): add map-based delivery dispatch"`.

### Task 8: Plan Verification

- [ ] Run focused contract/Core/Web tests for this plan.
- [ ] Run `pnpm format:check`, `pnpm naming:check`, `pnpm migration:check`, `pnpm lint`, and `pnpm typecheck`.
- [ ] Run `pnpm --filter @freshmarkets/web check:vinext` and `pnpm -r build`.
- [ ] Run the Admin dispatch Playwright flow against the configured local fixture.
- [ ] Inspect `git diff --check`, migration preservation, and staged files; confirm no route optimization/live tracking and no unrelated Admin Catalog edits.
- [ ] Commit descriptive documentation/status follow-up only after all verification evidence is clean.
