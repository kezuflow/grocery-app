# Architecture and Security Hardening Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make FreshMarkets' Worker boundaries, RPC composition, request handling, security headers, correlation, readiness, and dependency rules executable without changing the two-Worker modular-monolith architecture.

**Architecture:** `CoreEntrypoint` stays the single named Service Binding entrypoint but delegates validation and authorization to bounded-context RPC adapters. Web and Core share stable behavior through typed contracts while repository scripts mechanically enforce layer direction. Public body parsing, headers, request correlation, and readiness fail closed at transport boundaries and never move business authority out of Core.

**Tech Stack:** TypeScript 7, Cloudflare Workers/Service Bindings/D1, vinext, Zod-compatible `@freshmarkets/validation`, Vitest Workers pool, Playwright, Node TypeScript compiler API, pnpm.

**Spec:** `docs/superpowers/specs/2026-08-30/ARCHITECTURE_SECURITY_HARDENING_DESIGN.md`

## Closeout Status

- [x] Tasks 1–3: integrated baseline, executable dependency rules, and exact contract/runtime conformance.
- [x] Tasks 4–5 authorized scope: non-Admin/non-Maps RPC adapters and structural boundary tests.
- [ ] Tasks 4–5 excluded scope: Admin and Maps transport extraction was deliberately not performed because the user excluded both simultaneous programs.
- [x] Tasks 6–9: bounded bodies, request correlation, security headers, readiness, observability, generated types, and warning hygiene.
- [x] Task 10 documentation and acceptance matrix, including the deterministic managed-stack browser run.
- [ ] Task 10 landing commit and integration to `main` (performed only after independent review).

The unchecked excluded-scope item is a documented plan deviation, not remaining authorization. The
Core composition boundary test locks the resulting exception so later work cannot mistake it for an
unreviewed architecture decision.

## Global Constraints

- Do not begin shared-file implementation until both Admin Dashboard and Maps work are committed to `main` and this remediation history is replayed onto that state.
- Preserve one `apps/core` Worker, one `apps/web` Worker, Core D1 authority, and Service Binding RPC; introduce no public business REST API, microservice, Durable Object, Workflow, KV, or Queue.
- Do not redesign Admin UX or Maps behavior. Transport refactors preserve every landed method, route, CSP source, capability check, and DTO.
- Web never imports Core source or authoritative infrastructure. Contracts never depend on Worker, D1, Drizzle, schemas, rows, or app implementation types.
- Request bodies are bounded before parsing, body content is never logged, and webhook signature verification receives the exact bounded raw bytes/text.
- Request IDs are UUIDs, are generated once per Web request when absent/invalid, reach Core unchanged, and return in headers and safe errors.
- Production CSP contains no `unsafe-eval`; Maps sources are retained exactly as approved by the landed Maps program.
- Follow TDD for every behavior: observe RED, implement minimally, observe GREEN, refactor, and commit a coherent slice.

---

### Task 1: Integration Prerequisite and Post-Maps Baseline

**Files:**
- Modify only through Git integration: the remediation commit range beginning at `bf809e5` through the Program 2 closeout commit
- Inspect: `apps/core/src/index.ts`
- Inspect: `packages/contracts/src/index.ts`
- Inspect: `apps/web/next.config.ts`
- Inspect: landed Maps and Admin final reports under `docs/superpowers/reports/`
- Create: `docs/superpowers/reports/ARCHITECTURE_SECURITY_BASELINE.md`

**Interfaces:**
- Consumes: completed Admin and Maps commits on `main`, plus Programs 1–2 remediation commits.
- Produces: one clean, integrated baseline whose exact RPC/route/CSP surface later tasks must preserve.

- [ ] **Step 1: Verify coordination is complete**

Run:

```powershell
git fetch origin main
git status --short
git log --oneline -20 origin/main
```

Expected: Admin and Maps final commits/reports are present, no active task owns shared files, and the main checkout has no unrelated uncommitted changes. If Maps is still active, stop this task without editing shared files.

- [ ] **Step 2: Replay the verified remediation range onto current `main`**

Use a protective worktree per repository policy and replay each coherent Program 1–2 commit in order. Resolve conflicts by preserving landed Admin/Maps behavior and reapplying the remediation invariant, never by choosing one whole side of `apps/core/src/index.ts`, `packages/contracts/src/index.ts`, checkout, CSP, or shell conflicts.

