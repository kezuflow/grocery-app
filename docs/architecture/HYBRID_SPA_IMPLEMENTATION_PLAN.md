# Hybrid SPA implementation plan

## Hybrid SPA design and execution plan

Owner request: 2026-09-14. Planning task: **HYBRID-SPA-PLAN-1**.
Status: plan delivered; implementation slices **HSPA-0 through HSPA-6 are not started**.
The owner selected hybrid SPA as the desired direction. This document defines implementation work;
it does not claim that the work, delegation, or a new deployment has occurred.

This is a focused Web architecture change alongside
[commerce Phase 7](../product/COMMERCE_ALIGNMENT_E2E_PLAN.md).
[ARCHITECTURE](ARCHITECTURE.md), [ENGINEERING](ENGINEERING.md),
[API_CONTRACTS](API_CONTRACTS.md), and [PRODUCT](../product/PRODUCT.md) retain authority.
Track execution in the existing [active checkpoint](../operations/checkpoints/COMMERCE_ALIGNMENT_EXECUTION.md).
Commerce acceptance gaps remain open independently of this plan.

## Intended result

FreshMarkets will serve meaningful server-rendered entry pages and then operate as a persistent
client application during ordinary use. Moving between pages retains the appropriate application
shell. Search, filters, pagination, cart updates and account interactions update data and content
without a document reload. URLs, deep links, refresh and browser history continue to work.

Keep **vinext, React, Cloudflare Workers and the two-Worker boundary**:
browser -> Web pages and same-origin handlers -> typed Service Binding -> Core -> storage/providers.
Core continues to authenticate, authorize, price, validate and execute business commands.
There is no new browser-to-Core public API and no client-side business authority.

FreshMarkets already has hybrid rendering ingredients. The work is to make its application shell,
navigation and data lifecycle consistently persistent, rather than replacing the framework.
Cloudflare's current Next.js guidance recommends vinext and identifies its beta status.
Its support for SSR and client rendering fits this design. Keep the existing vinext Worker entry
and asset routing; do not enable a global static `index.html` SPA fallback over application routes.

## Current code and concrete changes

Baseline inspected: `main` at `fc763e7bd654a19a155edf26a9de367f1497b000`.

| Area | Current behavior | Planned change |
| --- | --- | --- |
| Storefront shell | Root runtime provider persists, but individual pages render `StorefrontShell` | Put shared header, navigation, cart drawer and footer in a storefront route-group layout; pages render content |
| Catalog | SSR home/search, RSC category navigation, manual client pagination | Hydrate initial results into a shared query cache; use JSON reads for interactive search/filter/page changes |
| Search | Header forms submit a document GET | Client submit and URL synchronization with a working server/deep-link fallback |
| Navigation | Framework links exist; category pointer capture intercepts taps | Keep vinext routing; repair pointer behavior and preserve shell, focus and scroll appropriately |
| Client data | Manual fetch/state paths; TanStack Query is installed but not an application-wide cache | Introduce explicit typed query keys, hydration, deduplication and targeted invalidation |
| Cart and checkout | Existing commands, drawer events and manual bootstrap reads | Share accepted cart state; retain checkout state across normal navigation and refresh affected reads |
| Admin | Already has a layout shell and context providers | Preserve that shell; integrate scoped query state and targeted refresh progressively |
| Initial-load resources | Large banner images and render-blocking CSS observed | Optimize media, loading priority and route bundles in a separate measurable slice |

Primary entry points: `apps/web/app/layout.tsx`, `app/page.tsx`, `app/products/[slug]/page.tsx`,
`components/storefront/storefront-shell.tsx`, `components/storefront/marketplace/catalog-results.tsx`,
`app/api/catalog/route.ts`, `app/checkout/page.tsx`, `app/api/checkout/bootstrap/route.ts`,
`app/api/commerce/cart/route.ts`, and `app/admin/layout.tsx` (paths relative to `apps/web` after the first).
Inspect each actual caller-to-handler-to-Core path before changing it.

## Rendering and navigation contract

| Surface | Entry and refresh | Subsequent interaction |
| --- | --- | --- |
| Home, categories and products | SSR meaningful public content and metadata | Persistent storefront layout; framework route navigation; client catalog reads for query changes |
| Cart, checkout and account | Authorized bootstrap through Web/Core; appropriate loading or redirect | Shared client reads, explicit pending/error states, accepted command results and targeted invalidation |
| Admin | Existing authorized layout/bootstrap | Persistent Admin shell, scoped queries and URL-backed table state |
| Auth callbacks and payment handoffs | Server handlers and required external redirects | Full navigation where the protocol requires it |
| Unknown routes and failures | Correct status, error boundary or redirect | Recoverable view; no generic success-shaped SPA fallback |

