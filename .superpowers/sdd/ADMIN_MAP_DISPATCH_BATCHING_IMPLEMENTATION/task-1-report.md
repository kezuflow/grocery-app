# Task 1 Report: Delivery Map and Batch Contracts

## Status

Task 1 is implemented and verified in the isolated
`E:/GithubProjects/freshmarkets/.worktrees/maps-program` linked worktree. The change adds only the
provider-neutral dispatch contract surface and its canonical documentation. It does not create
migration `0043`, implement Core/Web behavior, add a route provider, or start Tasks 2–8.

## Genuine RED evidence

All commands ran from the isolated worktree and their exit codes/output were inspected directly.

1. Initial focused compiler RED: `pnpm --filter @freshmarkets/contracts typecheck` — exit 1.
   TypeScript reported missing `./delivery-maps`, missing exact-shape types, and absent
   `CoreServiceBinding` members `getDeliveryMap`, `getDeliveryMapDetail`, `getEligibleRiders`,
   `previewDeliveryBatchRoute`, and `createAndAssignDeliveryBatch`.
2. Public-export mutation RED: after changing the contract test to consume the package public
   index and temporarily removing the export, the same typecheck exited 1 with twelve missing
   public delivery-map exports. Restoring only the index export exposed the next intentional RED:
   `ROUTE_TIMEOUT` was not in the warning union and the invalid `PENDING` map filter left an unused
   `@ts-expect-error`; typecheck exited 1.
3. Preview-outcome RED: the final self-review added a negative compiler case for an `AVAILABLE`
   preview with null geometry/summary. Contracts typecheck exited 1 because the expected-error
   directive was unused, proving the original DTO admitted that inconsistent state. The minimal
   discriminated union then made `AVAILABLE` require geometry/numeric summary and `WARNING` require
   null geometry/summary plus a bounded warning.
4. Full-suite test-harness RED: the first `pnpm --filter @freshmarkets/contracts test` after
   formatting exited 1 (14 passed files, 1 failed). Its embedded compiler check proved that oxfmt
   had moved two expected-error comments away from the diagnostic property/`satisfies` lines. The
   comments were relocated to the actual compiler diagnostic lines and reformatted before any gate
   was rerun.

## Focused GREEN evidence

- First minimal GREEN: contracts typecheck exit 0, then
  `pnpm --filter @freshmarkets/contracts test -- delivery-maps.test.ts core-service.test.ts` — exit
  0; 2 files and 10 tests passed.
- Final focused GREEN after public-export and bounded-vocabulary hardening: the same typecheck and
  focused test commands exited 0; 2 files and 10 tests passed.
- The negative compiler cases cover missing cycle context, missing job version, missing
  idempotency, invalid status filter, Web-supplied preview coordinates, Better Auth user identity,
  raw address snapshot JSON, and provider identity/payload leakage.

## Contract surface

`packages/contracts/src/delivery-maps.ts` now publishes:

- exact approved `DeliveryMapPin`, `OrderedDeliveryVersion`, and
  `CreateAndAssignDeliveryBatchRequest` relationships;
- bounded `DeliveryMapView`, protected `DeliveryMapDetail`, `EligibleRiderView`,
  `BatchRoutePreview`, and `DeliveryBatchView` DTOs;
- authenticated `DeliveryMapRequest`, `DeliveryMapDetailRequest`, `EligibleRidersRequest`, and
  `PreviewDeliveryBatchRouteRequest` request types;
- manual ordered job/version pairs only for preview and assignment; neither accepts authoritative
  origin/destination coordinates;
- closed map status filters, batch states, legal Admin detail action, provider-neutral GeoJSON,
  summary/legs, and warning categories (`ROUTE_NOT_FOUND`, `ROUTE_TIMEOUT`, `ROUTE_UNAVAILABLE`,
  `ROUTE_INVALID_RESPONSE`).

`CoreServiceBinding` adds exactly these later-task methods:

- `getDeliveryMap`
- `getDeliveryMapDetail`
- `getEligibleRiders`
- `previewDeliveryBatchRoute`
- `createAndAssignDeliveryBatch`

`packages/contracts/src/index.ts` exports the new module as the public package surface. No D1,
Worker, provider, token, polygon, raw snapshot, fulfillment-ranking, or Better Auth row type is
imported or exposed.

