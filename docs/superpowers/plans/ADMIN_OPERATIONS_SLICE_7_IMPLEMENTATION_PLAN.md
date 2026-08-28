# Admin Operations Slice 7 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deliver the Admin Procurement, Receiving, Fulfillment, Delivery, fulfillment-mode configuration, and operational-exception workspaces over typed Core commands/read models.

**Architecture:** Core remains the only authority for procurement, receiving, fulfillment, delivery, mode configuration, authorization, and audit. Existing domain commands are composed behind capability- and location-scoped Admin application functions; Web exposes only thin same-origin BFF routes and operational UI. No raw-table contracts or client-side lifecycle transitions are introduced.

**Tech Stack:** Cloudflare Workers, D1, TypeScript, Drizzle IAM access checks, shared `@freshmarkets/contracts`, vinext/React, shadcn/ui primitives, Vitest, Playwright.

**Spec:** `docs/superpowers/specs/ADMIN_CRM_ANALYTICS_API_DESIGN.md`, with canonical behavior from `docs/architecture/DOMAIN_MODEL.md`, `docs/architecture/STATE_MACHINES.md`, `docs/architecture/DATA_MODEL.md`, and `docs/architecture/API_CONTRACTS.md`.

## Global Constraints

- `apps/core` is the only business, authorization, and D1 authority; Web uses typed Service Binding calls through thin BFF routes.
- Fulfillment mode is exactly `INSTANT` or `SCHEDULED`; `WEEKLY` is cadence only, and `INSTANT` never fabricates a cycle.
- Procurement demand, receiving quantities, fulfillment state, and delivery state remain separate state machines with explicit legal commands.
- Every material command requires capability/location scope, a stable idempotency key, expected aggregate version where concurrent, a reason where required, and an immutable audit event.
- Inventory and demand quantities are integer canonical base units; committed order snapshots are never rewritten by later configuration changes.
- Use keyset pagination and purpose-built DTOs; do not expose raw D1 rows or Better Auth records.
- Preserve explicit loading, empty, permission, unavailable, cutoff/capacity, stale, error, and pending states in Admin UI.

---

### Task 1: Operations contracts, authorization, and read models

**Files:**
- Create: `packages/contracts/src/admin-operations.ts`
- Modify: `packages/contracts/src/index.ts`, `apps/core/src/admin/application/operations-administration-access.ts`, `apps/core/src/admin/application/operations-reads.ts`, `apps/core/src/index.ts`
- Test: `packages/contracts/src/admin-operations.test.ts`, `apps/core/src/admin/application/admin-operations.integration.test.ts`

**Interfaces:**
- Produces `AdminOperationsService` methods: `getFulfillmentMode`, `activateFulfillmentMode`, `listProcurementRequirements`, `listReceivingSessions`, `listFulfillmentQueue`, `listDeliveryOperations`, and `listOperationalExceptions`.
- Produces DTOs `FulfillmentModeConfigurationView`, `ProcurementRequirementView`, `ReceivingSessionView`, `FulfillmentQueueView`, `DeliveryOperationsSummary`, and `OperationalExceptionPage` with location/cycle/status/version fields.
- Access requires the named capability (`procurement.read`, `receiving.manage`, `fulfillment.read`, `delivery.read`, or `fulfillment.manage`) plus an allowed market/location scope.

- [ ] **Step 1: Write failing contract and authorization tests** asserting DTO shapes, integer/version fields, location filtering, and forbidden global-vs-location scope behavior.
- [ ] **Step 2: Run focused tests and confirm the new methods/types are absent.**
- [ ] **Step 3: Implement contracts, access resolver, and Core read functions by composing `listProcurementQueue`, `listFulfillmentQueue`, `listDeliveryDispatch`, `getLocationMode`, and existing exception read models; map rows into DTOs without leaking raw columns.**
- [ ] **Step 4: Add CoreEntrypoint validation schemas and methods; run contract and Core integration tests until passing.**
- [ ] **Step 5: Commit with `feat(admin): add operations contracts and read models`.**

### Task 2: Explicit operations commands and mode configuration

**Files:**
- Create: `apps/core/src/admin/application/operations-commands.ts`
- Modify: `apps/core/src/fulfillment/application/location-mode.ts`, `apps/core/src/procurement/application/create-procurement-requirement.ts`, `apps/core/src/procurement/application/start-receiving.ts`, `apps/core/src/procurement/application/record-received-line.ts`, `apps/core/src/procurement/application/receive-procurement.ts`, `apps/core/src/operations/application/advance-fulfillment.ts`, `apps/core/src/operations/application/advance-delivery.ts`, `apps/core/src/index.ts`
- Test: `apps/core/src/admin/application/admin-operations-commands.integration.test.ts`, `apps/core/src/fulfillment/application/location-mode.integration.test.ts`