Use one vinext router. A proposed `app/(storefront)/layout.tsx` groups eligible routes without
changing their URLs; inventory every shell consumer before moving routes. Keep Admin and auth
layouts deliberate, with no duplicate header or drawer. Different layout families may mount their
own shell; ordinary transitions within each family must preserve its DOM identity.

For catalog query changes, one controller owns URL parsing, result keys and browser history.
Verify native history integration with the installed vinext version before adopting it: changes
must synchronize `useSearchParams`, Back/Forward and refresh without also starting a redundant RSC
fetch. Use push for committed filter/search choices and replace for transient input normalization.
If that integration is unsupported, use vinext's supported navigation API and measure its request
cost before completing HSPA-2; do not install a second router or monkey-patch browser history.
Cross-path navigation continues through framework links.

## Client data and correctness contract

- Create one stable browser QueryClient per application instance. Server hydration uses a fresh
  request-scoped client, never a Worker-global cache containing user data. Start with serializable
  initial DTOs where simpler; prove installed vinext hydration behavior before expanding it.
- Reuse the existing TanStack Query dependency and same-origin typed Web handlers. Hydrate the
  exact query key used by the browser so initial rendering does not immediately repeat the same read.
  The SSR marketplace composite and `/api/catalog` currently have different response shapes;
  define a shared catalog-page query shape and hydrate categories separately.
- Query identity includes all relevant filters, cursor, browsing-context revision and session epoch;
  Admin keys also include the authorized scope. Obtain a safe context revision through a typed DTO
  if needed. Never expose or decode the signed HttpOnly browsing token as a cache key.
- Core revalidates the session, context and scope on every applicable request. A cache key is only
  a UI isolation mechanism. Clear private data on logout/session replacement and discard late
  responses from an earlier session, location or scope. Abort obsolete reads where possible.
- Use a short initial catalog freshness window, proposed at 30 seconds, with explicit invalidation.
  Revisit it using measurements. Cached availability and prices are display data; checkout and
  mutations still obtain current authoritative decisions. Private responses remain private/no-store.
- Deduplicate concurrent reads. Keep the prior useful view during safe same-context refreshes,
  with visible progress; do not display the previous customer's or previous scope's private data.
  Use bounded read retries, cancellation and accessible error/retry states.
- Preserve command version checks and stable idempotency identities. Do not automatically replay
  writes through generic query retry behavior. A timeout remains an unknown outcome until reconciled.
  Do not optimistically claim accepted payment, stock, order or fulfillment outcomes.
- Transient drawer/input state stays in the appropriate persistent client owner. URLs own shareable
  search/filter/page state. Core owns durable business state. Do not add a parallel domain store.

| Accepted event | Client action |
| --- | --- |
| Cart command | Publish the accepted cart DTO to all cart consumers; invalidate dependent checkout reads |
| Browsing location change | Advance context identity; invalidate location-dependent catalog and fulfillment reads |
| Address change | Refresh addresses and affected checkout decisions; preserve unrelated page state |
| Order/payment result | Refresh the affected order and relevant cart/checkout views; show only authoritative status |
| Admin scope change | Cancel/discard old-scope reads and resolve current authorization before showing scoped data |
| Logout or identity change | Remove private cached data and transient private state before rendering the new session |

## Ordered implementation slices

### HSPA-0 — Establish navigation acceptance and route inventory

Inventory routes, shell consumers, fetch ownership, full reloads and `router.refresh` calls. Record
which callbacks intentionally reload. Reproduce and fix the category navigation pointer-capture
defect without breaking horizontal dragging. Capture repeatable baseline samples from the deployed
revision; do not delay the architecture work for an exhaustive provider audit.

Acceptance: desktop mouse, touch and keyboard can select a category; drag does not accidentally
activate a link; URL/content agree. Commit the route matrix and baseline procedure with exact revision,
device/network/cache conditions. No architecture performance benefit is claimed yet.

### HSPA-1 — Persistent layouts and client query foundation

Move storefront chrome into its route-group layout, removing page-level shell duplication. Introduce
the browser query provider, request-safe bootstrap/hydration and key factories. Preserve existing
runtime maps configuration, Admin context and auth provider behavior. Update ARCHITECTURE with the
implemented ownership rules and API_CONTRACTS only if a DTO boundary changes.

