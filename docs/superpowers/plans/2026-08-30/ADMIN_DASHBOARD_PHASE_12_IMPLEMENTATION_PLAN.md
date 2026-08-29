# FreshMarkets Admin Dashboard Phase 12 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Complete the approved Phase 12 admin dashboard with a Core-authorized hierarchical shell, full Catalog authoring, complete Order and Payment workspaces, and consistent operational states across every existing Admin surface.

**Architecture:** Extend the existing `apps/web -> typed Service Binding -> apps/core -> D1/R2` path. Core remains authoritative for navigation, capabilities, scope, read models, commands, lifecycle rules, media attachment, optimistic concurrency, idempotency, and Audit; Web supplies only same-origin transport adapters and accessible presentation.

**Tech Stack:** TypeScript, React 19, vinext App Router on Cloudflare Workers, Cloudflare Service Bindings, D1, R2, shadcn/ui primitives, Tailwind CSS 4, Vitest Worker-local integration, and Playwright.

**Spec:** `docs/design/admin/DESIGN.md`, `docs/design/admin/COMPONENTS.md`, and Phase 12 of `docs/product/IMPLEMENTATION_PLAN.md`.

## Global Constraints

- Work directly on `main` under `TRUNK.md`; do not create a feature branch or PR.
- Preserve `apps/web -> typed Service Binding -> apps/core`; Web never reads D1 or R2 directly.
- Use purpose-built DTOs and explicit commands with Core authorization, stable idempotency, expected versions, legal transitions, and Audit.
- Use forward-only migrations; do not edit migrations `0001` through `0040`.
- Keep all Admin theme variables beneath `.fm-admin`; storefront variables and typography remain unchanged.
- Core emits every visible navigation item and hierarchy relationship. Web only groups and renders the received entries.
- Products and Categories use `active|inactive` lifecycle commands; no generic deletion is exposed.
- Orders are never created from Admin and committed snapshots are never rewritten.
- Payment initiation, browser return state, and Admin action never manufacture canonical payment success.
- Generic UI behavior uses installed shadcn/ui primitives; custom components represent reusable Admin or domain compositions.
- Every behavioral change follows red-green-refactor and receives focused contract, Core, route/component, accessibility, and browser coverage proportional to risk.

---

### Task 1: Isolate the Admin theme and publish hierarchical navigation

**Files:**
- Modify: `packages/contracts/src/admin-foundation.ts`
- Modify: `packages/contracts/src/admin-foundation.test.ts`
- Modify: `apps/core/src/admin/application/get-admin-context.ts`
- Modify: `apps/core/src/admin/application/admin-context.integration.test.ts`
- Modify: `apps/web/components/admin/admin-navigation.ts`
- Modify: `apps/web/components/admin/admin-navigation.test.ts`
- Modify: `apps/web/components/admin/admin-shell.tsx`
- Modify: `apps/web/components/admin/admin-accessibility.test.tsx`
- Modify: `apps/web/app/admin/layout.tsx`
- Modify: `apps/web/app/globals.css`
- Test: `apps/web/tests/admin-foundation.spec.ts`

**Interfaces:**
- Produces `AdminNavigationSectionCode = "overview" | "commerce" | "operations" | "finance" | "administration"`.
- Produces `AdminNavigationItem { code, label, href, section, parentCode, kind }`, where `kind` is `section|workspace|destination` and only Core constructs entries.
- Produces `groupAdminNavigation(items)` and `mostSpecificActiveNavigation(items, pathname)` for presentation-only grouping and route matching.
- Produces a 252px expanded sidebar, 72px collapsed rail, `fm-admin-sidebar-collapsed` browser preference, accessible group toggles/tooltips, and a mobile Sheet with no bottom navigation.

- [ ] **Step 1: Write failing contract, Core, navigation, token-isolation, and browser tests**

  Add literal expectations for section/parent metadata, capability-filtered children, most-specific active matching, automatic parent expansion, persisted collapse, mobile Sheet focus restoration, and `.fm-admin`-scoped orange/chart variables. Assert storefront nodes do not inherit Admin accent variables.

