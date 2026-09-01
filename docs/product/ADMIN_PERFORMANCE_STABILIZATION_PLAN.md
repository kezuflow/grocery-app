# FreshMarkets Admin Performance Stabilization Plan

Status: local execution complete through Phase 7; production evidence and visual-baseline
reconciliation remain pending.

## Purpose

Reduce Admin time-to-useful-data and server request overhead before further feature expansion.
This pass changes no business rule or domain ownership. Web remains a vinext Cloudflare Worker,
calls Core through typed Service Bindings, and never reads authoritative D1 data directly.

## Measured baseline

The 2026-09-01 production-build local Worker trace is directional rather than a substitute for
production telemetry, but it established these concrete dependency and query problems:

- A full Admin load requests context and scopes before requesting the page read model.
- 39 of 43 Admin pages are client components and 39 initiate browser data fetches.
- The traced Admin overview reached useful operational data at about 4.2 seconds. Worker timings
  included about 400 ms for context, 742 ms for scopes, and 1.89 seconds for overview; warm
  overview requests were about 287–393 ms.
- Automatic link prefetch requested the Marketplace route and multiple visible catalog create and
  detail routes without navigation intent.
- Each Admin endpoint independently resolves the Better Auth session, staff identity, roles,
  permissions, and operational scopes. The overview invokes the audit read model, which resolves
  authorization again inside the same RPC.
- Overview exceptions fan out by location. Product listing uses repeated correlated subqueries and
  additional global readiness queries. Local query plans include full scans and temporary ordering.

Phase 1 must replace these directional numbers with production p50, p95, and p99 evidence before
any index, projection, or performance SLO is approved.

## Constraints

- Preserve Core as the sole business and authorization authority.
- Preserve capability and market/location-scope enforcement on every Admin read and command.
- Preserve purpose-built typed DTOs; do not expose raw D1 rows.
- Do not introduce public APIs, KV authorization caches, Durable Objects, Workflows, Queues, or a
  separate read service for this pass.
- Do not cache authentication or authorization across requests. Request-scoped reuse is allowed.
- Validate every relied-on vinext server-component, cookie, link-prefetch, and Service Binding
  behavior with integration tests.
- Make every schema/index change through an append-only migration and validate both fresh and
  populated migration paths.
- Preserve unrelated uncommitted work and execute directly on `main` under `TRUNK.md`.

## Execution phases

### Phase 1 — Baseline and observability

- Propagate one correlation ID through browser-safe response headers, Web adapters, Core RPCs, and
  structured logs.
- Add `Server-Timing` and structured/custom spans for Web adapter time, session resolution, IAM
  resolution, read-model SQL, serialization, D1 rows read/returned where available, and total RPC.
- Capture production p50/p95/p99 for Admin bootstrap, overview, product list, and representative
  commands. Record cold and warm behavior separately.
- Define performance budgets only after the production baseline is captured.

Acceptance: timings correlate end to end without leaking session, token, customer, provider, or
other sensitive data; existing behavior and authorization tests remain unchanged.

### Phase 2 — Remove avoidable Web request pressure

- Disable automatic prefetch for the Admin-to-Marketplace boundary and dense create/detail table
  links unless a production trace demonstrates a benefit.
- Retain intentional navigation, keyboard behavior, loading states, and filter/breadcrumb state.
- Verify installed vinext behavior in production build and Worker-local integration tests.

Acceptance: an idle Admin list no longer prefetches visible row-detail routes or the Marketplace;
intentional navigation remains correct.

### Phase 3 — Collapse the Admin bootstrap waterfall

- Add one purpose-built, scope-aware Core bootstrap read model containing Admin context, available
  scopes, selected-scope evidence, and the initial page data required for first useful render.
- Expose it through a typed Web adapter and load it without waiting on separate context and scope
  browser requests. Prefer server loading only after cookie/RSC/Service Binding behavior is proven.
- Hydrate the client provider from the bootstrap DTO and preserve explicit loading, denied, empty,
  unavailable, and error states.

Acceptance: a full Admin overview load has no context → scopes → overview browser waterfall and
uses one authoritative bootstrap result.

### Phase 4 — Request-scoped authorization reuse