- [ ] **Step 3: Record the executable baseline**

Create `ARCHITECTURE_SECURITY_BASELINE.md` with: integrated commit, `wc`/line counts for Core entrypoint and contract barrel, every `CoreServiceBinding` method, every unbounded public-body call, existing security headers, actionable lint warnings, and the exact initial verification results.

- [ ] **Step 4: Run the integration gate**

Run:

```powershell
pnpm naming:check
pnpm migration:check
pnpm catalog:check
pnpm typecheck
pnpm test
pnpm -r build
```

Expected: all pass before architecture edits. Preserve separately owned failures with exact evidence rather than masking them.

- [ ] **Step 5: Commit the baseline**

```powershell
git add docs/superpowers/reports/ARCHITECTURE_SECURITY_BASELINE.md
git commit -m "docs(hardening): record post-integration baseline"
```

### Task 2: Executable TypeScript Dependency Boundaries

**Files:**
- Create: `scripts/verify-architecture-boundaries.mjs`
- Create: `scripts/verify-architecture-boundaries.test.mjs`
- Modify: `package.json`
- Modify: `docs/architecture/ARCHITECTURE.md`

**Interfaces:**
- Consumes: tracked TypeScript/TSX source and `typescript` already installed in the workspace.
- Produces: `pnpm architecture:check`, a zero-dependency import-rule verifier with exported `analyzeSourceFile(fileName, sourceText)` test seam.

- [ ] **Step 1: Write failing fixture tests**

Test `analyzeSourceFile` with in-memory imports proving these rules fail with file, line, and stable code: `WEB_IMPORTS_CORE`, `CONTRACT_IMPORTS_INFRASTRUCTURE`, `DOMAIN_IMPORTS_OUTWARD`, `APPLICATION_IMPORTS_TRANSPORT`, `PROVIDER_LEAK`, `ENTRYPOINT_SQL`, and `CONTRACT_EXPORTS_ROW`. Include legal port/type-only imports that must pass.

- [ ] **Step 2: Observe RED**

Run:

```powershell
node --test scripts/verify-architecture-boundaries.test.mjs
```

Expected: FAIL because the verifier module does not exist.

- [ ] **Step 3: Implement the compiler-API verifier**

Use `typescript.createSourceFile` and AST import/export/call inspection. Scan only tracked `apps/**` and `packages/**` TypeScript files, exclude generated declarations, and encode narrow repository-owned allowlists as named data with comments. Never use regex as the primary import parser.

- [ ] **Step 4: Repair current non-Admin/non-Maps violations**

Move dependencies behind existing ports or contract DTOs. Do not allowlist a violation merely because it exists. Admin/Maps violations require their now-landed owner behavior to be preserved while imports are corrected.

- [ ] **Step 5: Add the repository command and run GREEN**

Add:

```json
"architecture:check": "node scripts/verify-architecture-boundaries.mjs"
```

Run unit fixtures and `pnpm architecture:check`; both must pass.

- [ ] **Step 6: Commit**

```powershell
git add scripts/verify-architecture-boundaries.mjs scripts/verify-architecture-boundaries.test.mjs package.json docs/architecture/ARCHITECTURE.md apps packages
git commit -m "test(architecture): enforce TypeScript dependency direction"
```

### Task 3: Contract Conformance and Barrel Cleanup

**Files:**
- Modify: `packages/contracts/src/core-service.ts`
- Modify: `packages/contracts/src/index.ts`
- Modify: bounded contract modules in `packages/contracts/src/`
- Modify: `packages/contracts/src/core-service.test.ts`
- Create: `apps/core/src/entrypoint/core-service-conformance.test.ts`
- Modify: `apps/web/lib/core-client/core.ts`
- Modify: `apps/web/lib/core-client/core.test.ts`

**Interfaces:**
- Consumes: every landed Core RPC public method.
- Produces: authoritative bounded-context service interfaces, `CoreServiceBinding`, and one documented Web cast only at the opaque Cloudflare binding edge.

- [ ] **Step 1: Write failing compile/runtime conformance tests**

Declare:

```ts
const coreServiceConformance: CoreServiceBinding = new CoreEntrypoint(
  {} as ExecutionContext,
  testEnv,
);
```