- [ ] **Step 2: Run focused tests and verify RED**

  Run: `pnpm --filter @freshmarkets/contracts test -- src/admin-foundation.test.ts && pnpm --filter @freshmarkets/core test -- src/admin/application/admin-context.integration.test.ts && pnpm --filter @freshmarkets/web test -- components/admin/admin-navigation.test.ts components/admin/admin-accessibility.test.tsx`

  Expected: the flat DTO has no hierarchy, the shell still renders the mobile bottom navigation, and Admin variables are globally rooted.

- [ ] **Step 3: Implement the contract and Core navigation vocabulary**

  Publish closed section/kind types. Return Overview plus capability-authorized Commerce, Operations, Finance, and Administration parents/destinations in canonical order, including stable create/list destinations and no resource-ID routes.

- [ ] **Step 4: Implement the scoped visual system and responsive shell**

  Move the neutral canvas, orange accent, five orange chart colors, Admin dimensions, and Admin shadows into `.fm-admin`. Preserve semantic success/warning/danger/info colors. Render grouped desktop navigation with independent parent links/toggles, collapsed tooltips/flyouts, a sticky explicit scope header, and a mobile Sheet. Remove `AdminMobileNav`.

- [ ] **Step 5: Run focused and browser tests and verify GREEN**

  Run the Step 2 command, then `pnpm --filter @freshmarkets/web exec playwright test tests/admin-foundation.spec.ts`.

- [ ] **Step 6: Review, record progress, commit, and push**

  Compare the diff with `DESIGN.md` Global Shell and theme rules. Commit `feat(admin): add hierarchical operational shell`, then push `origin main`.

### Task 2: Add canonical Category hierarchy and guarded Category administration

**Files:**
- Create: `apps/core/migrations/0041_admin_catalog_authoring.sql`
- Create: `apps/core/src/iam/admin-catalog-authoring-migration.integration.test.ts`
- Modify: `packages/contracts/src/admin-catalog.ts`
- Modify: `packages/contracts/src/admin-catalog.test.ts`
- Modify: `apps/core/src/admin/application/catalog-reads.ts`
- Modify: `apps/core/src/admin/application/catalog-commands.ts`
- Modify: `apps/core/src/admin/application/admin-catalog.integration.test.ts`
- Modify: `apps/core/src/index.ts`
- Create: `apps/web/app/api/admin/catalog/categories/[category-id]/route.ts`
- Create: `apps/web/app/api/admin/catalog/categories/[category-id]/status/route.ts`
- Modify: `apps/web/app/api/admin/catalog/categories/route.ts`
- Modify: `apps/web/app/api/admin/catalog-routes.test.ts`
- Create: `apps/web/app/admin/catalog/categories/page.tsx`
- Create: `apps/web/app/admin/catalog/categories/new/page.tsx`
- Create: `apps/web/app/admin/catalog/categories/[category-id]/page.tsx`
- Create: `apps/web/app/admin/catalog/categories/[category-id]/edit/page.tsx`
- Test: `apps/web/tests/admin-catalog.spec.ts`

**Interfaces:**
- Migration adds `category.parent_id`, `category.version`, and indexes for parent/order/status; it creates `product_media` in Task 4-compatible shape so one forward migration owns the approved Catalog authoring schema.
- Produces `AdminCategoryDetail` with parent, children, contained product summaries, version, `allowedActions`, and recent Audit.
- Produces `getAdminCategory`, `updateAdminCategory`, and `setAdminCategoryStatus` commands. Create/update accepts `parentCategoryId`, icon, and sort order; update/status require `expectedVersion`, `idempotencyKey`, and material status changes require `reason`.

- [ ] **Step 1: Write failing migration and contract tests**

  Assert forward backfill to `version = 1`, foreign-key-safe hierarchy, self/cycle rejection in Core, exact request validation, and no delete method in `AdminCatalogService`.

