# Admin Foundation Slice 1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Establish canonical admin capabilities, scoped admin context, authorized Audit reads, thin
Web BFF routes, and the capability-aware admin shell foundation without beginning Staff CRUD or any
later domain workspace.

**Architecture:** Add one `AdminFoundationService` to the shared Service Binding contract. Core
derives staff identity/capabilities/scopes from Better Auth plus Application IAM, serves
purpose-built context/scope/Audit read models from D1, and Web exposes thin same-origin adapters.
The shell renders only navigation returned by Core; it does not infer permissions.

**Tech Stack:** TypeScript 7, Cloudflare WorkerEntrypoint RPC, D1/SQLite, Drizzle for IAM lookup,
vinext App Router, React 19, Tailwind CSS 4, shadcn/ui source components, Vitest 4, Cloudflare Vitest
pool, and Playwright.

**Spec:** `docs/superpowers/specs/ADMIN_CRM_ANALYTICS_API_DESIGN.md`

## Global Constraints

- Work only on Slice 1. Do not create Staff/Customer/Promotion/Catalog/Order/Payment/Analytics CRUD.
- Preserve every pre-existing dirty or untracked file. Never edit or stage unrelated storefront work.
- `apps/web/app/globals.css` is dirty at plan-writing time. Task 7 must stop unless that file is
  clean or the owner explicitly authorizes reconciliation; never overwrite user-owned hunks.
- Do not create a feature branch or PR. Use `main` and stage only files named by each task.
- Web never accesses D1 or duplicates authorization/business rules.
- No public REST/CORS; `/api/admin/*` routes are same-origin BFF adapters.
- Better Auth rows are not Staff/Customer DTOs and no password/session token is returned.
- Every list is bounded and cursor-paginated where applicable.
- Historical colon-form permission rows remain compatibility data; new source and DTOs use canonical
  dot-form capabilities.
- Do not add Durable Objects, Workflows, KV, Queues, or public endpoints.
- Follow current Cloudflare guidance: Service Bindings over public fetch, generated Worker types, no
  mutable request state at module scope, no floating promises, and structured errors.

## File ownership map

- `packages/contracts/src/admin-foundation.ts`: capability vocabulary and Slice 1 DTOs.
- `apps/core/migrations/0026_admin_foundation.sql`: permission mapping and Audit read fields.
- `apps/core/src/admin/application/get-admin-context.ts`: Staff context/navigation.
- `apps/core/src/admin/application/list-admin-scopes.ts`: permitted scope options.
- `apps/core/src/audit/application/list-audit-events.ts`: scoped cursor list and redaction.
- `apps/core/src/audit/application/get-audit-event.ts`: scoped Audit detail.
- `apps/web/app/api/admin/{context,scopes,audit}`: thin browser adapters.
- `apps/web/app/admin/admin-context-provider.tsx`: client loading/error/context boundary.
- `apps/web/components/admin/admin-navigation.ts`: presentation mapping from Core navigation.
- `apps/web/components/admin/admin-shell.tsx`: shell consuming Core-provided items.
- `apps/web/app/admin/audit/page.tsx`: initial Audit workspace.

---

### Task 1: Define the canonical Admin Foundation contract

**Invariant check:** This task defines Slice 1 interfaces and does not begin Staff or Customer CRUD.

**Files:**
- Create: `packages/contracts/src/admin-foundation.ts`
- Create: `packages/contracts/src/admin-foundation.test.ts`
- Modify: `packages/contracts/src/index.ts`
- Modify: `packages/contracts/src/core-service.ts`
- Modify: `packages/contracts/src/core-service.test.ts`
- Modify: `packages/contracts/src/common.ts`

**Interfaces:**
- Consumes: `AuthenticatedRequest`, `RpcResult`, and `Scope`.
- Produces: `adminCapabilityCodes`, `Capability`, `isAdminCapability`,
  `AdminFoundationService`, `AdminContextView`, `AdminScopeOptionView`,
  `AdminAuditEventPage`, and `AdminAuditEventView`.