- Resolve session, staff identity, roles, permissions, and scopes once per Core RPC and pass the
  immutable access context to nested read models.
- Return the resolved staff identity in that context so access helpers do not query it again.
- Remove the overview-to-audit duplicate authorization path without weakening audit permissions or
  location scopes.
- Add denial, role, capability, scope, expired-session, and nested-read regression tests.

Acceptance: each Core RPC performs at most one authorization-context resolution and all existing
authorization outcomes remain equivalent.

### Phase 5 — Set-based Admin read models and evidence-backed indexes

- Replace per-location overview exception fan-out with set-based queries across authorized selected
  location IDs. Keep query count bounded as the number of locations grows.
- Combine compatible overview counts using conditional aggregation where it improves measured work.
- Rewrite product list aggregation so SKU readiness, primary media, and current price are resolved
  once per relevant row set rather than through repeated correlated subqueries.
- Evaluate search separately; do not add FTS or change search semantics without measured need and an
  approved contract decision.
- Use production rows-read/rows-returned evidence and `EXPLAIN QUERY PLAN` before adding ordering,
  status, partial, or covering indexes.

Acceptance: query count is bounded, query plans avoid unjustified scans/temporary sorts, multi-market
and multi-location semantics remain correct, and fresh/populated migrations pass.

### Phase 6 — Lower-priority client payload optimization

- Load chart libraries only when chart content is rendered.
- Evaluate Admin/storefront font and style boundaries from production transfer and rendering data.
- Keep accessibility, Admin design tokens, responsive layouts, and visual baselines unchanged.

Acceptance: reduced Admin transferred/parsed JavaScript or font cost with no visual or accessibility
regression.

### Phase 7 — Integrated verification and closeout

- Run naming checks when repository structure, routes, migrations, or source names change.
- Run type checks, lint, focused unit/integration tests, Worker-local integration tests, relevant
  Playwright Admin flows, production builds, and performance traces.
- Compare the same cold/warm scenarios and production percentiles captured in Phase 1.
- Update canonical contracts/data documentation for approved DTO or schema changes, then update
  `IMPLEMENTATION_STATUS.md` as a descriptive record.

Acceptance: performance budgets established in Phase 1 are met or deviations are explicitly
documented; no correctness, authorization, scope, accessibility, or visual regression remains.

## Phase 1 execution record — 2026-09-01

Implementation is complete and locally verified; production-baseline acceptance remains pending.

- Every Admin Web adapter now selects one bounded UUID, forwards it in both the typed Core input and
  `x-request-id`, returns it in the browser-safe response header, and emits a safe structured
  completion record. Invalid inbound identifiers are replaced rather than propagated.
- Admin responses expose `Server-Timing` entries for synchronous JSON serialization and total Web
  adapter duration. Core custom spans measure total RPC, Better Auth session resolution, aggregate
  IAM resolution and its staff/role/permission/scope stages, and the named Admin overview, scope,
  and product-list D1 reads. D1 spans record duration, SQL duration, rows read, rows written, rows
  returned, and retry attempts when the binding provides them.
- Core structured RPC completion records contain only correlation ID, bounded operation name,
  duration, result, and safe error code. They do not serialize request headers, bodies, principals,
  query values, customer data, provider data, or error messages.
- Instrumented Core RPC baselines are Admin context, Admin scopes, Admin overview, product list, and
  Product creation as the representative command. All other Admin adapters receive Web correlation,
  serialization timing, total adapter timing, and response correlation.
- No schema, migration, index, projection, cache, infrastructure, authorization, capability, scope,
  business-rule, RPC DTO, or typed-contract change was made.

The pre-instrumentation local directional findings remain approximately 400 ms for context, 742 ms
for scopes, 1.89 seconds for overview, 4.2 seconds to useful overview data, and 287–393 ms for warm
overview requests. They are not production percentiles and therefore are not performance budgets.

Production p50/p95/p99 and cold/warm after-measurements could not be captured: the authenticated
Cloudflare account reports that neither configured Worker exists, and this phase does not authorize
deploying uncommitted code or inventing a production environment. No budget is established. Before
Phase 2 begins, the owner must provide or authorize a production/representative deployment with an
authenticated, scope-controlled Admin measurement principal; the same context, scopes, overview,
product-list, and representative-command scenarios must then be sampled and recorded here.

