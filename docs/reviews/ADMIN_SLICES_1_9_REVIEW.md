# Admin Slices 1–9 Review

**Review date:** 2026-08-29  
**Reviewed revision:** `33c1d70` (`main`)  
**Scope:** Admin Foundation, IAM, Customers, Promotions, Catalog/Inventory, Finance, Operations, Analytics, and Readiness.  
**Mode:** Read-only review. No implementation code was changed.

## Verdict

The program is not release-ready. Automated unit/integration suites and type checks pass, but the review found **3 critical**, **22 important**, and **5 minor** problems. The first remediation pass should address cancellation idempotency, active-price integrity, procurement concurrency, and catalog unit/SKU truth before expanding the Admin surface.

## Remediation disposition (2026-08-29)

The verdict above is retained as the original review baseline. The authorized remediation is now
implemented. “Fixed” below means the reported defect has a code or documentation correction plus
focused automated coverage; final release evidence remains subject to the readiness matrix.

| Finding | Status | Remediation evidence                                                                    |
| ------- | ------ | --------------------------------------------------------------------------------------- |
| C1      | Fixed  | Cancellation replay is aggregate-bound and regression-tested.                           |
| C2      | Fixed  | Price writes close prior active intervals atomically and reject overlap.                |
| C3      | Fixed  | Procurement generation uses guarded uniqueness/CAS with concurrency coverage.           |
| I1      | Fixed  | Privacy mutation, Audit, and idempotency share one guarded transaction.                 |
| I2      | Fixed  | Material Admin writes use the guarded atomic command pattern.                           |
| I3      | Fixed  | Invitation revocation calls its purpose-built route.                                    |
| I4      | Fixed  | Staff detail exposes profile, access, role, scope, and session commands.                |
| I5      | Fixed  | Staff scopes validate authoritative geography.                                          |
| I6      | Fixed  | Customer summaries count only committed Orders.                                         |
| I7      | Fixed  | Scope selection is explicit and scope-load failure is visible.                          |
| I8      | Fixed  | Audit links resolve to an implemented detail read model.                                |
| I9      | Fixed  | BFF handlers delegate validated normalized input.                                       |
| I10     | Fixed  | System Membership/Promotion codes are reserved.                                         |
| I11     | Fixed  | Promotion grants and command completion are transaction/uniqueness guarded.             |
| I12     | Fixed  | Unit creation persists exact canonical integer conversion ratios.                       |
| I13     | Fixed  | SKU creation requires authoritative integer sell/base quantities.                       |
| I14     | Fixed  | Sourcing uses only the locked canonical vocabulary.                                     |
| I15     | Fixed  | UI commands use Core-returned aggregate versions.                                       |
| I16     | Fixed  | Resolved issues are terminal; reopen is removed and tested illegal.                     |
| I17     | Fixed  | Fulfillment and Delivery expose canonical guarded actions.                              |
| I18     | Fixed  | Analytics refuses mixed currency/base-unit scalar results.                              |
| I19     | Fixed  | Cursor pagination reaches later records across Admin lists.                             |
| I20     | Fixed  | Stable command intent coalesces submits and survives ambiguous failures.                |
| I21     | Fixed  | Deterministic authenticated Web/Core/D1 coverage supplements command integration tests. |
| I22     | Fixed  | Reports make no unsupported performance claim; Web Vitals are explicitly non-gating.   |
| M1      | Fixed  | Invalid privacy filters fail validation instead of widening results.                    |
| M2      | Fixed  | Material destructive actions require consequence/reason confirmation.                   |
| M3      | Fixed  | Receiving exceptions use stable ordering and canonical age.                             |
| M4      | Fixed  | Readiness child processes use `shell: false`; Windows shim behavior is tested.          |
| M5      | Fixed  | Program map, implementation status, and readiness reports are reconciled.               |

## Critical findings

### C1 — Slice 6: an idempotency key can cancel one order and falsely report/audit another