- [ ] **Step 1: Write the failing contract tests**

```ts
import { describe, expect, it } from "vitest";
import {
  adminCapabilityCodes,
  isAdminCapability,
  type AdminContextView,
  type AdminAuditEventPage,
} from "./admin-foundation";

describe("admin foundation contracts", () => {
  it("publishes the closed canonical capability vocabulary", () => {
    expect(adminCapabilityCodes).toContain("customers.read");
    expect(adminCapabilityCodes).toContain("inventory.adjust");
    expect(adminCapabilityCodes).toContain("analytics.read");
    expect(isAdminCapability("staff.manage")).toBe(true);
    expect(isAdminCapability("staff:manage")).toBe(false);
  });

  it("keeps context and audit as purpose-built DTOs", () => {
    void ({
      staffId: "staff-1",
      displayName: "Admin",
      email: "admin@example.com",
      capabilities: ["audit.read"],
      scopes: [{ kind: "global" }],
      navigation: [{ code: "audit", label: "Audit", href: "/admin/audit" }],
      environment: "test",
    } satisfies AdminContextView);
    void ({ items: [], nextCursor: null } satisfies AdminAuditEventPage);
  });
});
```

- [ ] **Step 2: Run the tests and prove the contract is absent**

```powershell
pnpm --filter @freshmarkets/contracts exec vitest run --config vitest.config.ts src/admin-foundation.test.ts src/core-service.test.ts
```

Expected: FAIL because `admin-foundation.ts` and `AdminFoundationService` do not exist.

- [ ] **Step 3: Add the exact contract vocabulary and DTOs**

Define `adminCapabilityCodes` exactly as:

```ts
export const adminCapabilityCodes = [
  "customers.read", "customers.manage",
  "orders.read", "orders.manage",
  "catalog.read", "catalog.manage",
  "inventory.read", "inventory.adjust",
  "promotions.read", "promotions.manage",
  "memberships.read", "memberships.manage",
  "payments.read", "payments.manage", "refunds.manage",
  "fulfillment.read", "fulfillment.manage",
  "delivery.read", "delivery.manage",
  "procurement.read", "procurement.manage",
  "analytics.read", "staff.read", "staff.manage",
  "audit.read", "settings.read", "settings.manage",
] as const;
```

Move `Capability` out of `index.ts` and derive it from this tuple. Implement
`isAdminCapability(value: string): value is Capability` with an immutable `Set`. Define:

```ts
export type AdminFoundationService = {
  getAdminContext(request: AuthenticatedRequest): Promise<RpcResult<AdminContextView>>;
  listAdminScopes(request: AuthenticatedRequest): Promise<RpcResult<ReadonlyArray<AdminScopeOptionView>>>;
  listAdminAuditEvents(request: AdminAuditListRequest): Promise<RpcResult<AdminAuditEventPage>>;
  getAdminAuditEvent(request: AdminAuditDetailRequest): Promise<RpcResult<AdminAuditEventView>>;
};
```

`AdminAuditListRequest` accepts optional `action`, `resourceType`, `actorId`, `marketId`,
`locationId`, `from`, `to`, `cursor`, and integer `limit`. `AdminAuditEventView` exposes
actor, action, resource, scope, reason, sanitized metadata/before/after, correlation ID, and ISO
timestamp; it contains no raw JSON string or D1 row.

Extend `ImplementedCoreService` with `AdminFoundationService`, export the module, and set
`CONTRACT_VERSION` to `2026-08-27.admin-foundation`.

- [ ] **Step 4: Run contract tests and typecheck**

```powershell
pnpm --filter @freshmarkets/contracts test
pnpm --filter @freshmarkets/contracts typecheck
```

Expected: all contract tests and typecheck pass.

- [ ] **Step 5: Commit only the contract files**

```powershell
git add -- packages/contracts/src/admin-foundation.ts packages/contracts/src/admin-foundation.test.ts packages/contracts/src/index.ts packages/contracts/src/core-service.ts packages/contracts/src/core-service.test.ts packages/contracts/src/common.ts
git commit -m "feat(admin): define foundation contracts"
```