- [ ] **Step 2: Run focused tests and verify RED**

  Run: `pnpm --filter @freshmarkets/contracts test -- src/admin-catalog.test.ts && pnpm --filter @freshmarkets/core test -- src/iam/admin-catalog-authoring-migration.integration.test.ts src/admin/application/admin-catalog.integration.test.ts`

- [ ] **Step 3: Implement migration, DTOs, reads, and guarded commands**

  Use global `catalog.read|catalog.manage` authorization, guarded expected-version writes, full canonical request hashes, atomic mutation/Audit/idempotency completion, and stable `STALE_VERSION|IDEMPOTENCY_CONFLICT|VALIDATION_FAILED` responses.

- [ ] **Step 4: Implement BFF routes and Category screens**

  Build list/add/detail/edit screens using Core data, URL-preserved list filters, breadcrumbs, parent selection, status confirmation, request references, and explicit loading/empty/filtered-empty/permission/error/stale/success states.

- [ ] **Step 5: Run focused route/browser and repository checks**

  Run: `pnpm --filter @freshmarkets/web test -- app/api/admin/catalog-routes.test.ts && pnpm --filter @freshmarkets/web exec playwright test tests/admin-catalog.spec.ts && pnpm migration:check && pnpm naming:check`.

- [ ] **Step 6: Review, record progress, commit, and push**

  Commit `feat(catalog): add category administration`, then push `origin main`.

### Task 3: Add guarded Product authoring and customer-facing details

**Files:**
- Modify: `packages/contracts/src/admin-catalog.ts`
- Modify: `packages/contracts/src/admin-catalog.test.ts`
- Modify: `apps/core/src/admin/application/catalog-reads.ts`
- Modify: `apps/core/src/admin/application/catalog-commands.ts`
- Modify: `apps/core/src/admin/application/admin-catalog.integration.test.ts`
- Modify: `apps/core/src/index.ts`
- Modify: `apps/web/app/api/admin/catalog/products/route.ts`
- Modify: `apps/web/app/api/admin/catalog/products/[product-id]/route.ts`
- Create: `apps/web/app/admin/catalog/products/page.tsx`
- Create: `apps/web/app/admin/catalog/products/new/page.tsx`
- Modify: `apps/web/app/admin/catalog/products/[product-id]/page.tsx`
- Create: `apps/web/app/admin/catalog/products/[product-id]/edit/page.tsx`
- Modify: `apps/web/app/api/admin/catalog-routes.test.ts`
- Test: `apps/web/tests/admin-catalog.spec.ts`

**Interfaces:**
- Produces `AdminProductCreateRequest` and `AdminProductUpdateRequest` for identity, category, description, ordered customer details, and inventory-pool base unit. Update requires expected version and stable idempotency.
- Extends `AdminProductDetail` with category ID, customer details, media, inventory-pool/base-unit context, `allowedActions`, and recent Audit.
- Produces `createAdminProduct` and `updateAdminProduct`; existing SKU, price, availability, and status commands remain separate.

- [ ] **Step 1: Write failing contract/Core tests for create, update, replay, stale writes, authorization, and historical deactivation**

  Use real D1 fixtures. Assert changed-input replay conflicts, a stale update writes no Audit/success record, a deactivated referenced Product remains readable from historical Order snapshots, and Web cannot submit arbitrary fields.

- [ ] **Step 2: Verify RED with contract and Core suites**

  Run: `pnpm --filter @freshmarkets/contracts test -- src/admin-catalog.test.ts && pnpm --filter @freshmarkets/core test -- src/admin/application/admin-catalog.integration.test.ts`.

- [ ] **Step 3: Implement purpose-built Product commands and enriched reads**

  Atomically create Product plus inventory pool and ordered details. Update identity/details through a version guard and Audit; preserve SKU/price/availability as their own commands and never modify committed snapshots.

- [ ] **Step 4: Implement Product list/add/detail/edit flows**

  Preserve list filters in links/breadcrumbs. Detail composes variants, exact base consumption, prices, location sourcing/availability, media, lifecycle, and Audit; all forms retain intent across recoverable errors.

