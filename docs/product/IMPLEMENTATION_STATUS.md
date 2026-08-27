# FreshMarkets Implementation Status

Status date: 2026-08-27. This file is descriptive evidence only. The canonical documents named in
`AGENTS.md` remain authoritative.

## Produce catalog storefront rollout

- All 226 public produce assets are D1-backed products across seven controlled categories
  (migration `0025`, generated from the typed manifest in `apps/core/src/catalog/seed/`). 415 fixed
  sellable SKUs use `G`/`KG`/`PC` controlled units; assembled packs/bunches keep exact internal gram
  recipes with customer-facing approximate contents notes and staff packing instructions stored in
  OPERATIONS-only SKU detail rows.
- Every launch SKU carries positive versioned Metro Cebu STANDARD pricing and Cebu Central
  `AVAILABLE` state through `sku_location_availability`; Scheduled display ignores on-hand inventory.
- Storefront browsing uses Core's bounded `getMarketplaceHome` rails and database-side cursor
  pagination; Web renders Core media/details with no slug-image map and placeholder fallback.
- Media binaries remain public Web assets pending the deferred R2 `product_media` migration.
- Known local-stack limitation: committed migration `0021_instant_mode.sql` cannot apply to dev
  databases containing pre-existing grocery orders because of its unconditional `DROP TABLE
grocery_order` history; fresh or migrated-at-the-time environments are unaffected.

## Admin Foundation Slice 1 (2026-08-27)

- Canonical dot-form admin capabilities are seeded by `0026_admin_foundation.sql` with additive
  legacy colon-form mapping; production authorization recognizes only canonical capabilities, and
  historical permission rows remain untouched compatibility data.
- Core exposes `getAdminContext`, `listAdminScopes`, `listAdminAuditEvents`, and
  `getAdminAuditEvent` through the shared `AdminFoundationService` contract. Audit reads are
  `audit.read`-gated, resource-scope filtered, cursor-bounded (limit 1–100, opaque base64url
  cursor, `VALIDATION_FAILED` on malformed cursors), and recursively redact credential-shaped
  keys; invalid historical JSON sanitizes to an empty object with a logged warning.
- Web adds thin same-origin BFF routes (`/api/admin/context`, `/api/admin/scopes`,
  `/api/admin/audit`, `/api/admin/audit/[audit-event-id]`) that forward session headers to the
  Core Service Binding with no Web-owned authorization and no D1 access, plus a layout-owned
  capability-aware admin shell that renders only Core-provided navigation and an Audit workspace
  covering loading, empty, filtered-empty, permission, and error states with request references.
- Deviation (owner-gate): the shadcn CLI was not run because `apps/web/app/globals.css` carries
  owner-owned uncommitted storefront changes. The six required primitives (alert, breadcrumb,
  input, sheet, skeleton, table) were added as shadcn-source components themed to the existing
  `--fm-*` tokens; `@radix-ui/react-dialog` is the only new runtime dependency. `globals.css` was
  not modified and no owner-owned file was staged.
- Route-segment deviation: the Audit detail path uses kebab-case `[audit-event-id]` because
  repository naming conventions reject uppercase route directories.
- Verification evidence: contracts, Core unit/integration, and web suites pass; root naming,
  migration, lint, typecheck, test, build, and vinext gates pass (fresh counts in the task
  report). Authenticated Playwright journeys (staff shell, permission-filtered navigation, mobile
  trigger, Audit rows/filtered-empty) remain skipped because the local stack has no configured
  auth-email transport; they are an unmet acceptance gate, not satisfied evidence.

## Admin Staff & Access Slice 2 (2026-08-27)

- Migration `0027_staff_administration.sql` adds `staff_invitation`, `staff_identity.version`, and
  role administration metadata (`description`, `ACTIVE|ARCHIVED` status, `version`). Roles are
  archived, never deleted; archived roles fail closed on assignment.
- Core implements `AdminStaffAccessService`: staff reads, invitations, rename, activate/suspend,
  atomic role/scope replacement (version-guarded D1 batches), session revocation, role CRUD with
  canonical-only capabilities, and the capability vocabulary read model. Authorization is
  `staff.read`/`staff.manage` plus a global scope; every material command is idempotent,
  version-guarded, and audited with before/after snapshots.
- Session revocation deletes the authentication authority's own session rows (the minimal Better
  Auth build exposes no admin revoke API); integration tests prove a live session dies.
- Web adds twelve thin BFF adapters under `/api/admin/{staff,roles,capabilities}` and the Staff
  workspace (`/admin/staff`, detail, roles list/detail) with invite, atomic editors, reason-gated
  destructive actions, and loading/empty/permission/error states with request references.
- Invitation acceptance/provisioning of a new identity is explicitly deferred to the slice that
  implements the public acceptance flow; no password input exists anywhere.
- Verification evidence: full workspace gate (naming, migration, lint, typecheck, tests, builds,
  vinext) passes with fresh counts in the task report; authenticated Playwright journeys for the
  staff workspace remain skipped behind the unprovisioned auth-email transport — an unmet gate.

## Reconciled implementation state

### Payments and paid-order recovery

- The deterministic `mock` provider is the only runtime payment adapter. It is selected explicitly
  and is limited to `development` and `test`; every other environment fails closed.
- Core and Web can execute a local checkout through quote acceptance, mock payment intent, signed
  provider event, durable payment observation, reaction redrive, and exactly one committed order.
- Duplicate commands, provider events, and redrives cannot create a second canonical payment or
  order.