---

### Task 2: Add canonical capability and Audit persistence

**Invariant check:** This task creates Slice 1 persistence only and does not create Staff CRUD tables.

**Files:**
- Create: `apps/core/migrations/0026_admin_foundation.sql`
- Create: `apps/core/src/iam/admin-foundation-migration.integration.test.ts`
- Modify: `apps/core/migrations/README.md`

**Interfaces:**
- Consumes: current `permission`, `role_permission`, `staff_role`, `staff_scope`, and
  `audit_event`.
- Produces: dot-form capability rows/mappings and nullable Audit scope/detail columns.

- [ ] **Step 1: Write the failing migration tests**

```ts
it("seeds canonical capabilities and extends audit query fields", async () => {
  const capabilities = await env.DB.prepare(
    "SELECT code FROM permission WHERE code IN ('customers.read','inventory.adjust','audit.read','settings.manage') ORDER BY code",
  ).all<{ code: string }>();
  expect(capabilities.results.map((row) => row.code)).toEqual([
    "audit.read", "customers.read", "inventory.adjust", "settings.manage",
  ]);
  const columns = await env.DB.prepare("PRAGMA table_info(audit_event)").all<{ name: string }>();
  expect(columns.results.map((row) => row.name)).toEqual(
    expect.arrayContaining(["market_id", "location_id", "reason", "before_json", "after_json", "correlation_id"]),
  );
});
```

Add a second test that queries the existing legacy `role_operations_admin` assignment seeded by
migrations `0001`/`0006` and proves migration `0026` maps it to both `inventory.read` and
`inventory.adjust` without deleting the legacy permission or assignment.

- [ ] **Step 2: Run the focused test and prove migration 0026 is absent**

```powershell
pnpm --filter @freshmarkets/core exec vitest run --config vitest.config.ts src/iam/admin-foundation-migration.integration.test.ts
```

Expected: FAIL because canonical permissions and Audit columns are missing.

- [ ] **Step 3: Create the additive migration**

The migration must:

1. Insert every `adminCapabilityCodes` value with stable `perm_<domain>_<action>_v1` IDs.
2. Map legacy assignments without deleting historical permission rows:
   `staff:read -> staff.read`, `staff:manage -> staff.manage`,
   `order:manage -> orders.read + orders.manage`,
   `inventory:manage -> inventory.read + inventory.adjust`, and equivalent read/manage mappings for
   procurement, fulfillment, and delivery.
3. Give `role_operations_admin` canonical operational read/manage permissions and
   `role_operations_viewer` only canonical read permissions.
4. Add nullable `market_id`, `location_id`, `reason`, `before_json`, `after_json`, and
   `correlation_id` columns to `audit_event`; retain `details_json` for compatibility.
5. Add indexes on `(occurred_at, id)`, `(aggregate_type, aggregate_id, occurred_at)`,
   `(actor_user_id, occurred_at)`, `(market_id, occurred_at)`, and
   `(location_id, occurred_at)`.

- [ ] **Step 4: Run migration, integrity, and naming checks**

```powershell
pnpm --filter @freshmarkets/core exec vitest run --config vitest.config.ts src/iam/admin-foundation-migration.integration.test.ts src/iam/schema.test.ts
pnpm migration:check
pnpm naming:check
```

Expected: focused tests and repository checks pass.

- [ ] **Step 5: Commit the migration slice**

```powershell
git add -- apps/core/migrations/0026_admin_foundation.sql apps/core/migrations/README.md apps/core/src/iam/admin-foundation-migration.integration.test.ts
git commit -m "feat(iam): seed canonical admin capabilities"
```

---

### Task 3: Move authorization call sites to canonical capabilities

**Invariant check:** This task remediates vocabulary and does not add a new workspace.

**Files:**
- Modify: `apps/core/src/auth/authorization.ts`
- Modify: `apps/core/src/auth/authorization.test.ts`
- Modify: `apps/core/src/entrypoint/context.ts`
- Modify: `apps/core/src/index.ts`
- Modify: `apps/core/src/financial-safety.integration.test.ts`
- Modify: `apps/core/src/operations/application/operational-command-audit.test.ts`
- Modify: `apps/core/src/operations/application/operational-read-models.integration.test.ts`