## Phase 2 execution record — 2026-09-01

Implementation and acceptance validation are complete.

- Automatic vinext prefetch is disabled at the Admin-to-Marketplace boundary, throughout the
  Core-authorized Admin shell navigation, in workspace tabs, and for dense create/detail links.
  Ordinary anchors remain in the Product row list where filter-preserving detail URLs are built.
- The installed vinext production implementation was verified to honor `prefetch={false}` for both
  viewport and intent prefetch in App Router mode. A managed local Worker stack then captured actual
  browser requests: an idle Product list issued no router-prefetch request for the Marketplace,
  Product creation, or visible Product detail destinations.
- Intentional Product creation navigation retained its URL and loaded the expected destination.
  Existing navigation, workspace, accessibility, and Product-list tests remain green.
- Validation: Web typecheck passed; five focused Vitest files passed with 47 tests; the production
  vinext build passed; and the managed Web/Core/D1 Playwright flow passed both prefetch tests.
- No schema, migration, RPC, contract, authorization, business-rule, cache, index, projection, or
  infrastructure change was made. The production build continues to report its pre-existing large
  client-chunk warning, which is evidence to inspect in Phase 6 rather than grounds for an
  unmeasured optimization here.

## Phase 3 execution record — 2026-09-01

Implementation and acceptance validation are complete.

- Core now exposes `getAdminBootstrap(AdminBootstrapRequest) -> AdminBootstrapView`, one
  purpose-built first-render composition containing the Staff Admin context, reachable active scope
  options, Core-proven selection evidence, and the initial scope-aware Overview when a scope is
  available. The Web adapter delegates exactly one typed Service Binding RPC.
- The client provider performs one `/api/admin/bootstrap` browser request instead of parallel
  context/scopes requests followed by Overview. A validated browser preference is accepted only
  when currently reachable. Stale or tampered evidence is rejected and safely falls back to the
  sole assigned scope or an explicit selection-required state; it never grants scope authority.
- Market and Location selections use the canonical configured timezone. Global selection retains
  an explicitly supplied, Core-validated IANA timezone. Context loading, unauthenticated,
  forbidden, selection-required, network-error, and retry states remain explicit.
- A production-build managed Web/Core/D1 browser test observed exactly one first-render Admin read,
  `/api/admin/bootstrap`; `/api/admin/context`, `/api/admin/scopes`, and `/api/admin/overview` were
  absent. The Overview rendered useful operational data, and the existing authenticated,
  unauthenticated, non-Staff, responsive-navigation, breadcrumb, and token-isolation flows passed.
- Validation: all three package type checks passed; 16 focused contract tests, 51 focused Web unit
  tests, 13 focused Core Worker integration tests, and 8 managed Playwright tests passed. The
  production vinext build passed with the already-recorded large-chunk warning.
- No schema, migration, cache, index, projection, infrastructure, capability, authorization,
  business-rule, or lifecycle change was made. The typed RPC/DTO addition is documented in
  `API_CONTRACTS.md`.

The directional pre-Phase-1 trace had three browser reads and about 4.2 seconds to useful Overview
data. Phase 3 proves the browser request-count reduction from three to one in the managed stack;
production cold/warm percentiles remain unavailable, so no latency budget or percentile claim is
established.

## Phase 4 execution record — 2026-09-01

Implementation and acceptance validation are complete.

- Core's internal authorization resolution now returns one immutable request-scoped access context
  containing Better Auth principal evidence, canonical capabilities/scopes, and the already-resolved
  Staff identity. The public application-context RPC strips the internal Staff evidence and retains
  its existing DTO.
- Admin context, scope options, Overview, nested Audit, and all Catalog, Customer, Finance, Staff,
  Promotion, Operations, and Audit access helpers consume the resolved Staff identity instead of
  querying it again. Bootstrap resolves the access context once and passes it to every nested read.
- A direct Worker integration assertion proves one `getSession` invocation across bootstrap,
  context, scopes, Overview, and nested Audit. Reuse is limited to one RPC invocation; there is no
  cross-request authorization cache.