Also assert the runtime prototype exposes every and only contract methods plus `fetch`/`scheduled`. Seed a fake advertised method to prove the test fails when a contract has no implementation.

- [ ] **Step 2: Observe RED**

Run the focused Contracts/Core/Web tests and capture missing, duplicated, legacy-barrel, or over-advertised members.

- [ ] **Step 3: Move production types to bounded modules**

Move remaining request/view/service definitions out of `packages/contracts/src/index.ts`. Keep `index.ts` as exports and explicitly named temporary aliases only. Remove aliases after `rg` proves no caller remains.

- [ ] **Step 4: Close the binding surface**

Move a method into `CoreServiceBinding` only with its implementation and test. Delete unimplemented advertisements. Document the sole Web cast with why Wrangler's opaque generated binding requires it.

- [ ] **Step 5: Run GREEN**

Run focused tests, Contracts/Core/Web typechecks, and `pnpm architecture:check`.

- [ ] **Step 6: Commit**

```powershell
git add packages/contracts apps/core/src/entrypoint/core-service-conformance.test.ts apps/web/lib/core-client
git commit -m "refactor(contracts): enforce Core RPC conformance"
```

### Task 4: Core RPC Adapter Composition Foundation

**Files:**
- Create: `apps/core/src/entrypoint/context.ts`
- Create: `apps/core/src/entrypoint/validation-errors.ts`
- Create: `apps/core/src/entrypoint/auth-rpc.ts`
- Create: `apps/core/src/entrypoint/catalog-rpc.ts`
- Create: `apps/core/src/entrypoint/customer-rpc.ts`
- Create: `apps/core/src/entrypoint/membership-rpc.ts`
- Create tests beside each adapter
- Modify: `apps/core/src/index.ts`

**Interfaces:**
- Produces: `CoreRpcContext` containing database, auth, clock, provider registry, route/geocoder ports, runtime config, and safe logging; `validationFailure(requestId, issues)`; adapter factories returning typed method sets.
- Consumes: existing application commands/queries without moving SQL or domain policy into adapters.

- [ ] **Step 1: Write adapter characterization tests**

For each context, assert valid request delegation, schema rejection, unauthenticated/customer-disabled behavior, stable request ID, and purpose-built DTO equality against the current entrypoint.

- [ ] **Step 2: Observe RED**

Run the new adapter tests; expected failure is missing modules.

- [ ] **Step 3: Implement shared context and validation errors**

Create dependencies once per Worker environment. Adapters receive `CoreRpcContext`; they do not construct provider/runtime/auth state per method and contain no `.prepare`, `drizzle`, SQL string, or lifecycle switch.

- [ ] **Step 4: Move the four bounded method groups**

Move validation/context/authorization/delegation from `index.ts` into adapters. `CoreEntrypoint` fields forward with `return this.rpc.customer.listCustomerAddresses(input)` style calls. Preserve exact public names and results.

- [ ] **Step 5: Run GREEN and architecture checks**

Run focused adapter tests, existing integration tests for these contexts, typecheck, and the dependency verifier.

- [ ] **Step 6: Commit**

```powershell
git add apps/core/src/entrypoint apps/core/src/index.ts
git commit -m "refactor(core): extract identity and catalog RPC adapters"
```

### Task 5: Commerce, Payments, Orders, Scheduling, and Operations RPC Adapters

**Files:**
- Create: `apps/core/src/entrypoint/checkout-rpc.ts`
- Create: `apps/core/src/entrypoint/payments-rpc.ts`
- Create: `apps/core/src/entrypoint/orders-rpc.ts`
- Create: `apps/core/src/entrypoint/operations-rpc.ts`
- Create: `apps/core/src/entrypoint/scheduling-rpc.ts`
- Create tests beside each adapter
- Modify: `apps/core/src/index.ts`

**Interfaces:**
- Consumes: `CoreRpcContext` from Task 4 and existing idempotent application commands.
- Produces: remaining non-Admin typed RPC method sets; `index.ts` retains only construction, forwarding, `fetch`, `scheduled`, and export.

- [ ] **Step 1: Write characterization tests for every method group**

Cover invalid schema, customer/staff/rider scope, explicit time, provider selection, idempotency forwarding, and response/request-ID preservation. Tests must verify adapters call one application command/query and never synthesize state.

