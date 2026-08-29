# Admin and Platform Readiness Slice 9 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Harden the existing FreshMarkets Web/Core MVP for accessibility, security, performance, and Worker-local/production readiness without adding product functionality or infrastructure.

**Architecture:** Keep Web as the presentation/BFF Worker and Core as the authoritative typed Service Binding Worker. Readiness work observes and tests the existing path, fixes shared presentation/boundary defects in place, and adds operational verification/runbooks; it does not introduce a new authority, migration, service, queue, Durable Object, workflow, or analytics projection.

**Tech Stack:** TypeScript, Cloudflare Workers, vinext, D1, Vitest, Playwright, Wrangler, `vinext check`, Oxfmt/Oxlint, existing health and Core Service Binding clients.

**Spec:** `docs/superpowers/specs/ADMIN_READINESS_SLICE_9_DESIGN.md`

## Global Constraints

- `apps/core` remains the sole business, authorization, and D1 authority; Web never reads business D1.
- Preserve Better Auth/Core session ownership, typed contracts, capability plus market/location scope checks, and request/correlation IDs.
- Do not add public general-purpose HTTP APIs, CORS, Durable Objects, Queues, Workflows, external analytics infrastructure, or schema migrations for readiness work.
- Do not weaken production fail-closed behavior for mock payments, route providers, email, secrets, or trusted origins.
- Use existing shadcn-source primitives and Admin compositions; do not create a parallel design system.
- Preserve `docs/superpowers/plans/DOORDASH_REFERENCE_FRONTEND_PLAN.md` and all unrelated owner edits.
- Authenticated Playwright flows may remain environment-gated only when the missing auth-email transport is recorded as the reason; no test bypass may weaken authorization.
- Any newly found cross-domain transaction or business-rule change is documented and parked for a separately approved phase.

---

### Task 1: Readiness baseline and shared boundary inventory

**Files:**

- Create: `docs/superpowers/reports/ADMIN_READINESS_SLICE_9_BASELINE.md`
- Create: `apps/web/app/api/admin/readiness-boundary.test.ts` if a shared route-test seam is needed
- Create: `apps/core/src/readiness/readiness-baseline.test.ts` if a Core health/readiness seam is needed
- Modify: only existing test/config files required to make baseline checks deterministic

**Interfaces:**

- Consumes current Admin shell, Core client/request forwarding, Core health/readiness, Wrangler configs, and existing test fixtures.
- Produces a measured inventory of accessibility, boundary, performance, and operational gaps with exact commands and environment limitations for Tasks 2–5.

- [ ] **Step 1: Run current baseline commands and capture evidence**

  Run `pnpm typecheck`, `pnpm lint`, `pnpm naming:check`, `pnpm migration:check`, `pnpm --filter @freshmarkets/web exec vinext check`, `pnpm --filter @freshmarkets/web test`, `pnpm --filter @freshmarkets/core test -- analytics.integration.test.ts`, `pnpm --filter @freshmarkets/web exec playwright test --list`, `pnpm --filter @freshmarkets/core build`, and `pnpm --filter @freshmarkets/web build`. Record exit codes, counts, warnings, and the existing full-Core Windows crash if it recurs.

- [ ] **Step 2: Inventory shared paths and risk surfaces**

  Inspect `apps/web/components/admin/admin-shell.tsx`, `apps/web/components/admin/admin-navigation.ts`, `apps/web/app/admin/layout.tsx`, `apps/web/lib/core-client/request.ts`, `apps/web/lib/core-client/core.ts`, `apps/core/src/index.ts`, both Wrangler configs, and representative admin routes/workspaces. Record direct D1 imports, raw response casts, missing labels/focus/status semantics, unbounded client work, unsafe defaults, and untested boundary cases.

- [ ] **Step 3: Write the baseline report**

  Use a table with `surface`, `evidence`, `risk`, `owner`, `planned task`, and `environment limitation`. Do not label an environment-gated check as passed. Run `git diff --check` and touched-file formatting, then commit `docs(readiness): record slice 9 baseline`.

**Acceptance:** The baseline is reproducible from the current tree, distinguishes code defects from environment blockers, and identifies exact files/tests for all remaining tasks without changing runtime behavior.

---

### Task 2: Shared Admin accessibility and state hardening

**Files:**

- Modify: `apps/web/components/admin/admin-shell.tsx`
- Modify: `apps/web/components/admin/admin-navigation.ts`
- Modify: shared Admin UI primitives/compositions under `apps/web/components/ui/` and `apps/web/components/admin/` only where the baseline identifies a defect
- Modify: representative workspace pages under `apps/web/app/admin/`
- Create or modify: `apps/web/components/admin/admin-accessibility.test.tsx`
- Create or modify: `apps/web/tests/admin-readiness.spec.ts`

**Interfaces:**

- Consumes existing typed Admin context/read models and shadcn-source primitives.
- Produces accessible shared shell behavior: semantic landmarks/headings, keyboard navigation, visible focus, focus return for the mobile sheet, explicit labels, status announcements, responsive table/card behavior, and non-color-only state text.