[`cancel-order.ts`](../../apps/core/src/orders/application/cancel-order.ts#L45) stores the constant request hash `cancel`, and a successful replay returns only the previous state from `result_reference`. The key is not bound to `orderId`, `expectedVersion`, or `reasonCode`. Reusing the key with another order therefore returns success instead of `IDEMPOTENCY_CONFLICT`; the Admin wrapper can then append a cancellation audit for the second, unchanged order.

**Recommended fix:** hash the full canonical command, persist the canceled order ID as the result reference, validate the hash on every replay, and make the Admin audit describe the aggregate actually changed. Add a regression test that reuses one key across two orders and proves the second order and its audit log remain unchanged.

### C2 — Slice 5: setting a price creates overlapping active authoritative prices

[`catalog-commands.ts`](../../apps/core/src/admin/application/catalog-commands.ts#L729) inserts every price with `valid_to = NULL` but never closes the prior active version. [`catalog/service.ts`](../../apps/core/src/catalog/service.ts#L313) groups by SKU while selecting non-aggregated amount and currency alongside `MAX(version)`, which does not guarantee that the returned amount belongs to that version.

**Recommended fix:** close the previous active price and insert its successor atomically, enforce non-overlap for the same precedence key, and read the winning row with a deterministic ordered query/window function. Test repeated pricing, future-effective pricing, and concurrent writers.

### C3 — Slice 7: concurrent procurement generation can duplicate demand

Admin demand is calculated before the write, but [`create-procurement-requirement.ts`](../../apps/core/src/procurement/application/create-procurement-requirement.ts#L19) ignores the supplied `expectedVersion`; the schema also lacks a uniqueness guard for cycle/location/inventory-pool. Two different idempotency keys can both insert a requirement for the same demand.

**Recommended fix:** enforce one active requirement per cycle/location/pool (or another explicit versioned aggregate), consume `expectedVersion` in a compare-and-swap transaction, and calculate/claim demand inside the guarded operation. Add a two-writer concurrency test.

## Important findings

### I1 — Slice 3: a stale privacy action can leave false success and audit evidence

[`customer-commands.ts`](../../apps/core/src/admin/application/customer-commands.ts#L748) batches the audit event and successful idempotency completion with a guarded update, but it does not make those statements conditional on the update changing a row. A stale update can return `STALE_VERSION` after recording that the action succeeded.

**Recommended fix:** place the transition behind a transaction/guard that makes audit and idempotency success conditional on the CAS succeeding; test a stale writer and assert no audit/success record is created.

### I2 — Slices 2–7: several business writes are not atomic with audit and idempotency

Examples include staff/role updates, session revocation, promotion grants, Admin order cancellation/membership changes, and operational commands. Some mutate first and append audit later; some ignore audit failure. This permits authoritative state without the required evidence, or evidence without the state.

**Recommended fix:** establish one command transaction pattern: claim key, guarded mutation/effects, audit, and idempotency completion succeed or fail together. Apply it to every material Admin command and add injected-failure tests at each boundary.

### I3 — Slice 2: invitation revocation calls the invitation-creation endpoint

[`staff/page.tsx`](../../apps/web/app/admin/staff/page.tsx#L181) posts `{ invitationId, reason }` to the invitation route, whose request shape creates an invitation. The UI ignores the result and reloads, so the displayed revoke control does not revoke anything.

**Recommended fix:** add a dedicated revoke BFF/RPC command with capability, reason, idempotency, and audit enforcement; show the result instead of unconditional reload. Cover it with a browser flow.

### I4 — Slice 2: staff editing and scope assignment are not operable from Web

Core exposes staff update and scope commands, but the individual staff Web route is read-only and the detail screen only renders assigned scopes. The implemented Admin program therefore cannot perform central IAM tasks from its UI.

**Recommended fix:** add purpose-built edit/status and scope-assignment controls using Core-derived versions and allowed actions. Verify location/global capability boundaries in authenticated browser tests.

### I5 — Slice 2: staff scope commands accept nonexistent market/location IDs

The scope command validates shape and authorization but not the referenced geography, and the scope tables have no geography foreign keys.

**Recommended fix:** validate market/location existence and active status in Core before assignment, then add referential constraints where compatible with the ownership model. Test unknown, inactive, and cross-market locations.

### I6 — Slice 3: customer commerce summaries count uncommitted orders

[`list-admin-customers.ts`](../../apps/core/src/admin/application/list-admin-customers.ts#L34) computes `orderCount` and `lastOrderAt` across every `grocery_order` state. Draft/failed/uncommitted records can therefore inflate CRM history.

**Recommended fix:** define these fields from committed orders and the canonical commitment timestamp, then use the same definition in list and detail reads. Add mixed-state fixtures.

### I7 — Slices 1 and 8: scope selection is implicit and failures are hidden

[`admin-context-provider.tsx`](../../apps/web/app/admin/admin-context-provider.tsx#L66) turns a failed scope query into an empty list. The shell provides no explicit active-scope selector, and [`analytics-access.ts`](../../apps/core/src/analytics/application/analytics-access.ts#L42) silently chooses `context.scopes[0]` when a metric request omits scope. Multi-scope staff can unknowingly view or act in the wrong scope.

**Recommended fix:** make scope loading failure explicit, require an intentional selected scope for scoped screens/queries, persist it predictably, and reject ambiguous requests rather than selecting the first assignment.

### I8 — Slice 1: audit detail links lead to a missing page

[`audit/page.tsx`](../../apps/web/app/admin/audit/page.tsx#L313) links to `/admin/audit/{id}`, while no matching Admin detail page exists even though the detail API exists.

**Recommended fix:** implement the detail route with redacted before/after data and permission/error states, or remove the links until it exists. Add route coverage.

### I9 — Slice 1+: validated normalized input is frequently discarded

Core entrypoints validate with schemas that trim/normalize values but then delegate the original object; [`index.ts`](../../apps/core/src/index.ts#L903) and promotion creation at [`index.ts`](../../apps/core/src/index.ts#L1191) are examples. Validation can therefore approve one value while application code receives another.

**Recommended fix:** delegate `validation.data` consistently and add contract tests for whitespace, normalized enum/text values, and strict timestamps.

### I10 — Slice 4: promotion codes can collide with reserved membership benefit codes

[`promotion-commands.ts`](../../apps/core/src/admin/application/promotion-commands.ts#L61) only requires upper-snake-case. It does not reject `INTRO_TRIAL` or other system-owned benefit codes even though grants/redemptions are joined by code and the contract says the trial authority is excluded.

**Recommended fix:** maintain an explicit reserved-code set at the domain boundary, reject it for Admin-managed definitions, and migrate joins toward stable promotion IDs. Test every reserved value.

### I11 — Slice 4: grant uniqueness and command completion are not protected

[`promotion-commands.ts`](../../apps/core/src/admin/application/promotion-commands.ts#L448) inserts a grant, then completes idempotency separately. The implemented table also does not enforce the canonical one-grant-per-promotion/customer relationship. Different keys can create duplicate live grants, and a partial failure can strand the command.

**Recommended fix:** add the canonical uniqueness constraint and make grant, audit, and idempotency completion one guarded operation. Define whether an existing grant replays, conflicts, or renews.

### I12 — Slice 5: unit creation cannot represent canonical conversions

[`AdminUnitCreateRequest`](../../packages/contracts/src/admin-catalog.ts#L110) contains only code/name/dimension/symbol, and [`catalog-commands.ts`](../../apps/core/src/admin/application/catalog-commands.ts#L206) writes the legacy `unit` table. The canonical contract requires base code plus exact numerator/denominator conversion.

**Recommended fix:** implement canonical unit definitions and exact same-dimension conversion fields; reject cross-dimension or non-positive conversions. Do not treat pack/bunch labels as units.

### I13 — Slice 5: SKU creation omits authoritative sell quantity

The create request lacks `sellQuantity`, and [`catalog-commands.ts`](../../apps/core/src/admin/application/catalog-commands.ts#L419) omits `sell_quantity`, leaving the database default of `1`. A 250 g SKU may consume 250 g while being represented as a 1 g sell unit.

**Recommended fix:** require and persist positive integer `sellQuantity`, validate it against unit dimension and SKU consumption policy, and expose it consistently in command/read DTOs. Test mass, volume, and count SKUs.

### I14 — Slice 5: sourcing vocabulary contradicts the locked domain model

[`admin-catalog.ts`](../../packages/contracts/src/admin-catalog.ts#L157) exposes `PLANNED_PROCUREMENT` and `HYBRID`, while the canonical values are `STOCKED`, `PLANNED`, `ON_DEMAND`, and `MIXED`.

**Recommended fix:** migrate storage/contracts/read models to the canonical closed set and provide an explicit data migration for legacy rows. Add exhaustive enum/combination tests.

### I15 — Slice 5: UI hard-codes aggregate versions

Inventory adjustments submit version `0` in [`inventory/page.tsx`](../../apps/web/app/admin/inventory/page.tsx#L89); product and availability actions submit `1` in [`products/[product-id]/page.tsx`](../../apps/web/app/admin/catalog/products/%5Bproduct-id%5D/page.tsx#L155). Relevant DTOs do not consistently expose current versions, and product status handling does not reliably consume the version.

**Recommended fix:** return current aggregate versions and allowed actions from Core, submit those exact versions, surface `STALE_VERSION`, and refresh without losing the operator's intent.

### I16 — Slice 6: the issue lifecycle reopens a terminal resolved issue

[`admin-finance.ts`](../../packages/contracts/src/admin-finance.ts#L23) publishes `REOPEN`, and Core/UI implement `RESOLVED -> INVESTIGATING`, while the approved slice plan defines `RESOLVED` as terminal.

**Recommended fix:** remove `REOPEN` from the contract/state machine/UI or first approve and document a canonical lifecycle change. Add an illegal-transition test from `RESOLVED`.

### I17 — Slice 7: fulfillment and delivery use simplified non-canonical lifecycles

[`state-machines.ts`](../../apps/core/src/commerce/state-machines.ts#L55) models fulfillment as `PENDING -> PICKING -> PACKED` and delivery as `PENDING -> DISPATCHED -> DELIVERED|FAILED`, skipping canonical assignment, staging/en-route/arrival, and related operational states.

**Recommended fix:** reconcile contracts, persistence, commands, queues, and UI with the canonical state machines before operational usage; migrate existing state safely and test every legal/illegal transition.

### I18 — Slice 8: metrics can mix incompatible currencies and base units

[`metric-queries.ts`](../../apps/core/src/analytics/application/metric-queries.ts#L180) sums successful refunds across currencies when no currency dimension is supplied. The shrinkage query at [`metric-queries.ts`](../../apps/core/src/analytics/application/metric-queries.ts#L248) likewise sums grams, milliliters, and pieces when no base unit is supplied.

**Recommended fix:** require a currency/base-unit dimension, return a dimensioned series, or mark the metric unavailable when more than one dimension is present. Never publish a mixed scalar. Add multi-currency and multi-unit fixtures.

### I19 — Slices 2–8: many paginated records are unreachable in Web

Core returns cursors for grants/redemptions and multiple customer, finance, and operations queues, but most pages never consume `nextCursor`. Operators can only see the first page.

**Recommended fix:** use the shared cursor-pagination primitive everywhere a paginated contract is exposed, preserve filters/scope across pages, and add browser tests with more than one page of rows.

### I20 — Slices 2–7: command UIs do not provide stable retry behavior

Most click handlers generate `crypto.randomUUID()` at submission time and do not disable duplicate submission or preserve the key through an ambiguous retry. Double clicks or network uncertainty can issue distinct commands.

**Recommended fix:** create one key per operator intent, retain it until a definitive response, disable duplicate submission while pending, and give explicit retry/recovery feedback.

### I21 — Slices 2–6: authenticated business-flow browser coverage is missing

The Admin Playwright inventory lists 21 Admin tests, mostly unauthenticated or mocked. Catalog, Customers, Promotions, Staff, and Finance do not exercise authenticated command journeys; the environment-gated auth-email flow remains unprovisioned.

**Recommended fix:** provision a deterministic authenticated staff fixture and cover capability denial, selected scope, stale version, idempotent retry, and at least one successful command per slice.

### I22 — Slice 9: readiness and performance were reported without clean evidence

The readiness report contains no usable LCP/INP/CLS measurements, references a nonexistent `/admin/operations` route, and reports the format gate as failed on 44 files while still presenting overall readiness as pass. This does not meet the measured-evidence acceptance criterion.

**Recommended fix:** rerun the gate against real representative routes with authenticated data, record reproducible Web Vitals/network evidence, require every mandatory command to exit cleanly, and label unexecuted gates as blocked—not passed.

**Final decision:** browser performance is not part of the approved API/business-logic release gate. The readiness report makes no Web Vitals claim; functional Admin browser coverage remains mandatory and passes.

## Minor findings

### M1 — Slice 3: invalid privacy status filters silently become “all”

**Recommended fix:** reject unknown query values with `VALIDATION_FAILED` and cover malformed URLs.

### M2 — Slice 6: destructive actions lack impact confirmation

Inventory adjustment, cancellation, and refund actions do not consistently show quantity/amount, scope, and irreversible consequences before submission.

**Recommended fix:** use the shared confirmation dialog and require a reason for every high-impact command.

### M3 — Slice 7: receiving exceptions use `rowid` ordering and have no age

[`list-operational-exceptions.ts`](../../apps/core/src/audit/application/list-operational-exceptions.ts#L57) uses SQLite `rowid` as the queue chronology and explicitly returns `ageMinutes: null`.

**Recommended fix:** persist/use a real UTC created/updated timestamp and build the cursor and age from it.

### M4 — Slice 9: readiness tooling invokes `.cmd` through a shell

[`verify-worker-readiness.mjs`](../../scripts/verify-worker-readiness.mjs#L18) triggers Node `DEP0190` because `spawnSync` combines an argument array with `shell: true`.

**Recommended fix:** resolve the platform executable without a shell, or pass one safely quoted command string only when unavoidable.

### M5 — Program documentation is internally stale

The program map still says Slice 6 is unauthorized and omits later implementation state; `IMPLEMENTATION_STATUS.md` duplicates the Slice 5 heading; the performance report names a route that does not exist.

**Recommended fix:** reconcile descriptive status/review documents with the canonical plan and actual route tree after code remediation. Keep historical claims clearly dated.

## Recommended remediation order

1. Fix C1–C3 and add regression/concurrency tests.
2. Repair canonical catalog truth: I12–I15.
3. Standardize atomic Admin commands and stale-write behavior: I1–I2, I11, I20.
4. Reconcile scope and state-machine behavior: I7, I16–I18.
5. Complete missing/defective UI workflows and pagination: I3–I5, I8, I19.
6. Provision authenticated end-to-end coverage and repeat Slice 9 readiness with real measurements.

## Fresh validation evidence

| Check                       | Result                                                         |
| --------------------------- | -------------------------------------------------------------- |
| Contract tests              | 36 passed across 14 files                                      |
| Web tests                   | 114 passed across 25 files                                     |
| Core tests                  | 419 passed across 89 files                                     |
| Workspace typecheck         | Passed                                                         |
| Naming check                | Passed                                                         |
| Migration check             | Passed                                                         |
| Readiness security verifier | Passed                                                         |
| Worker dry-run verifier     | Passed with Node `DEP0190` warning                             |
| Lint                        | Exit 0 with 29 warnings                                        |
| Format check                | **Failed: 44 files**                                           |
| Playwright discovery        | 38 total; 21 Admin tests, predominantly unauthenticated/mocked |

Passing automated tests do not cover the critical replay/concurrency cases described above and do not override the failed formatting/performance/authenticated-browser gates.