- [ ] **Step 5: Run focused Web and browser tests and verify GREEN**

  Run: `pnpm --filter @freshmarkets/web test -- app/api/admin/catalog-routes.test.ts components/admin && pnpm --filter @freshmarkets/web exec playwright test tests/admin-catalog.spec.ts`.

- [ ] **Step 6: Review, record progress, commit, and push**

  Commit `feat(catalog): add product authoring workspaces`, then push `origin main`.

### Task 4: Attach canonical R2-backed Product media

**Files:**
- Modify: `apps/core/wrangler.jsonc`
- Regenerate: `apps/core/src/worker-configuration.d.ts`
- Modify: `packages/contracts/src/admin-catalog.ts`
- Modify: `packages/contracts/src/admin-catalog.test.ts`
- Create: `apps/core/src/admin/application/product-media.ts`
- Modify: `apps/core/src/admin/application/admin-catalog.integration.test.ts`
- Modify: `apps/core/src/index.ts`
- Create: `apps/web/app/api/admin/catalog/products/[product-id]/media/route.ts`
- Create: `apps/web/app/api/admin/catalog/products/[product-id]/media/[media-id]/route.ts`
- Modify: `apps/web/app/admin/catalog/products/[product-id]/page.tsx`
- Modify: `apps/web/app/api/admin/catalog-routes.test.ts`
- Test: `apps/web/tests/admin-catalog.spec.ts`
- Modify: `docs/architecture/ARCHITECTURE.md`
- Modify: `docs/architecture/API_CONTRACTS.md`

**Interfaces:**
- Adds Core `PRODUCT_MEDIA: R2Bucket` binding.
- Produces `uploadAdminProductMedia`, `updateAdminProductMedia`, and `removeAdminProductMedia` commands. Upload accepts validated image bytes, MIME type, alt text, primary flag, sort order, expected Product version, and idempotency key; returns `AdminProductMediaView`.
- R2 object keys are Core-generated under `products/{productId}/{mediaId}`. D1 attachment is authoritative; failed attachment removes the just-uploaded object. Removal deactivates the row and deletes the blob only after the guarded D1 command succeeds.

- [ ] **Step 1: Retrieve current Workers/R2 references and write failing binding, contract, integration, and route tests**

  Verify size/MIME limits, missing object/metadata cleanup, primary-image uniqueness, ordering, stale Product versions, authorization, changed-input replay, Audit, and no arbitrary object key input from Web.

- [ ] **Step 2: Run focused tests and verify RED**

  Run: `pnpm --filter @freshmarkets/contracts test -- src/admin-catalog.test.ts && pnpm --filter @freshmarkets/core test -- src/admin/application/admin-catalog.integration.test.ts && pnpm --filter @freshmarkets/web test -- app/api/admin/catalog-routes.test.ts`.

- [ ] **Step 3: Implement binding, media commands, and multipart BFF adapters**

  Keep byte validation and R2 operations in Core. Web parses the same-origin multipart request and delegates typed bytes plus metadata through the Service Binding. No D1/R2 credential reaches Web.

- [ ] **Step 4: Implement Product media management UI**

  Add upload, alt text, primary selection, ordering, and deactivation controls with exact impact confirmation and Core-returned state.

- [ ] **Step 5: Run focused tests, type generation, build, and browser flow**

  Run: `pnpm --filter @freshmarkets/core types && pnpm --filter @freshmarkets/core typecheck && pnpm --filter @freshmarkets/web typecheck && pnpm --filter @freshmarkets/web exec playwright test tests/admin-catalog.spec.ts`.

- [ ] **Step 6: Review, record progress, commit, and push**

  Commit `feat(catalog): manage canonical product media`, then push `origin main`.

### Task 5: Complete Order Detail and Payment workspaces