Acceptance: home -> product -> cart -> account and Back retain the intended shell and drawer owner;
refresh/deep links still SSR correctly. Initial hydrated reads do not duplicate. Tests prove private
cache isolation and late-response rejection across session/context changes.

### HSPA-2 — SPA catalog navigation, search and pagination

Implement the single URL/query controller; wire desktop/mobile search and category/filter changes
to the typed catalog client. Replace manual pagination state with scoped paginated query state.
Keep SEO entry content and product metadata. Prefetch likely destinations conservatively, avoiding
unbounded catalog fetches or costly provider calls. Preserve focus, scroll and accessible loading.

Acceptance: no document reload for ordinary search/filter/navigation; Back/Forward restores the
correct query and content; reload reproduces it. Rapid changes cannot flash obsolete results.
Cached revisits render promptly; each uncached catalog action produces only its intended catalog
read, excluding documented independent requests. Test empty, failed and last-page results.

### HSPA-3 — Shared cart, checkout and account data

Unify cart consumers around accepted results and query invalidation, retiring duplicate events or
fetch owners only after all consumers migrate. Integrate checkout bootstrap, addresses, fulfillment
options and quote reads incrementally. Preserve guest-to-auth transitions and existing command
contracts. Use targeted invalidation for account edits instead of broad application refreshes.

Acceptance: drawer, badge and cart page agree after success/failure/conflict; checkout recomputes
affected decisions; refresh restores authoritative state; logout clears private state. Existing
payment redirects, idempotent recovery and rejection behavior pass unchanged. No live provider
transaction is required or authorized by this planning document.

### HSPA-4 — Admin SPA consistency

Keep the existing Admin shell/providers. Migrate affected list/detail queries and mutations in small
vertical paths; use URL-backed search/filter/pagination and authorized-scope keys. Preserve dirty
forms or warn before discarding where the existing flow requires it. Reconcile the owner's unfinished
location work before touching overlapping files.

Acceptance: navigation preserves shell and intended table state; mutations refresh the relevant
views; switching scopes cannot reveal old-scope records or permissions. Execute representative
authenticated list/detail/edit journeys and current denial tests.

### HSPA-5 — Initial-load and bundle improvements

Resize/encode banner and brand assets for actual rendered sizes; use responsive variants, stable
dimensions, appropriate preload and deferred offscreen carousel loading. Inspect route bundles for
maps and other heavy features. Audit CSS delivery and hashed asset cache headers without changing
personalized HTML/API caching. Keep visual content and accessibility intact.

Acceptance: compare transferred bytes, request timing, LCP and CLS under identical conditions;
images remain sharp at supported breakpoints; primary imagery is not delayed. Record improvements
separately from SPA navigation gains so results identify which change helped.

### HSPA-6 — Integrated regression, staging and comparison

Run focused behavioral tests during each slice, then `pnpm check`, binding freshness checks,
`vinext check` and relevant Worker/browser acceptance on the integrated revision. Review callbacks,
deep links, status codes, metadata, hydration, authenticated cache isolation and commerce error paths.
Update owning docs and the checkpoint, commit verified intended work to `main`, and push.

Deploy the agreed implementation to staging within the owner's staging scope using the existing
runbook and environment checks. Keep migration/provider activation separate; this design does not
require a schema migration. Record Web/Core versions and a previous known-good compatible Web
version for rollback. Roll back on broken navigation, session isolation, checkout or material
performance regression; never roll back database state as part of a UI rollback.

Acceptance: same-environment before/after measurements plus working authenticated journeys, with
unmet budgets and provider limits stated explicitly. No production rollout is part of this plan.

## Performance measurement and acceptance

Measure both cold entry and in-app interaction. Use the same committed data/assets where comparing
architecture alone, browser, geography, viewport and network/CPU settings. Collect at least five
valid samples per scenario/profile; report median and observed p75 as lab statistics, not field CWV.
Include anonymous, resolved-location and authenticated profiles without logging private content.

| Scenario | Proposed acceptance target |
| --- | --- |
| Ordinary in-app navigation | No new document; persistent shell; correct URL/history/focus |
| Click/tap feedback | Visible response within 100 ms on the tested device |
| Cached catalog revisit | Useful results within 200 ms desktop / 300 ms throttled mobile |
| Uncached catalog interaction | At least 30% median improvement over the matched baseline, or explicitly report a failed performance target and remaining server/network cost |
| Cold entry | Aim for LCP <= 2.5 s and CLS <= 0.1; no regression in matched median/p75 results |
| Requests and correctness | No duplicate bootstrap or obsolete-result flash; no private data leakage; commands preserve existing guarantees |