- [ ] **Step 2: Observe RED, implement, and run GREEN one adapter at a time**

For each file: run its test RED, move only transport behavior, run focused existing integration tests GREEN, and inspect `git diff` before proceeding.

- [ ] **Step 3: Integrate landed Admin transport without changing Admin behavior**

Create `apps/core/src/entrypoint/admin-rpc.ts` only after the other adapters are stable. Mechanically move landed Admin validation/capability/scope/delegation, retaining every public method and test. Do not touch Admin UI, information architecture, or business policy.

- [ ] **Step 4: Prove the entrypoint is composition-only**

Add a structural assertion that `apps/core/src/index.ts` contains no `.prepare(`, `drizzle(`, validation schema declarations, capability vocabulary, provider-event translation, or domain state transition.

- [ ] **Step 5: Run the full Core suite and commit**

```powershell
pnpm --filter @freshmarkets/core test
pnpm --filter @freshmarkets/core typecheck
pnpm architecture:check
git add apps/core/src/entrypoint apps/core/src/index.ts
git commit -m "refactor(core): compose bounded RPC adapters"
```

### Task 6: Bounded Request Body Primitives

**Files:**
- Create: `apps/web/lib/http/bounded-body.ts`
- Create: `apps/web/lib/http/bounded-body.test.ts`
- Create: `apps/core/src/http/bounded-body.ts`
- Create: `apps/core/src/http/bounded-body.test.ts`
- Modify: `apps/core/src/payments/http/provider-webhook.ts`
- Modify: `apps/web/lib/auth/proxy.ts`

**Interfaces:**
- Produces: `readBoundedText(request, { maxBytes, contentTypes })` and `readBoundedJson(request, schema, { maxBytes, contentTypes? })` returning a discriminated success/error with status `400|413|415` and stable safe code.
- Guarantees: byte counting via `ReadableStreamDefaultReader`, early `Content-Length` rejection, exact text retention, and no body logging.

- [ ] **Step 1: Write failing helper tests**

Cover missing/valid content type, charset parameters, malformed/negative/oversized `Content-Length`, chunked stream crossing the limit, multibyte UTF-8 bytes, malformed JSON, schema failure, aborted stream, and exact webhook raw-text preservation.

- [ ] **Step 2: Observe RED and implement Web/Core helpers**

Share behavior through identical small implementations or a deployment-neutral package only if that package imports no Worker/app types. Do not buffer with `request.text()`, `json()`, or `arrayBuffer()` before enforcing the limit.

- [ ] **Step 3: Bound Auth and webhook bodies**

Define named limits (`AUTH_REQUEST_MAX_BYTES`, `AUTH_RESPONSE_MAX_BYTES`, `PAYMENT_WEBHOOK_MAX_BYTES`) near their route family. Verify signature against the exact bounded raw body. Return 413/415/400 without provider invocation and without logging body data.

- [ ] **Step 4: Run focused security tests and commit**

```powershell
pnpm --filter @freshmarkets/web test -- lib/http/bounded-body.test.ts lib/auth/proxy.test.ts
pnpm --filter @freshmarkets/core test -- bounded-body.test.ts provider-webhook
git add apps/web/lib/http apps/web/lib/auth apps/core/src/http apps/core/src/payments/http
git commit -m "fix(security): bound auth and webhook request bodies"
```

### Task 7: Migrate JSON Route Families and Unify Request Correlation

**Files:**
- Create: `apps/web/lib/http/request-context.ts`
- Create: `apps/web/lib/http/request-context.test.ts`
- Modify: non-Maps Web API routes under `apps/web/app/api/`
- Modify: route-family tests
- Modify: `apps/web/lib/core-client/request.ts`
- Modify: `apps/core/src/observability.ts`

**Interfaces:**
- Produces: `webRequestContext(request): { requestId: string; coreHeaders: Record<string,string> }`, `jsonWithRequestId(body, requestId, init?)`, and per-family JSON body limits.
- Consumes: `readBoundedJson` from Task 6.

- [ ] **Step 1: Write failing correlation tests**

Assert a valid inbound UUID is preserved; invalid/oversized/non-UUID values are replaced; exactly one ID enters Core input and headers; success/error/validation responses return the same `x-request-id`; safe error JSON carries the same ID.