**Files:**
- Modify: `packages/contracts/src/admin-finance.ts`
- Modify: `packages/contracts/src/admin-finance.test.ts`
- Modify: `apps/core/src/admin/application/finance-reads.ts`
- Modify: `apps/core/src/admin/application/admin-finance.integration.test.ts`
- Modify: `apps/core/src/index.ts`
- Modify: `apps/web/app/api/admin/finance-routes.test.ts`
- Modify: `apps/web/app/admin/orders/page.tsx`
- Modify: `apps/web/app/admin/orders/[order-id]/page.tsx`
- Create: `apps/web/app/api/admin/payments/[payment-intent-id]/route.ts`
- Create: `apps/web/app/admin/payments/overview/page.tsx`
- Create: `apps/web/app/admin/payments/transactions/page.tsx`
- Create: `apps/web/app/admin/payments/transactions/[payment-intent-id]/page.tsx`
- Create: `apps/web/app/admin/payments/reconciliation/page.tsx`
- Modify: `apps/web/app/admin/payments/page.tsx`
- Test: `apps/web/tests/admin-finance.spec.ts`

**Interfaces:**
- Extends `AdminOrderDetail` with immutable financial components, item snapshots, Payments, amendments, fulfillment, delivery, exceptions, a merged ordered timeline, Audit, and Core-derived `allowedActions`.
- Produces `AdminPaymentOverview`, `AdminPaymentDetail`, and `getAdminPayment`; detail includes canonical attempt/refund/event/reaction/reconciliation projections and allowed actions derived in Core.

- [ ] **Step 1: Write failing contract/Core tests for complete composition, immutable snapshot sources, authorization, scope, and canonical allowed actions**

- [ ] **Step 2: Run focused tests and verify RED**

  Run: `pnpm --filter @freshmarkets/contracts test -- src/admin-finance.test.ts && pnpm --filter @freshmarkets/core test -- src/admin/application/admin-finance.integration.test.ts`.

- [ ] **Step 3: Implement purpose-built Order and Payment projections**

  Compose source-owned state without mutating it. Financial amounts remain integer minor units with currency; provider payloads and raw rows never leave Core.

- [ ] **Step 4: Implement Overview, Transactions, Detail, and Reconciliation screens**

  Refund/retry/reconcile remain contextual commands with confirmation, stable intent keys, current allowed actions, and recoverable conflict/error UI. Keep `/admin/payments` as a compatibility redirect or overview shell.

- [ ] **Step 5: Run focused route/browser tests and verify GREEN**

  Run: `pnpm --filter @freshmarkets/web test -- app/api/admin/finance-routes.test.ts && pnpm --filter @freshmarkets/web exec playwright test tests/admin-finance.spec.ts`.

- [ ] **Step 6: Review, record progress, commit, and push**

  Commit `feat(admin): complete order and payment workspaces`, then push `origin main`.

### Task 6: Apply the unified Admin compositions and state model everywhere

**Files:**
- Modify: `apps/web/components/admin/admin-controls.tsx`
- Create: `apps/web/components/admin/admin-data-table.tsx`
- Create: `apps/web/components/admin/admin-page-state.tsx`
- Create: `apps/web/components/admin/admin-breadcrumbs.tsx`
- Modify: all pages under `apps/web/app/admin/`
- Modify: `apps/web/components/admin/admin-accessibility.test.tsx`
- Modify: affected route tests under `apps/web/app/api/admin/`
- Modify: all `apps/web/tests/admin-*.spec.ts`

**Interfaces:**
- Produces shared `AdminDataTable`, `AdminPageState`, `AdminBreadcrumbs`, `FilterBar`, `ConfirmCommandDialog`, cursor controls, status/timeline/detail compositions, and live command-result announcements.
- Every list consumes `nextCursor`, preserves filters/selected scope, and distinguishes no data, filtered empty, permission/scope empty, loading, and error.

- [ ] **Step 1: Write failing component and browser tests for every state and responsive/keyboard behavior**

  Cover Overview, Customers/Privacy, Memberships, Promotions, Inventory, Procurement/Receiving, Fulfillment, Delivery, Operational Exceptions, Analytics, Staff/Roles, Audit, and Fulfillment Mode Settings. Assert later cursor pages are reachable and no screen renders raw persistence/provider payloads.