- [ ] **Step 1: Add failing component assertions**

  Test that the Admin shell exposes a `main` landmark and one page heading, navigation links are keyboard reachable with visible focus, the mobile menu trigger has an accessible name and returns focus after close, status badges expose text, loading/empty/error states use live/status semantics, and representative forms associate labels with controls.

- [ ] **Step 2: Add failing browser assertions**

  Extend the readiness Playwright spec with unauthenticated, forbidden, loading, empty, unavailable, error, and mobile keyboard scenarios using existing route mocks. Keep the current unauthenticated boundary tests intact and skip only authenticated flows blocked by the missing local email transport.

- [ ] **Step 3: Implement the smallest shared fixes**

  Correct semantic elements, `aria-*` relationships, focus management, status text, table headers, and responsive overflow/card fallbacks in shared components first. Do not add client-side business logic or optimistic command state. Preserve existing Admin navigation visibility from Core-provided capabilities.

- [ ] **Step 4: Verify accessibility changes**

  Run the focused Vitest and Playwright tests, Web typecheck, `vinext check`, and touched-file `oxfmt --check`. Run the existing unauthenticated Playwright suite and record any auth-email-gated skips.

- [ ] **Step 5: Commit**

  Commit `fix(readiness): harden admin accessibility states`.

**Acceptance:** Shared Admin behavior passes automated keyboard/semantic/state assertions at desktop and mobile widths; no authorization or business behavior changes; blocked/error states remain explicit and request-referenced.

---

### Task 3: Security and Web/Core boundary assurance

**Files:**

- Create or modify: `apps/web/lib/core-client/security-boundary.test.ts`
- Create or modify: `apps/web/app/api/admin/readiness-security.test.ts`
- Create or modify: `apps/core/src/readiness/security-boundary.integration.test.ts`
- Modify: `apps/web/lib/core-client/request.ts` or route adapters only when a test proves a forwarding defect
- Modify: `apps/core/src/index.ts` or authorization modules only when a test proves a boundary defect
- Create: `scripts/verify-readiness-security.mjs`

**Interfaces:**

- Consumes the existing typed Core Service Binding, `requestHeaders`, Better Auth application context, and capability/scope resolvers.
- Produces deterministic checks that Web forwards only approved request metadata, Core authenticates and authorizes before source reads, and source/configuration contains no newly introduced secret or unsafe production default.

- [ ] **Step 1: Add failing forwarding and denial tests**

  Assert cookie and correlation/request headers reach Core, Web routes do not import D1 bindings or raw schema modules, unauthenticated requests return `UNAUTHENTICATED`, missing capability returns `FORBIDDEN`, forbidden market/location returns `FORBIDDEN`, malformed input returns `VALIDATION_FAILED`, and provider/auth payloads are absent from DTOs/log assertions.

- [ ] **Step 2: Add static security checks**

  Implement `scripts/verify-readiness-security.mjs` to scan tracked source/config files for committed credential patterns, production configs inheriting `mock` providers or loopback origins, new `Access-Control-Allow-Origin`/general REST surfaces, and direct Web imports of Core D1/schema infrastructure. Allow documented test fixtures and existing compatibility warnings through narrow, visible exceptions.

- [ ] **Step 3: Fix only proven boundary defects**

  Apply minimal fixes to forwarding, validation, or production config defaults. Preserve stable error envelopes, request IDs, Better Auth cookie handling, Core scope semantics, and local-only test providers.

- [ ] **Step 4: Verify security checks**

  Run the new script, focused Web/Core boundary tests, contracts tests, all typechecks, lint, naming, migration, and `git diff --check`. Record existing lint warnings with owners rather than silently suppressing them.

- [ ] **Step 5: Commit**

  Commit `test(readiness): verify Web Core security boundaries`.

**Acceptance:** Boundary tests and static checks pass with no new secret/default/public-surface finding; unauthorized and out-of-scope requests fail closed before business source reads.

---

### Task 4: Performance, Worker-local smoke checks, and production runbooks

**Files:**

- Create: `docs/superpowers/reports/ADMIN_READINESS_SLICE_9_PERFORMANCE.md`
- Create: `scripts/verify-worker-readiness.mjs`
- Create: `apps/web/app/api/readiness/route.ts` only if the existing health route cannot support a same-origin smoke check without exposing business data
- Create or modify: `apps/core/src/readiness/worker-smoke.integration.test.ts`
- Create: `docs/operations/DEPLOYMENT_RUNBOOK.md`
- Create: `docs/operations/MIGRATION_RECOVERY_RUNBOOK.md`
- Create: `docs/operations/PROVIDER_REPLAY_RUNBOOK.md`
- Create: `docs/operations/FAILED_JOB_RUNBOOK.md`
- Create: `docs/operations/AUTH_EMAIL_SETUP_RUNBOOK.md`