- [ ] **Step 2: Implement the request context**

Accept UUID only. Compute once at route start. Override forwarded `x-request-id` with that value instead of rereading caller headers downstream.

- [ ] **Step 3: Migrate customer/checkout/payment route families**

Replace unbounded `.json()` with bounded helpers in auth, membership, cart, quote, payment, order, and rider command routes. Maps-owned address search/serviceability routes are migrated only after replaying the landed Maps behavior and tests; do not change their semantics.

- [ ] **Step 4: Migrate Admin transport mechanically**

Apply the same helper to landed Admin JSON routes without changing schemas, actions, authorization, DTOs, or UI. A codemod/formatter is acceptable only after route tests prove representative GET/POST/PATCH/DELETE behavior.

- [ ] **Step 5: Verify no unbounded public body remains**

Run:

```powershell
rg -n "request\.(json|text)\(|arrayBuffer\(" apps/web/app/api apps/web/lib/auth apps/core/src
```

Expected: only bounded-helper internals or documented non-public/test code.

- [ ] **Step 6: Commit**

```powershell
git add apps/web/lib/http apps/web/lib/core-client/request.ts apps/web/app/api apps/core/src/observability.ts
git commit -m "fix(web): bound command bodies and preserve request IDs"
```

### Task 8: Complete the Web Security Header Policy

**Files:**
- Create: `apps/web/lib/security/headers.ts`
- Create: `apps/web/lib/security/headers.test.ts`
- Modify: `apps/web/next.config.ts`
- Modify: `apps/web/lib/runtime/runtime-configuration.ts`
- Modify: `apps/web/lib/runtime/runtime-configuration.test.ts`
- Modify: representative browser/API tests

**Interfaces:**
- Produces: `webSecurityHeaders(configuration)` returning CSP, Referrer Policy, nosniff, frame protections, Permissions Policy, and deployed HSTS.
- Consumes: landed Maps CSP image/connect/worker sources and approved auth/payment redirect origins.

- [ ] **Step 1: Write RED header tests**

Assert directives: `default-src 'self'`, production `script-src` without `unsafe-eval`, narrow style, `object-src 'none'`, `base-uri 'self'`, `frame-ancestors 'none'`, approved `form-action`, exact Maps sources, referrer, nosniff, least-privilege permissions, and HSTS only for deployed HTTPS.

- [ ] **Step 2: Implement environment-specific policy**

Keep local allowances explicit. Never derive production allowances from request headers. If vinext cannot support a nonce without breaking hydration, use the narrowest build-compatible hash/self policy and document/test the constraint; never silently add `unsafe-eval` in production.

- [ ] **Step 3: Verify auth/OAuth/payment and Maps acceptance**

Run HTML/API header tests plus live-stack auth redirects and the landed Maps browser flows. Confirm cookies, `Set-Cookie`, callback URL, Mapbox worker/connect/image requests, and provider return redirects still work.

- [ ] **Step 4: Commit**

```powershell
git add apps/web/lib/security apps/web/lib/runtime apps/web/next.config.ts apps/web/tests
git commit -m "fix(web): complete environment-safe security headers"
```

### Task 9: Readiness, Observability, Generated Types, and Warning Hygiene

**Files:**
- Modify: Core/Web health/readiness contracts and tests in `packages/contracts/src/`
- Modify: Core readiness implementation under `apps/core/src/entrypoint/` or `apps/core/src/runtime/`
- Modify: `apps/core/wrangler.jsonc`, `apps/web/wrangler.jsonc` only for verified environment-specific observability
- Regenerate: Core/Web `worker-configuration.d.ts`
- Modify: `scripts/verify-readiness-security.mjs`
- Modify: production files with actionable lint warnings outside Admin/Maps behavior
- Create/modify: deployment runbook under `docs/operations/`

**Interfaces:**
- Produces: distinct liveness/readiness DTOs, provider capability readiness, safe binding/config checks, environment-explicit sampling, and zero actionable production lint warnings.

- [ ] **Step 1: Write failing readiness tests**

Assert liveness never performs dependency work; readiness checks typed required configuration/binding presence with bounded probes; response exposes no secret/origin token; provider readiness reports code/capabilities and renewal ownership, not environment inference.

