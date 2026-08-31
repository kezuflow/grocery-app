# FreshMarkets Admin Shadcn UI Kit Redesign

## Summary

Rebuild the complete FreshMarkets Admin visual system as a clean-room reproduction of the relevant [Shadcn UI Kit dashboard](https://shadcnuikit.com/dashboard/ecommerce) layouts. Preserve existing routes, Core authority, domain commands, and authorization while closely matching the reference geometry, tables, forms, cards, detail pages, and responsive behavior.

- Reproduce all relevant templates, excluding unrelated demos such as chat, school, crypto, and file manager.
- Match layouts closely while replacing demo content and actions with authoritative FreshMarkets data.
- Retain the approved light neutral theme with FreshMarkets orange accents.
- Default desktop navigation to the kit-like 72px icon rail, with a remembered 252px expanded mode.
- Do not copy proprietary source, branding, assets, or placeholder data.

## Implementation Changes

1. **Canonical design and component system**
   - Update the Admin design, component guidance, API contracts, product scope, and implementation sequencing before code changes.
   - Build shared compositions for the shell, dashboard grid, metric cards, tables, filters, editor layout, detail workspace, settings tabs, steppers, banners, command dialogs, and all page states.
   - Add Recharts `3.10.1` for accessible bar, line, and donut charts.
   - Keep styling isolated beneath `.fm-admin`; do not alter storefront tokens.

2. **Shell and page-family migration**
   - `/admin`: ecommerce-dashboard geometry adapted into an operational command center.
   - Products: Product List, Product Detail, and Add Product compositions with media, SKUs, prices, availability, lifecycle, and audit information.
   - Orders and Issues: Order List and Detail compositions without Create Order or arbitrary edit controls.
   - Payments: Payment Dashboard and Transactions compositions for canonical payment and reconciliation state.
   - Customers, Memberships, Staff, and Roles: Users List, profile, and settings compositions.
   - Inventory, Procurement, Receiving, Fulfillment, Delivery, and Exceptions: dense queue, transaction, detail, and dashboard compositions.
   - Analytics: ecommerce chart grid using only approved versioned metrics.
   - Audit and Fulfillment Mode: transaction-table and settings-form compositions.

3. **Authoritative read-model additions**
   - Add `AdminOverviewService.getAdminOverview({ selectedScope, timezone })` returning generated time, operational cards, workload-stage counts, bounded exceptions, recent material operations, freshness, and denied sections.
   - Extend `AdminProductListRequest` with explicit market/location pricing context.
   - Extend product summaries with primary-media identity, active/priced/available SKU counts, and resolved price range.
   - Add page-level catalog readiness totals for active/inactive products, missing primary media, missing prices, and unavailable SKUs.
   - Add an authenticated product-media content read returning bytes, MIME type, ETag, and version without exposing R2 object keys. Serve it through a same-origin Web adapter with private caching.

4. **Pricing and fees workspace**
   - Add `/admin/commerce-configuration` and a Core-authorized `Pricing & fees` navigation destination.
   - Adapt the Single Pricing layout into separate Membership Price and Instant Service Fee tabs.
   - Reuse the existing Core configuration methods; do not add arbitrary price-history editing.
   - Display current configuration, effective-dated replacement form, invariant/impact explanation, reason, confirmation, version conflict handling, and audit context.
   - Enforce global scope plus the existing membership/payment read and manage capabilities independently per tab.

5. **Delivery sequence**
   - Batch 1: canonical documentation, tokens, shell, navigation, and shared states.
   - Batch 2: shared table/form/detail/chart compositions.
   - Batch 3: operational overview, catalog read-model additions, and media delivery.
   - Batch 4: orders, issues, payments, reconciliation, and pricing/fees.
   - Batch 5: customers, memberships, promotions, staff, and roles.
   - Batch 6: inventory, procurement, receiving, fulfillment, delivery, exceptions, analytics, audit, and settings.
   - Batch 7: responsive, accessibility, visual-parity, and performance hardening.
   - Preserve usable routes and existing behavior after every batch; commit directly to `main` under the repository’s trunk policy.

## Interfaces and Safety

- A fully privileged Global Administrator must see every Admin workspace, every market/location, every Admin-safe record, and every legal command.
- Scoped roles remain filtered by capability and market/location scope.
- Committed financial/history records, Audit events, Better Auth authority, provider payloads, storage keys, and raw D1 rows remain protected from arbitrary editing.
- Existing expected-version, idempotency, reason, audit, and legal-transition requirements remain unchanged.
- No public HTTP API, CORS, direct Web-to-D1/R2 access, or new state-owning infrastructure is introduced.
- No D1 migration is expected unless measured query plans demonstrate a required index.
- Reference sections without authoritative data are omitted or marked unavailable; values are never fabricated or silently represented as zero.

## Test Plan

- Contract tests for the overview DTO, catalog summary fields, media-content response, and navigation vocabulary.
- Core integration tests for global/scoped authorization, overview counts, pricing context, secure media reads, and absence of storage/provider leakage.
- Configuration tests for read/manage separation, stale versions, exact idempotent replay, conflicting replay, effective dates, and audit evidence.
- Component tests for loading, empty, filtered-empty, permission, error, unavailable, pending, and conflict states.
- Playwright coverage for:
  - Fully privileged Global Administrator access to every workspace and legal command.
  - Restricted-role and location-scope enforcement.
  - Existing Catalog, Order, Payment, Operations, Staff, Analytics, and configuration flows.
  - Keyboard navigation, focus restoration, responsive tables, icon-rail flyouts, and mobile Sheet behavior.
- Maintain FreshMarkets-owned screenshot baselines at `1440×1200`, `1024×1366`, and `390×844` for every shared page archetype.
- Final gates: formatting, naming, lint, typecheck, full unit/integration tests, vinext compatibility/build, Worker readiness, and the complete deterministic Admin Playwright suite.

## Locked Assumptions

- The implementation is an independent visual reproduction; no Shadcn UI Kit source license is available.
- Only templates relevant to FreshMarkets are reproduced.
- Reference layout wins while FreshMarkets domain content and legal actions remain authoritative.
- The Admin remains light-only with orange accents.
- The homepage remains an operational command center rather than an executive revenue dashboard.
- Current Admin URLs remain stable, except for the new `/admin/commerce-configuration` workspace.