- Validation: Core typecheck and zero-warning lint passed; 13 focused Core files passed 101 tests,
  covering unauthenticated and non-Staff access, roles/capabilities, global and operational scopes,
  stale scope evidence, revoked sessions, nested Audit, and the major Admin read families. The
  production-build managed stack passed the same 8 Admin bootstrap/foundation Playwright flows.
- No schema, migration, RPC, public DTO, capability, authorization outcome, business rule, index,
  projection, cache, or infrastructure change was made. The internal request-context behavior is
  recorded in `ARCHITECTURE.md` and `API_CONTRACTS.md`.

Production percentile after-measurements remain unavailable. Local evidence establishes a strict
authorization-resolution count reduction for bootstrap from three independent resolutions to one;
it does not establish a production latency percentile or budget.

## Phase 5 execution record — 2026-09-01

The evidence-independent query refactors are complete and locally verified. Index authorization
remains intentionally pending.

- Operational exceptions now use one bounded `UNION ALL` projection across an arbitrary authorized
  location set. A JSON table-valued scope input keeps both D1 statement count and bind count
  constant as location count grows. The Overview no longer performs four exception queries per
  location; its exception list and open-exception count are each one set-based statement.
- Product listing pages the relevant Products first, ranks the current location-over-market price
  once per relevant SKU, aggregates SKU readiness and price range once per Product, and resolves
  primary media once per Product. The four separate global readiness reads are one conditional,
  set-based readiness statement. Existing search, status, cursor, price precedence, availability,
  primary-media, and multi-scope DTO semantics are unchanged.
- Query-count evidence: the Overview exception list changed from `4 × location count` statements
  to one; a two-location Worker integration test asserts one D1 statement. Product list readiness
  changed from four D1 statements to one, while the repeated per-Product/per-SKU correlated
  subqueries were replaced by CTE/window/grouped sets.
- Populated local D1 `EXPLAIN QUERY PLAN` for the exact generated SQL shows no correlated scalar
  subquery in the Product page/readiness plans. Existing indexes are used for category PK,
  `price_version_scope_active_idx`, primary media, SKU/location availability, and owning-record
  joins. It still reports Product/SKU/source scans and temporary ordering for the Product page,
  current-price ranking, and exception union. Those are candidates for production rows-read
  investigation, not index authorization.
- Validation: Core typecheck and zero-warning lint passed; 6 focused Core Worker files passed 41
  tests, including pagination/filtering over more than 100 Products, explicit pricing context,
  price/availability/media readiness, multi-location exception semantics, Overview scopes, and
  authorization reuse. The production vinext build and 4 managed Admin bootstrap/Catalog
  Playwright reads passed.
- No schema, migration, index, FTS, projection, cache, RPC, DTO, authorization, capability,
  business-rule, or infrastructure change was made.

Production rows-read/rows-returned evidence remains unavailable because no configured production
Worker exists. Consequently no index or projection is approved in this phase, and the remaining
scan/temp-sort observations are recorded rather than guessed away.

## Phase 6 execution record — 2026-09-01

Implementation and focused payload acceptance validation are complete.

- Recharts is no longer a static dependency of the Overview, Analytics chart grid, or Payments
  overview components. Bar and line renderers are separate lazy client boundaries and are requested
  only when an available, non-empty chart is actually rendered. Empty Overview and zero-workload
  Payments states retain explicit text instead of downloading a chart runtime for an empty plot.
- The production build isolates the shared Recharts Cartesian runtime in a 335,918-byte minified
  chunk, with 21,057-byte bar and 17,440-byte line renderer chunks. A non-chart Overview therefore
  avoids at least 356,975 minified artifact bytes that were previously reachable from the eagerly
  imported Overview component. These are build-artifact bytes, not compressed production transfer
  measurements.
- A production-build managed Web/Core/D1 browser assertion proves that the seeded empty Overview
  requests neither chart renderer. The same trace proves the Admin route requests its scoped DM
  Sans Latin font and does not request the storefront Open Sans or Outfit Latin fonts. No font,
  global style, token, or Admin/storefront boundary change was justified.