**Interfaces:**
- Consumes: `isAdminCapability` and canonical `Capability`.
- Produces: authorization contexts containing recognized dot-form capabilities only.

- [ ] **Step 1: Change authorization and one integration fixture first**

```ts
it("accepts only the canonical closed capability vocabulary", () => {
  expect(can([], "staff.read")).toBe(false);
  expect(can(["staff.read"], "staff.read")).toBe(true);
  expect(isAdminCapability("staff:read")).toBe(false);
});
```

Change one operational fixture to seed `fulfillment.manage` while production still expects the
legacy spelling, establishing the red failure.

- [ ] **Step 2: Run authorization and operational tests**

```powershell
pnpm --filter @freshmarkets/core exec vitest run --config vitest.config.ts src/auth/authorization.test.ts src/operations/application/operational-read-models.integration.test.ts
```

Expected: FAIL until production authorization recognizes canonical permissions.

- [ ] **Step 3: Implement canonical authorization**

Replace the comparison chain in `applicationContext` with
`isAdminCapability(permission.code)`. Replace production call sites:

- `order:manage` -> `orders.manage`
- `inventory:manage` -> `inventory.adjust`
- `procurement:manage` -> `procurement.manage`
- `fulfillment:manage` -> `fulfillment.manage`
- `delivery:manage` -> `delivery.manage`

Update the named fixtures. Do not edit historical migrations; Task 2 is the compatibility bridge.

- [ ] **Step 4: Prove source no longer uses legacy capability strings**

```powershell
rg -n '"(staff|rbac|location|order|inventory|procurement|fulfillment|delivery):(read|manage)"' apps/core/src packages/contracts/src -g '*.ts' -g '!*.test.ts' -g '!*.integration.test.ts'
pnpm --filter @freshmarkets/core test
pnpm --filter @freshmarkets/core typecheck
```

Expected: the search returns no matches and Core tests/typecheck pass.

- [ ] **Step 5: Commit the vocabulary migration**

```powershell
git add -- apps/core/src/auth/authorization.ts apps/core/src/auth/authorization.test.ts apps/core/src/entrypoint/context.ts apps/core/src/index.ts apps/core/src/financial-safety.integration.test.ts apps/core/src/operations/application/operational-command-audit.test.ts apps/core/src/operations/application/operational-read-models.integration.test.ts
git commit -m "refactor(iam): use canonical capabilities"
```

---

### Task 4: Implement scoped Admin context and scope queries

**Invariant check:** This task exposes context/scopes only and does not mutate Staff assignments.

**Files:**
- Create: `apps/core/src/admin/application/get-admin-context.ts`
- Create: `apps/core/src/admin/application/list-admin-scopes.ts`
- Create: `apps/core/src/admin/application/admin-context.integration.test.ts`
- Modify: `apps/core/src/index.ts`

**Interfaces:**
- Consumes: `applicationContext`, IAM/geography rows, and Task 1 DTOs.
- Produces: Core RPC methods `getAdminContext` and `listAdminScopes`.

- [ ] **Step 1: Write failing identity, navigation, and scope tests**

Use the Better Auth cookie fixture pattern from
`operational-read-models.integration.test.ts`. Cover:

```ts
expect(await core.getAdminContext({ requestId: "r1", headers: {} })).toMatchObject({
  ok: false, error: { code: "UNAUTHENTICATED" },
});
```

Seed a staff member with `audit.read` at `location-cebu-central` and assert navigation is exactly
`overview` plus `audit`. Assert `listAdminScopes` returns Metro Cebu and Cebu Central but no
unscoped location. An authenticated non-staff user returns `FORBIDDEN`.

- [ ] **Step 2: Run the integration test and prove RPC methods are absent**

```powershell
pnpm --filter @freshmarkets/core exec vitest run --config vitest.config.ts src/admin/application/admin-context.integration.test.ts
```