## Canonical documentation rulings

- `DOMAIN_MODEL.md`: Delivery owns the map projection, protected detail, Core-derived selection,
  manual 1–24 ordering, non-optimizing/non-authoritative preview, canonical Rider identity, and the
  atomic all-or-nothing batch assignment.
- `STATE_MACHINES.md`: `CreateAndAssignDeliveryBatch` records legal
  `DRAFT -> READY -> ASSIGNED` batch transitions and legal
  `UNASSIGNED|RETRY_SCHEDULED -> ASSIGNED` job transitions in one guarded transaction. Preview
  causes no transition.
- `DATA_MODEL.md`: the conceptual stop model includes immutable coordinates/manual sequence, and
  future migration `0043_delivery_batches_and_map_stops.sql` owns forward-only convergence and
  preservation. No migration is created in this task.
- `API_CONTRACTS.md`: the five map/dispatch methods replace the target two-step create/assign API;
  reads require `delivery.read` plus location scope, assignment requires `delivery.manage` plus
  location scope, `SCHEDULED` requires a cycle, and `INSTANT` requires null cycle.
- The superseded two-step create/assign target is not retained as a second authority. Historical
  raw-snapshot and auth-user-ID operations contracts are explicitly compatibility-only until
  callers migrate and are unavailable to the map workspace.

## Fresh full verification

1. `pnpm --filter @freshmarkets/contracts typecheck` — exit 0.
2. `pnpm --filter @freshmarkets/contracts test` — exit 0; 15 files, 51 tests.
3. `pnpm format:check` — exit 0; 638 files matched.
4. `pnpm naming:check` — exit 0.
5. `pnpm migration:check` — exit 0; fresh apply and populated `0021 -> 0022` upgrade valid.
6. `pnpm lint` — exit 0; 19 pre-existing warnings, 0 errors.
7. `pnpm typecheck` — exit 0; all six participating workspace projects.
8. `pnpm test` — exit 0; 151 files and 753 tests: config 2, contracts 51, domain-shared 2,
   validation 2, Web 183, and Core 513.
9. `pnpm -r build` — exit 0; Core Wrangler dry-run and Web vinext build completed. Existing
   non-fatal plugin-timing and chunk-size advisories remain.
10. `git diff --check` — exit 0 before this report was written and is rerun before commit.

## Exact scoped files

- `.superpowers/sdd/ADMIN_MAP_DISPATCH_BATCHING_IMPLEMENTATION/task-1-report.md`
- `packages/contracts/src/delivery-maps.ts`
- `packages/contracts/src/delivery-maps.test.ts`
- `packages/contracts/src/index.ts`
- `packages/contracts/src/core-service.ts`
- `packages/contracts/src/core-service.test.ts`
- `docs/architecture/DOMAIN_MODEL.md`
- `docs/architecture/STATE_MACHINES.md`
- `docs/architecture/DATA_MODEL.md`
- `docs/architecture/API_CONTRACTS.md`

## Schema, preservation, and concerns

- Database/schema changes: none. Migrations `0041_admin_catalog_authoring.sql` and
  `0042_mapbox_address_confirmation.sql` are unchanged; no `0043` exists.
- The four pre-existing untracked Maps plan/spec inputs remain preserved and unstaged. No Admin
  application/design file or Plan 1 runtime file changed.
- TypeScript cannot encode the runtime 1–24 array bound or the relational rule
  `SCHEDULED => cycleId` / `INSTANT => cycleId null` while preserving the plan-mandated exact flat
  command shape. Task 5 must enforce both at the Core boundary and transaction preflight; the
  canonical API/domain/state documents make those runtime rules explicit.
- `DeliveryMapPin.status` remains `string` because the approved plan requires that exact shape;
  request filters and the other new purpose-built status fields use closed canonical vocabularies
  where the exact-shape lock does not apply.
- Historical auth-user-ID assignment and raw rider-read compatibility methods still exist on the
  implemented operations surface. This task documents their retirement boundary but does not
  remove them or migrate callers.
- Route preview is only a DTO in Task 1. No provider adapter, availability behavior, authorization,
  selection policy, persistence, or atomic command implementation is claimed.

Task 2 may rely on the canonical persistence ownership/rulings and all later tasks may rely only on
the DTOs and binding methods above, not on any runtime implementation.