These are engineering targets, not established results. Record click-to-feedback, click-to-useful
content, document requests, RSC/JSON counts, TTFB, FCP, LCP, CLS, bytes and long tasks. Lab interaction
timings are not field INP. A faster cached UI cannot remove the latency of a required fresh Core read.

Initial staging evidence at `fc763e7b`: two valid desktop category navigations took approximately
705/744 ms and already preserved the document; their RSC reads took 685/727 ms. Separate catalog JSON
reads took 422–446 ms, but their workload differs, so this is not an A/B comparison. One throttled
mobile cold load had LCP about 4.35 s, and four banners transferred about 7.9 MB. These observations
motivate the split between navigation/data work and initial-load resource work. Full matched baseline
and authenticated measurements remain to be completed in HSPA-0/HSPA-6.

## Recommended orchestrator and implementer subagents

Model roles use the owner's corrected effort preferences: Astra medium and Sol low.
This is not a comparative model benchmark. No agents are launched by this plan.

| Role | Recommended model / effort | Responsibility |
| --- | --- | --- |
| Orchestrator | GPT-6 Astra / medium | Own boundaries, sequence, task packets, shared contracts/layout foundation, integration, evidence, checkpoint and Git/deployment operations |
| Implementer | GPT-5.6 Sol / low | Execute one bounded vertical slice, including focused tests and browser evidence; return a reviewed diff and limitations |
| Second implementer, only when independent | GPT-5.6 Sol / low | Work on disjoint files, such as HSPA-5 media work after its inputs are fixed |
| Independent reviewer | GPT-6 Astra / medium | Review isolation, routing/hydration, command correctness and actual acceptance evidence before integration |

Start with the orchestrator and one implementer. Maximum four active agents including the
orchestrator; add concurrency only for independent work. HSPA-1 is coordinated serially because
layouts, providers and query conventions are shared. HSPA-2/3/4 must not concurrently redefine those
foundations. Do not run competing performance traces or heavy integrated builds concurrently.

Each packet states its HSPA ID, prerequisite revision, exact allowed files, owning references,
observable acceptance, required checks and prohibited business-boundary changes. Agents report
changed files, command results, browser evidence and remaining gaps. The orchestrator alone edits
the active checkpoint, stages, commits, pushes and deploys. Preserve all unrelated working-tree edits.

The repository's existing commerce continuation instruction prohibits subagents. This recommendation
does not silently override it: the owner can explicitly request the following scoped execution in a
future instruction. No personal settings or default models are changed.

Suggested execution prompt:

> Implement docs/architecture/HYBRID_SPA_IMPLEMENTATION_PLAN.md in HSPA-0 through HSPA-6 order.
> Use GPT-6 Astra at medium effort as orchestrator and GPT-5.6 Sol at low effort for bounded
> implementer subagents. I authorize this scoped delegation for the hybrid SPA work. Preserve
> unrelated changes and Core authority. Have the orchestrator own shared files, integration,
> checkpoint, commits and staging deployment. Validate each slice, deploy staging, and report the
> matched before/after measurements and any unmet acceptance criteria. Do not deploy production.

## References checked for this plan

- [Cloudflare Next.js/vinext guidance](https://developers.cloudflare.com/workers/framework-guides/web-apps/nextjs/): recommended deployment path and supported rendering features.
- [Cloudflare static SPA routing](https://developers.cloudflare.com/workers/static-assets/routing/single-page-application/): distinguishes pure static fallback from this hybrid Worker design.
- [Cloudflare Service Bindings](https://developers.cloudflare.com/workers/runtime-apis/bindings/service-bindings/): retained private Web-to-Core boundary.
- [Grab Front End Study Guide](https://engineering.grab.com/grabs-front-end-study-guide): SPA navigation and server-rendered state bootstrapping; not proof of every current Grab route.
- [TanStack Query advanced SSR](https://tanstack.com/query/latest/docs/framework/react/guides/advanced-ssr): server/client query ownership and hydration.
- [Codex subagents](https://learn.chatgpt.com/docs/agent-configuration/subagents): delegation guidance; model choices above are task-specific recommendations.