Expected: FAIL because files/methods do not exist.

- [ ] **Step 3: Implement context and scope queries**

`getAdminContext` derives the session, active `staff_identity`, canonical capabilities, scopes,
and navigation. Closed navigation codes are `overview`, `orders`, `catalog`, `inventory`,
`procurement`, `fulfillment`, `delivery`, `customers`, `memberships`, `payments`,
`promotions`, `analytics`, `staff`, `audit`, and `settings`. Include a workspace only when
its read/manage capability is returned; `overview` is always present for active Staff.

`listAdminScopes` returns only active markets/locations reachable by global, market, or location
assignment. Return IDs/codes/names/timezone/currency; never polygon geometry or ranking rules.

Add flat WorkerEntrypoint methods that delegate to these queries and return stable
`UNAUTHENTICATED`/`FORBIDDEN` errors with the request ID.

- [ ] **Step 4: Run focused and boundary verification**

```powershell
pnpm --filter @freshmarkets/core exec vitest run --config vitest.config.ts src/admin/application/admin-context.integration.test.ts src/auth/authorization.test.ts
pnpm --filter @freshmarkets/contracts test
pnpm --filter @freshmarkets/core typecheck
```

Expected: all commands pass.

- [ ] **Step 5: Commit Core context**

```powershell
git add -- apps/core/src/admin/application/get-admin-context.ts apps/core/src/admin/application/list-admin-scopes.ts apps/core/src/admin/application/admin-context.integration.test.ts apps/core/src/index.ts
git commit -m "feat(admin): expose scoped admin context"
```

---

### Task 5: Implement authorized, redacted Audit reads

**Invariant check:** This task is read-only Audit and does not add exception-resolution commands.

**Files:**
- Create: `apps/core/src/audit/application/list-audit-events.ts`
- Create: `apps/core/src/audit/application/get-audit-event.ts`
- Create: `apps/core/src/audit/application/admin-audit.integration.test.ts`
- Modify: `apps/core/src/index.ts`

**Interfaces:**
- Consumes: Task 1 Audit DTOs, Task 2 columns/indexes, and `audit.read`.
- Produces: `listAdminAuditEvents` and `getAdminAuditEvent` Core methods.

- [ ] **Step 1: Write failing security, scope, pagination, and redaction tests**

Insert Audit rows at two locations and one global row. Cover unauthenticated and missing-capability
denial, location isolation, descending `(occurred_at, id)` cursor pagination, and detail returning
`NOT_FOUND` for an out-of-scope ID. A location-scoped principal must not see another location or an
unscoped/global event; only a global-scoped principal may see global rows. Insert metadata containing `password`, `authorization`,
`accessToken`, and safe `reasonCode`; assert sensitive values become `"[REDACTED]"` while
`reasonCode` remains visible.

- [ ] **Step 2: Run the Audit test and prove the query layer is absent**

```powershell
pnpm --filter @freshmarkets/core exec vitest run --config vitest.config.ts src/audit/application/admin-audit.integration.test.ts
```

Expected: FAIL because Audit query files/RPC methods do not exist.

- [ ] **Step 3: Implement bounded Audit queries**

Validate `limit` from 1–100 with default 50. Encode/decode an opaque base64url cursor containing
`{ occurredAt: number, id: string }`; malformed cursors return `VALIDATION_FAILED`. Build SQL
predicates from validated filters and bound parameters. Apply scope predicates before returning rows.
Invalid historical JSON becomes an empty object plus a safe warning.

Recursively redact case-insensitive keys `password`, `token`, `secret`, `cookie`,
`authorization`, `accessToken`, `refreshToken`, `idToken`, and `providerPayload`. List
responses contain summary metadata; detail contains sanitized before/after/metadata.

- [ ] **Step 4: Run focused tests and scans**

```powershell
pnpm --filter @freshmarkets/core exec vitest run --config vitest.config.ts src/audit/application/admin-audit.integration.test.ts src/operations/application/operational-command-audit.test.ts
pnpm --filter @freshmarkets/core typecheck
rg -n "SELECT \\*|details_json:|password.*AdminAudit|token.*AdminAudit" apps/core/src/audit packages/contracts/src/admin-foundation.ts
```

