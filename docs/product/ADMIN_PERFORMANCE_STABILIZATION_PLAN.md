# FreshMarkets Admin Performance Stabilization Plan

Status: phased execution in progress; Phases 1 and 2 locally implemented and verified.

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