- If payment succeeds and commitment fails, the same reaction is retried. Bounded failures create a
  reconciliation case while preserving the payment. No automatic production refund policy exists.
- A production grocery payment provider, production recurring mandates, automatic renewal charging,
  and real-provider retry ownership are not selected or implemented. Existing membership renewal and
  authorization code is a provider-neutral mock-tested seam, not a production billing capability.

### Checkout and delivery pricing

- Catalog prices are admin-managed. Cart display prices neither lock price nor reserve inventory.
- Core recalculates price, promotions, stock, serviceability, and delivery fee before payment. A
  changed total returns `PRICE_CHANGED` and requires explicit customer acceptance of a new quote.
- Delivery configuration is versioned per market/location and stores integer minimum and
  per-kilometer minor-unit rates. There is no production seed value.
- Core's provider-neutral route-distance port has a Mapbox `mapbox/driving` adapter. External route
  failure fails checkout closed; no straight-line or fabricated fallback exists.
- Quotes and committed orders persist immutable provider-neutral delivery calculation snapshots,
  including distance meters, minimum, rate, calculated fee, configuration version, and calculation
  method/profile.
- Migration `0022_delivery_pricing_reconciliation.sql` restores indexes lost by `0021`, restores
  one-order-per-payment enforcement, adds delivery configuration/snapshot storage, and is covered by
  fresh and populated-0021 upgrade checks.

### Authentication email

- Better Auth verification and reset callbacks use the existing Core auth-email port.
- The runtime adapter uses Cloudflare Email Service's Core-only `EMAIL` binding. Sender configuration
  has no production default, missing configuration fails closed, and bearer URLs/recipients are
  redacted from logs.
- Tests use injected fakes. Sending-domain onboarding remains external deployment work.

### Marketplace storefront home

- The `/` marketplace home is server-rendered against Core read models (`searchCatalog`,
  `listCategories`) through the Service Binding inside the vinext RSC page; the former
  client-side catalog fetch was retired.
- The composition follows the approved storefront design: hero heading, real-category pill rail,
  two restrained marketing modules, merchandising rails per category, membership-context strip,
  server-filtered search/category grid, and a quick-view product dialog with fixed-variant
  selection. Demo-only prototype concepts (pickup toggle, multi-store hub selection, ratings,
  tips, invented promotion codes) are intentionally absent.
- `migration 0023` seeds 17 additional Cebu produce products with fixed 250 g/500 g/1 kg SKUs,
  market-scoped standard prices, and Cebu Central availability so rails render with real data.
- Cart interaction is Core-authoritative through `/api/commerce/cart`; add-to-cart for anonymous
  visitors presents a sign-in affordance and preserves browsing context. Pre-authentication
  add-to-cart remains an approved design decision without a Core anonymous-cart capability and is
  future backend work.
- Anonymous browse, category/search filtering, quick-view, and the sign-in boundary are covered
  by Playwright (`tests/storefront-home.spec.ts`) on a provisioned local stack.

### Customer cancellation

- Customer grocery-order cancellation is not in the mock-payment MVP. It is absent from the Core
  entrypoint, shared Service Binding contract, and Web customer surface.
- Internal operational cancellation machinery remains an operations seam and is not customer
  authority. Membership-cancellation UX remains unresolved and is not inferred here.

## Maturity by area

| Area                       | Current evidence                                                                   | Not established                                              |
| -------------------------- | ---------------------------------------------------------------------------------- | ------------------------------------------------------------ |
| Repository/Core boundaries | Monorepo, Core authority, Service Binding contracts, D1 ownership tests            | Production deployment acceptance                             |
| Auth and IAM               | Better Auth Core ownership, RBAC boundaries, fake email-flow tests                 | Production sender/domain and OAuth configuration             |
| Catalog/geography          | SKU/base-unit/pricing foundations; route-price adapter tests                       | Approved production polygons/geocoder and Mapbox secret      |
| Checkout/orders            | Authoritative quote revalidation, mock payment reaction, immutable order snapshots | Full authenticated browser acceptance and production payment |
| Membership                 | Provider-neutral states, trial/authorization/renewal test seams                    | Approved production mandates and automatic charges           |
| Operations                 | Scoped commands/read models and local integration tests                            | Complete staff/rider authenticated Playwright acceptance     |
| Notifications              | Auth verification/reset only                                                       | Product notification Program 6                               |
| Programs 6-14              | No completion claim                                                                | Planned product scope remains unfinished                     |

## Verification truthfulness

Focused Vitest suites and migration checks are implementation evidence. A skipped or gated
Playwright journey is still skipped and does not satisfy an acceptance criterion. Plan 08 / Program
1 and the broader product-program spine must remain open until their written authenticated browser
and operational acceptance criteria actually run and pass. Historical commit messages, reviews, and
ledgers do not override that boundary.

The final verification results for this reconciliation belong in the task report after current-tree
formatting, naming, migration, lint, typecheck, test, build, vinext, and runnable Playwright gates
have been executed.

## Remaining decisions and deployment work

- Select and approve a production grocery/recurring payment provider and define its mandate, retry,
  reconciliation, and refund policies.
- Decide membership-cancellation customer UX and effective timing before exposing a command.
- Configure an onboarded Cloudflare Email Service sender and the Core Mapbox secret outside source.
- Complete Programs 6-14 without treating current schemas or plans as implemented product behavior.
- Provision authenticated staff/rider/customer browser test identities and run the written
  Playwright acceptance journeys without skips.