- [ ] **Step 2: Implement readiness and environment observability**

Keep financial failure/outcome application logs explicit and safe. Configure preview/staging/production sampling deliberately. Add static scans for cookies, auth headers, action URLs/tokens, webhook bodies, provider payloads, password/reset links, and precise address snapshots in log calls.

- [ ] **Step 3: Verify Wrangler release/config and regenerate types**

Read current official Wrangler release/config documentation, run `wrangler types` for both apps, and commit generated changes only with passing typecheck/build. Do not blindly bump compatibility dates or Wrangler.

- [ ] **Step 4: Eliminate actionable non-excluded warnings**

Run `pnpm lint`. Remove unused production imports/variables and invalid expressions. Admin/Maps warnings are fixed only mechanically after owner behavior is landed; do not change their functionality.

- [ ] **Step 5: Document edge controls**

Record Cloudflare rate-limit/WAF expectations for public auth, reset, address search, checkout initiation, and webhook endpoints. State that edge controls do not replace idempotency or signature verification.

- [ ] **Step 6: Commit**

```powershell
git add packages/contracts apps/core apps/web scripts/verify-readiness-security.mjs docs/operations
git commit -m "fix(readiness): separate liveness and dependency readiness"
```

### Task 10: Canonical Documentation and Full Acceptance

**Files:**
- Modify: `docs/architecture/ARCHITECTURE.md`
- Modify: `docs/architecture/API_CONTRACTS.md`
- Modify: `docs/product/IMPLEMENTATION_PLAN.md`
- Modify: `docs/product/IMPLEMENTATION_STATUS.md`
- Create: `docs/superpowers/reports/ARCHITECTURE_SECURITY_HARDENING_FINAL.md`
- Modify: this plan's checkboxes

**Interfaces:**
- Consumes: implemented behavior and evidence from Tasks 1–9.
- Produces: canonical alignment and a truthful launch-hardening report for Program 4.

- [ ] **Step 1: Update canonical ownership and transport rules**

Document adapter composition, contract authority, executable layer checks, bounded-body status semantics, security headers, one-ID correlation, liveness/readiness separation, observability redaction, and edge-control ownership. Do not document planned behavior as implemented.

- [ ] **Step 2: Run the complete acceptance matrix**

```powershell
pnpm format:check
pnpm naming:check
pnpm migration:check
pnpm catalog:check
pnpm architecture:check
pnpm lint
pnpm typecheck
pnpm test
pnpm -r build
pnpm audit --json
pnpm --filter @freshmarkets/web check:vinext
node scripts/verify-readiness-security.mjs
```

Run live, non-skipped Playwright for storefront auth/checkout, representative Admin transport, and all landed Maps flows affected by CSP/request changes.

- [ ] **Step 3: Inspect forbidden patterns**

Search for unbounded bodies, raw provider payload persistence/logging, secret/cookie/auth logging, Web-to-Core source imports, SQL in entrypoint adapters, loopback/development production defaults, unsafe production CSP, and mismatched request-ID generation.

- [ ] **Step 4: Write the final report**

Record implemented work, important files, migrations (expected none), RPC changes, exact tests/counts, generated types, docs, deployment controls, deviations, and Program 4 dependencies.

- [ ] **Step 5: Commit**

```powershell
git add docs apps packages scripts package.json pnpm-lock.yaml pnpm-workspace.yaml
git commit -m "docs(hardening): record architecture security acceptance"
```

---

## Program Acceptance

- The Admin and Maps prerequisite is satisfied and their behavior survives integration.
- `CoreEntrypoint` is a small composition/forwarding surface with bounded-context transport adapters and no SQL/domain policy.
- Contracts advertise exactly the runtime RPC surface and bounded files own production types.
- Seeded illegal imports fail the TypeScript AST verifier; the repository passes it.
- Auth, webhook, and all public command routes reject malformed, unsupported, and oversized bodies before unbounded buffering.
- Production security headers are complete and compatible with auth/payment/Maps acceptance.
- One validated request ID reaches Core and returns to the browser across success and failure.
- Liveness/readiness and provider capabilities are distinct, bounded, and secret-free.
- Audit has no known moderate-or-higher production finding and production lint has no actionable warnings.
- All repository and live browser gates pass without skipped acceptance evidence.