Expected: tests/typecheck pass; the scan shows no `SELECT *`, raw-row DTO field, or credential field.

- [ ] **Step 5: Commit Audit reads**

```powershell
git add -- apps/core/src/audit/application/list-audit-events.ts apps/core/src/audit/application/get-audit-event.ts apps/core/src/audit/application/admin-audit.integration.test.ts apps/core/src/index.ts
git commit -m "feat(audit): add scoped admin reads"
```

---

### Task 6: Add thin Web BFF routes

**Invariant check:** This task adds transport adapters only and no Web-owned authorization policy.

**Files:**
- Create: `apps/web/app/api/admin/context/route.ts`
- Create: `apps/web/app/api/admin/scopes/route.ts`
- Create: `apps/web/app/api/admin/audit/route.ts`
- Create: `apps/web/app/api/admin/audit/[auditEventId]/route.ts`
- Create: `apps/web/app/api/admin/foundation-routes.test.ts`

**Interfaces:**
- Consumes: `AdminFoundationService`, `coreClient`, and `requestHeaders`.
- Produces: same-origin GET adapters for context, scopes, Audit list, and Audit detail.

- [ ] **Step 1: Write failing route delegation tests**

Mock `coreClient` using the existing route-test pattern. Assert every route forwards cookies,
generates a request ID, maps validated query parameters, and delegates once. Assert detail forwards
the path ID. Malformed numeric `limit` returns HTTP 400 `VALIDATION_FAILED` without calling Core.

- [ ] **Step 2: Run route tests and prove routes are absent**

```powershell
pnpm --filter @freshmarkets/web exec vitest run --config vitest.config.ts app/api/admin/foundation-routes.test.ts
```

Expected: FAIL because route modules do not exist.

- [ ] **Step 3: Implement transport-only handlers**

Each handler constructs `{ requestId: crypto.randomUUID(), headers: requestHeaders(request) }`, adds
validated filters, calls the matching method through `coreClient(env.CORE)`, and returns
`Response.json(result)`. Do not inspect capabilities or D1 in Web.

- [ ] **Step 4: Run route, adapter, and ownership tests**

```powershell
pnpm --filter @freshmarkets/web exec vitest run --config vitest.config.ts app/api/admin/foundation-routes.test.ts lib/core-client/core.test.ts architecture/ownership.scan.test.ts
pnpm --filter @freshmarkets/web typecheck
```

Expected: tests and typecheck pass.

- [ ] **Step 5: Commit BFF routes**

```powershell
git add -- apps/web/app/api/admin/context/route.ts apps/web/app/api/admin/scopes/route.ts apps/web/app/api/admin/audit/route.ts 'apps/web/app/api/admin/audit/[auditEventId]/route.ts' apps/web/app/api/admin/foundation-routes.test.ts
git commit -m "feat(web): proxy admin foundation queries"
```

---

### Task 7: Build the capability-aware shell and Audit workspace

**Invariant check:** This task renders context/Audit only and does not add later workspace pages.

**Entry safety gate:** Run `git status --short`. If `apps/web/app/globals.css`,
`apps/web/package.json`, `pnpm-lock.yaml`, or any target below has pre-existing changes not made by
Tasks 1–6, stop and ask the owner. Never reset/overwrite hunks.

**Files:**
- Create: `apps/web/components.json`
- Create: `apps/web/components/ui/alert.tsx`
- Create: `apps/web/components/ui/breadcrumb.tsx`
- Create: `apps/web/components/ui/input.tsx`
- Create: `apps/web/components/ui/sheet.tsx`
- Create: `apps/web/components/ui/skeleton.tsx`
- Create: `apps/web/components/ui/table.tsx`
- Create: `apps/web/app/admin/admin-context-provider.tsx`
- Create: `apps/web/components/admin/admin-navigation.ts`
- Create: `apps/web/components/admin/admin-navigation.test.ts`
- Create: `apps/web/app/admin/layout.tsx`
- Create: `apps/web/app/admin/audit/page.tsx`
- Create: `apps/web/tests/admin-foundation.spec.ts`
- Modify: `apps/web/components/admin/admin-shell.tsx`
- Modify: `apps/web/app/admin/page.tsx`
- Modify: `apps/web/package.json`
- Modify: `pnpm-lock.yaml`