- Validation: Web typecheck passed; 17 focused Admin Vitest files passed 82 tests; the production
  vinext build passed; and the managed bootstrap payload/font/chart assertion passed. Existing
  chart summaries remain available to assistive technology while visual chart containers remain
  decorative.
- The repository's existing full-page visual baselines are currently stale against unrelated Admin
  shell changes already present in the dirty worktree (branding/header/navigation and responsive
  shell dimensions). After correcting the Phase 3 bootstrap fixture, all three viewport runs render
  the expected chart data consistently, but the full-page baseline comparison still fails outside
  this phase's chart boundary. Baselines were not silently replaced, and the mismatch is carried to
  Phase 7 closeout.
- No schema, migration, RPC, DTO, authorization, capability, business-rule, index, projection,
  cache, infrastructure, design-token, or font change was made.

Production transfer/parse timing and cold/warm percentile evidence remain unavailable because no
configured production Worker exists. The local artifact and browser-request evidence supports the
conditional-loading change but does not establish a production payload or latency budget.

## Phase 7 execution record — 2026-09-01

Integrated local verification is complete; production and visual acceptance remain explicitly
pending.

- Formatting, naming, canonical terminology, fresh/populated migrations, architecture boundaries,
  readiness/security rules, zero-warning lint, all workspace type checks, and vinext compatibility
  (`100%`, 14 supported, 0 partial, 0 issues) passed.
- The complete package suite passed 1,503 tests across 265 files: Config 2, Contracts 77,
  Domain-shared 2, Validation 2, Web 561, and Core Worker 859. Core's Wrangler production dry-run
  and the Web vinext production build passed. The Web build retains its non-fatal large-chunk
  advisory, whose largest artifact is the route-isolated 1,827,109-byte Mapbox GL chunk rather than
  a shared Admin bootstrap dependency.
- The managed production-build Web/Core/D1 browser matrix passed 90 flows with two
  environment-gated skips. It covers authentication/Staff denial, capabilities, Global and
  operational scopes, bootstrap request count, idle-prefetch suppression, Catalog, Customer,
  Finance, Operations, Promotions, Analytics, Staff, responsive/focus behavior, and representative
  customer journeys. Deterministic fixtures were migrated from the removed context/scopes browser
  waterfall to the typed bootstrap result.
- The three full-page Admin visual checks consistently render their chart content but fail against
  committed baselines because the dirty worktree already contains unrelated shell branding,
  navigation, and responsive-dimension changes. The baselines were preserved for owner review;
  this pass does not claim visual acceptance while that mismatch remains.
- `IMPLEMENTATION_STATUS.md` now records the pass as descriptive implementation status.
  `ARCHITECTURE.md` and `API_CONTRACTS.md` record the approved request-scoped authorization and
  bootstrap contract decisions. No data-model document or migration update was needed.
- No schema, migration, index, projection, FTS, cache, queue, Durable Object, Workflow,
  infrastructure, public API, authentication policy, capability, operational-scope, or locked
  business-invariant change was made.

Phase 7 cannot compare production cold/warm percentiles or evaluate an evidence-derived budget:
Phase 1 found no configured production Worker and deployment was not authorized. Production
p50/p95/p99, rows-read/rows-returned, and transfer/parse sampling must occur after the owner provides
or authorizes a representative deployment and controlled Admin principal. Until then, there is no
approved SLO and no authorization for speculative D1 indexes or projections.

## Model and token-efficiency strategy

- Use `gpt-5.6-sol` with medium reasoning as the orchestrator and for Phases 3–5.
- Use `gpt-5.6-luna` with medium reasoning for Phases 1–2, Phase 6, and routine Phase 7 validation.
- Escalate SOL from medium to high only after one failed medium attempt where the blocker is a
  cross-domain authorization/contract ambiguity, a D1 correctness/concurrency problem, or a
  persistent vinext/Workers integration failure. Do not use high merely for broader exploration.
- Execute one phase at a time in the same task. Read only that phase's routed canonical documents,
  reuse the recorded baseline, and avoid parallel agents unless the owner explicitly requests them.
- Require a concise handoff after every phase: changes, contracts/schema, tests, measurements,
  deviations, and the next phase's reliable inputs.