**Interfaces:**
- Produces commands `activateAdminFulfillmentMode`, `aggregateAdminProcurementDemand`, `startAdminReceiving`, `recordAdminReceivedLine`, `completeAdminReceiving`, `advanceAdminFulfillment`, `advanceAdminDelivery`, and `resolveAdminOperationalException`.
- Each command accepts `{ requestId, headers, locationId, expectedVersion?, idempotencyKey, reason? }` plus domain-specific fields and returns the corresponding DTO from Task 1.
- Commands delegate to canonical state-machine functions and reject illegal transitions, stale versions, invalid quantities, unsupported mode/cadence combinations, and out-of-scope locations.

- [ ] **Step 1: Add failing tests for mode activation CAS/idempotency, receiving accepted/rejected quantity accounting, fulfillment/delivery illegal transitions, and exception resolution audit.**
- [ ] **Step 2: Run the focused tests to capture the expected failures.**
- [ ] **Step 3: Implement the Admin command wrappers and fill only domain gaps discovered by the tests; keep all writes explicit and auditable.**
- [ ] **Step 4: Run focused and existing procurement/receiving/fulfillment/delivery integration suites, then typecheck Core.**
- [ ] **Step 5: Commit with `feat(admin): add operations commands`.**

### Task 3: Thin BFF routes and operational workspaces

**Files:**
- Create: `apps/web/app/api/admin/procurement/route.ts`, `apps/web/app/api/admin/receiving/route.ts`, `apps/web/app/api/admin/fulfillment/route.ts`, `apps/web/app/api/admin/delivery/route.ts`, `apps/web/app/api/admin/fulfillment-mode/route.ts`, `apps/web/app/api/admin/exceptions/route.ts`, and command subroutes under those resources.
- Create: `apps/web/app/admin/procurement/page.tsx`, `apps/web/app/admin/receiving/page.tsx`, `apps/web/app/admin/fulfillment/page.tsx`, `apps/web/app/admin/delivery/page.tsx`, `apps/web/app/admin/settings/fulfillment-mode/page.tsx`.
- Modify: `apps/web/app/admin/issues/page.tsx` only to link shared operational exceptions where appropriate.
- Test: `apps/web/app/api/admin/operations-routes.test.ts`, `apps/web/tests/admin-operations.spec.ts`

**Interfaces:**
- Routes forward cookies/headers with `requestHeaders(request)`, parse query/body input, require idempotency headers for writes, and call only `coreClient(env.CORE)` methods.
- UIs consume Task 1 DTOs, show queue/deadline/owner/location context, and submit Task 2 commands with fresh idempotency keys and current versions.

- [ ] **Step 1: Write route delegation tests and component assertions for loading, empty, error, permission, stale, and successful command states.**
- [ ] **Step 2: Run Web tests and confirm the routes/pages fail before implementation.**
- [ ] **Step 3: Implement thin routes and responsive queue/detail/configuration screens using existing shadcn primitives and admin-shell components.**
- [ ] **Step 4: Run Web typecheck, focused route tests, vinext build, and gated Playwright smoke/authenticated journeys.**
- [ ] **Step 5: Commit with `feat(admin): add operations workspaces`.**

### Task 4: Cross-domain exception convergence, documentation, and stop gate

**Files:**
- Modify: `apps/core/src/audit/application/list-operational-exceptions.ts`, `apps/core/src/admin/application/operations-reads.ts`, `packages/contracts/src/admin-operations.ts`, `docs/product/IMPLEMENTATION_STATUS.md`
- Test: `apps/core/src/admin/application/operations-exception.integration.test.ts`, `apps/web/tests/admin-operations.spec.ts`

**Interfaces:**
- `listOperationalExceptions` returns one typed queue with source (`PROCUREMENT`, `RECEIVING`, `FULFILLMENT`, `DELIVERY`), severity, age, owner, location, reason, and permitted next actions; it never owns source state.
- Resolution commands return the source-specific read model and append audit evidence; unsupported actions remain unavailable.

- [ ] **Step 1: Write failing convergence tests proving source ownership, location scope, legal action sets, and audit visibility.**
- [ ] **Step 2: Implement the derived exception adapter and update descriptive implementation status only after canonical contracts agree.**
- [ ] **Step 3: Run the complete required validation set: contracts/Core/Web tests and typechecks, Core/Web builds, naming, migration, formatting, diff checks, and relevant Playwright flows.**
- [ ] **Step 4: Compare every Slice 7 acceptance item against the canonical docs; record any environment-gated browser tests or explicit deviations.**
- [ ] **Step 5: Commit with `feat(admin): converge operations exceptions` and stop before Slice 8 Analytics.**

## Stop Gate

Slice 7 is complete only when the four tasks' commits are on `main`, Core and Web builds pass, all focused and regression tests pass, capability/location scope and idempotency/CAS behavior are covered, operational exception actions are audited, and the required Admin workspaces expose no raw-table mutation. Do not begin Analytics metric definitions or Overview work in this slice.