**Interfaces:**
- Consumes: context/scopes/Audit BFF routes and Core-provided navigation/scope DTOs.
- Produces: `AdminContextProvider`, `useAdminContext`, `adminNavigationFromContext`, shared
  layout, and Audit page.

- [ ] **Step 1: Write the failing navigation test**

```ts
it("renders only Core-provided navigation in canonical order", () => {
  expect(adminNavigationFromContext([
    { code: "audit", label: "Audit", href: "/admin/audit" },
    { code: "overview", label: "Overview", href: "/admin" },
  ]).map((item) => item.code)).toEqual(["overview", "audit"]);
});
```

Write Playwright expectations for unauthenticated error, loading skeleton, permission-filtered
navigation, explicit scope label, Audit rows, filtered-empty state, request reference, and accessible
mobile navigation.

- [ ] **Step 2: Run the unit test and prove the helper is absent**

```powershell
pnpm --filter @freshmarkets/web exec vitest run --config vitest.config.ts components/admin/admin-navigation.test.ts
```

Expected: FAIL because `admin-navigation.ts` does not exist.

- [ ] **Step 3: Add only required shadcn primitives**

Follow the official existing-project monorepo workflow at
`https://ui.shadcn.com/docs/installation/next`. Configure `components.json` for the existing
`@/*` alias and `app/globals.css`, then run:

```powershell
pnpm dlx shadcn@latest add alert breadcrumb input sheet skeleton table -c apps/web
```

Immediately inspect `git diff -- apps/web/app/globals.css`. If the CLI changes a pre-existing dirty
file or unrelated theme token, stop and ask the owner; do not stage it. Do not overwrite existing
`button.tsx` or `badge.tsx`.

- [ ] **Step 4: Implement context boundary, navigation, layout, and Audit page**

`AdminContextProvider` fetches context and scopes once per mount and represents
`loading | ready | unauthenticated | forbidden | error` with manual retry. It never computes
capabilities. `adminNavigationFromContext` only orders/maps Core items to icons. `AdminShell`
accepts those items and explicit selected scope; remove hard-coded hash links.

Move shell ownership to `app/admin/layout.tsx`; remove nested shell use from the operations page
without changing its commands. The Audit page uses shadcn Table/Input/Skeleton/Alert, URL filters,
cursor navigation, semantic table headers, and explicit loading/empty/filtered-empty/permission/error
states. Add no charts, metrics, or later workspace placeholders.

- [ ] **Step 5: Run UI, vinext, and build checks**

```powershell
pnpm --filter @freshmarkets/web exec vitest run --config vitest.config.ts components/admin/admin-navigation.test.ts app/api/admin/foundation-routes.test.ts
pnpm --filter @freshmarkets/web typecheck
pnpm --filter @freshmarkets/web check:vinext
pnpm --filter @freshmarkets/web build
```

Expected: every command passes.

- [ ] **Step 6: Run provisioned Playwright**

```powershell
pnpm --filter @freshmarkets/web exec playwright test tests/admin-foundation.spec.ts tests/admin-operations.spec.ts
```

Expected: authenticated tests execute and pass. A skipped test remains an unmet gate.

- [ ] **Step 7: Commit shell/Audit files only**