- [ ] **Step 2: Run Web unit and Admin browser suites and verify RED**

  Run: `pnpm --filter @freshmarkets/web test -- components/admin app/api/admin && pnpm --filter @freshmarkets/web exec playwright test tests/admin-*.spec.ts`.

- [ ] **Step 3: Implement shared compositions and migrate each workspace**

  Keep domain-specific actions and status vocabularies explicit. Replace page-local duplicate tables/states only where the shared composition preserves the domain decision; retain Core-derived allowed actions and explicit selected scope.

- [ ] **Step 4: Run Web unit/browser suites and verify GREEN**

  Repeat Step 2, then run `pnpm --filter @freshmarkets/web run check:vinext` and `pnpm --filter @freshmarkets/web build`.

- [ ] **Step 5: Review against the complete required screen inventory, record progress, commit, and push**

  Commit `feat(admin): unify operational workspaces`, then push `origin main`.

### Task 7: Reconcile documentation and close the Phase 12 gate

**Files:**
- Modify: `docs/architecture/API_CONTRACTS.md`
- Modify: `docs/architecture/DATA_MODEL.md`
- Modify: `docs/product/IMPLEMENTATION_STATUS.md`
- Modify: this plan
- Create: `docs/superpowers/reports/ADMIN_DASHBOARD_PHASE_12_FINAL.md`

**Interfaces:**
- Produces an evidence report mapping every Phase 12 acceptance item and every required Admin screen to its contract, Core implementation, Web route/page, migration, and test.

- [ ] **Step 1: Re-read the plan, `DESIGN.md`, `COMPONENTS.md`, Phase 12, and relevant canonical domain/API/data/state/MVP sections line by line**

- [ ] **Step 2: Correct descriptive/canonical documentation only where implemented terminology or contract/schema shape changed**

- [ ] **Step 3: Run the complete validation matrix**

  Run:

  ```powershell
  pnpm format:check
  pnpm naming:check
  pnpm migration:check
  pnpm lint
  pnpm typecheck
  pnpm test
  pnpm -r build
  node scripts/verify-worker-readiness.mjs
  pnpm --filter @freshmarkets/web exec playwright test tests/admin-*.spec.ts
  ```

- [ ] **Step 4: Inspect the complete diff and request independent code review**

  Use `superpowers:requesting-code-review`; resolve every Critical and Important finding, rerun affected checks, and record Minor residual risks.

- [ ] **Step 5: Use `superpowers:verification-before-completion` and rerun the complete validation matrix**

- [ ] **Step 6: Commit documentation/evidence, push, and verify remote parity**

  Commit `docs(admin): close phase 12 dashboard`, push `origin main`, and verify `git rev-parse HEAD` equals `git rev-parse origin/main` with a clean worktree.

## Final Acceptance Checklist

- [ ] `.fm-admin` owns the neutral/orange light theme and five-step orange chart palette without changing storefront styling.
- [ ] Core-authorized grouped navigation, 252px/72px desktop modes, mobile Sheet, route specificity, persistence, keyboard/focus behavior, and explicit scope selection pass.
- [ ] Product and Category list/add/detail/edit flows are Core-backed and cover hierarchy, lifecycle, details, variants, exact consumption, prices, availability/sourcing, canonical media, and Audit.
- [ ] Order detail composes immutable financial/item snapshots, Payments, fulfillment, delivery, amendments, timeline, exceptions, allowed actions, and Audit; Admin cannot create Orders.
- [ ] Payment overview, transactions, detail, reconciliation, refund/retry/reconcile commands use canonical provider-confirmed state.
- [ ] Every remaining Admin workspace uses the unified responsive/state/accessibility model and reachable cursor pagination.
- [ ] No raw D1/R2/provider type reaches contracts or UI; Web has no authoritative data access or invented authorization.
- [ ] Migration, focused tests, Worker-local tests, vinext checks, builds, and Admin Playwright flows pass.
- [ ] Full verification is fresh, the worktree is clean, and all verified commits are pushed to `origin/main`.