**Interfaces:**

- Consumes existing health/readiness endpoints, Wrangler configs, Core Service Binding, migration verifier, vinext tooling, and current scheduled/provider registries.
- Produces reproducible local smoke checks, measured performance evidence, and operational runbooks with actual commands and environment prerequisites.

- [ ] **Step 1: Add failing Worker-local smoke tests**

  Verify Core health/readiness returns a structured request/correlation result, Web can invoke Core through the configured Service Binding, a representative protected Admin route preserves cookies and error envelopes, migrations apply to a fresh local D1, and Wrangler dry-runs load the declared bindings without production secrets in source.

- [ ] **Step 2: Measure representative performance paths**

  Use the existing Web performance tooling/Chrome DevTools workflow where available and record route, environment, sample size, LCP/INP/CLS or unavailable metric, bundle/render observations, Core query timing, and limitations for marketplace home, Admin context, Admin Analytics, and one operational queue. Do not claim production latency from local-only data.

- [ ] **Step 3: Apply low-risk performance fixes**

  Fix only demonstrated render-blocking, duplicate, oversized, or unbounded work that remains within vinext/Worker compatibility. Re-run the same measurements and focused regression tests; do not add caches, queues, projections, or new bindings.

- [ ] **Step 4: Write runbooks**

  Document exact Wrangler/Vinext build and deploy-dry-run commands, D1 migration backup/restore and rollback procedure, provider webhook replay/reconciliation path, failed scheduled-job inspection/retry path, and production auth-email secret/from-address/trusted-origin prerequisites. State which commands are local-only and never include bearer URLs, credentials, or tokens.

- [ ] **Step 5: Verify and commit**

  Run `vinext check`, Worker smoke tests, Core/Web builds, migration/naming/typecheck/lint checks, touched formatting, and `git diff --check`. Commit `docs(readiness): add worker checks and runbooks`.

**Acceptance:** Worker-local and production-like checks are reproducible; performance evidence is measured and caveated; runbooks cover deploy, rollback, migration recovery, provider replay, failed jobs, and auth email without secret leakage.

---

### Task 5: Final integrated gate and Slice 9 closeout

**Files:**

- Modify: `docs/product/IMPLEMENTATION_STATUS.md`
- Modify: `docs/superpowers/plans/ADMIN_CRM_ANALYTICS_PROGRAM_MAP.md`
- Create: `docs/superpowers/reports/ADMIN_READINESS_SLICE_9_FINAL.md`
- Modify: relevant Task 2–4 test files for final regression gaps only

**Interfaces:**

- Consumes all readiness checks and runbooks from Tasks 1–4.
- Produces the final evidence report and descriptive status update; it does not add a new runtime surface.

- [ ] **Step 1: Run the complete verification matrix**

  Run contracts/Core/Web full tests, focused readiness tests, all workspace typechecks, both Worker builds, `vinext check`, `pnpm naming:check`, `pnpm migration:check`, `pnpm lint`, `pnpm format:check`, Playwright `--list`, Worker smoke checks, security scan, and `git diff --check`. If a command is environment-gated or crashes, preserve the exact output and reason.

- [ ] **Step 2: Reconcile acceptance criteria**

  Check every item in `ADMIN_READINESS_SLICE_9_DESIGN.md` against command output and file evidence. Verify no migrations, new services, public general APIs, or Slice 10 work entered the branch. Confirm the DoorDash plan edit remains untouched.

- [ ] **Step 3: Perform final whole-branch review**

  Review the complete diff from the Slice 9 plan base against the spec, canonical architecture/API/domain/data/state documents, and Admin design guidance. Park any pre-existing Slice 7 atomic-audit issue or auth-email environment blocker explicitly; do not hide it.

- [ ] **Step 4: Write report and status**

  Record implemented fixes, important files, checks/counts, environment limitations, deferred risks, and the exact pushed commit. Update descriptive status and the program map only after the canonical documents still agree.

- [ ] **Step 5: Commit and push**

  Commit `test(readiness): close slice 9 gate`, run `git diff --check` and `git status --short`, then push `git push origin main`. Stop before any Slice 10 or new product work.

**Acceptance:** Slice 9 evidence is complete or explicitly environment-gated, no unresolved Critical/Important readiness finding is hidden, the branch is pushed on `main`, and the repository is left at the documented readiness boundary.

## Stop Gate

- [ ] All required readiness tests, typechecks, builds, static checks, smoke checks, and runbooks are present and evidenced.
- [ ] Any skipped authenticated browser check names the exact auth-email transport blocker.
- [ ] No raw D1/Better Auth/provider payload leaked into Web contracts or UI.
- [ ] No new production secret, mock-provider default, public CORS/general API, migration, or infrastructure binding was introduced.
- [ ] Performance claims include route, environment, sample size, and limitations.
- [ ] Full-branch review is clean or residual findings are explicitly parked with an owner/ruling.
- [ ] `main` is pushed and Slice 10 has not begun.