```powershell
git add -- apps/web/components.json apps/web/components/ui/alert.tsx apps/web/components/ui/breadcrumb.tsx apps/web/components/ui/input.tsx apps/web/components/ui/sheet.tsx apps/web/components/ui/skeleton.tsx apps/web/components/ui/table.tsx apps/web/app/admin/admin-context-provider.tsx apps/web/components/admin/admin-navigation.ts apps/web/components/admin/admin-navigation.test.ts apps/web/app/admin/layout.tsx apps/web/app/admin/audit/page.tsx apps/web/components/admin/admin-shell.tsx apps/web/app/admin/page.tsx apps/web/package.json pnpm-lock.yaml apps/web/tests/admin-foundation.spec.ts
git commit -m "feat(admin): add scoped shell and audit workspace"
```

---

### Task 8: Reconcile documentation and run the Slice 1 gate

**Invariant check:** This task verifies Slice 1 and does not begin Slice 2 Staff management.

**Files:**
- Modify: `docs/architecture/API_CONTRACTS.md`
- Modify: `docs/architecture/DATA_MODEL.md`
- Modify: `docs/product/IMPLEMENTATION_STATUS.md`
- Modify: `docs/superpowers/plans/ADMIN_CRM_ANALYTICS_PROGRAM_MAP.md`

**Interfaces:**
- Consumes: completed Tasks 1–7 and fresh verification output.
- Produces: canonical documentation aligned with implemented Slice 1 and truthful status.

- [ ] **Step 1: Update canonical documentation**

Add exact `AdminFoundationService` DTO semantics and migration 0026 compatibility rules. Record that
legacy colon permissions remain historical rows. Update status only with evidenced results, including
any skipped Playwright gate or shadcn/globals blocker.

- [ ] **Step 2: Run full proportionate verification**

```powershell
pnpm naming:check
pnpm migration:check
pnpm lint
pnpm typecheck
pnpm test
pnpm -r build
pnpm --filter @freshmarkets/web check:vinext
```

Expected: every command exits 0. Then run Task 7 Playwright and record executed versus skipped.

- [ ] **Step 3: Verify architecture and scope by search**

```powershell
rg -n "D1Database|sqliteTable|details_json" packages/contracts/src/admin-foundation.ts
rg -n '"(staff|rbac|location|order|inventory|procurement|fulfillment|delivery):(read|manage)"' apps/core/src packages/contracts/src -g '*.ts' -g '!*.test.ts' -g '!*.integration.test.ts'
rg -n "isAdmin|/api/admin/rpc|Access-Control-Allow-Origin" apps/core/src apps/web/app/api/admin packages/contracts/src
git diff --name-only HEAD~7..HEAD
```

Expected: the first three searches return no forbidden production matches. Changed files are limited
to Slice 1 plus these documentation files and contain no unrelated storefront file.

- [ ] **Step 4: Commit documentation and stop**

```powershell
git add -- docs/architecture/API_CONTRACTS.md docs/architecture/DATA_MODEL.md docs/product/IMPLEMENTATION_STATUS.md docs/superpowers/plans/ADMIN_CRM_ANALYTICS_PROGRAM_MAP.md
git commit -m "docs(admin): record foundation slice"
```

Do not start Slice 2. Report implementation, modules, migration, RPC/contracts, tests, documentation,
deviations/risks, and what Slice 2 may rely on.

## Slice 1 acceptance checklist

- [ ] Canonical capabilities are shared, closed, and used by production TypeScript.
- [ ] Existing roles map additively without rewriting history.
- [ ] Admin context/scopes derive from session plus Application IAM.
- [ ] Audit list/detail are scoped, cursor-bounded, and redacted.
- [ ] Web routes are transport-only Service Binding adapters.
- [ ] Navigation is determined by Core and shell scope is explicit.
- [ ] Audit UI covers required states and accessibility basics.
- [ ] No later CRUD, public API, direct D1 access, or storefront edit was added.
- [ ] Full verification passes; authenticated Playwright is reported as executed or unmet.

## Plan self-review mapping

- Design architecture and command rules: Tasks 1 and 3–6.
- Capability/scoped navigation foundation: Tasks 1–4 and 7.
- Audit API/workspace: Tasks 2 and 5–7.
- Error/recovery and UI states: Tasks 5–7.
- Testing/acceptance and truthful documentation: Task 8.
- Later API catalog domains: explicitly deferred by the program map and every invariant check.
