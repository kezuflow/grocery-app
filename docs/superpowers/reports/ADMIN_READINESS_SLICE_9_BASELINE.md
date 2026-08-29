# Admin and Platform Readiness Slice 9 Baseline

Recorded 2026-08-29 from the current working tree. This is an observation-only
baseline for Tasks 2–5; no runtime behavior was changed.

## Command baseline

| Command | Result | Evidence / limitation |
|---|---|---|
| `pnpm typecheck` | PASS | All six included workspace projects completed. |
| `pnpm lint` | PASS with warnings | Oxlint completed with 24 pre-existing warnings, including unused imports/variables in Admin, Core, and tests. |
| `pnpm naming:check` | PASS | Naming verifier reported source paths, migrations, docs, and packages compliant. |
| `pnpm migration:check` | PASS | Fresh apply and populated 0021 → 0022 upgrade verified. |
| `pnpm --filter @freshmarkets/web exec vinext check` | PASS | 100% compatible; 9 supported items, 0 partial, 0 issues; 41 pages and 91 route handlers scanned. |
| `pnpm --filter @freshmarkets/web test` | PASS | 22 files, 100 tests passed. |
| `pnpm --filter @freshmarkets/core test -- analytics.integration.test.ts` | PASS | 1 file, 12 tests passed. |
| `pnpm --filter @freshmarkets/web exec playwright test --list` | PASS | 35 tests in 10 files listed. Authenticated tests remain environment-gated. |
| `pnpm --filter @freshmarkets/core build` | PASS | Wrangler dry-run loaded DB, EMAIL, service/runtime vars; mock payment is development configuration. |
| `pnpm --filter @freshmarkets/web build` | PASS | Vinext build completed; route classification reports some dynamic API routes as unknown by static analysis. |
| `pnpm --filter @freshmarkets/core test` | ENVIRONMENT-LIMITED | Full run did not complete within the 30-second command window after repeated `.dev.vars` secret-loading messages; no test failure or crash output was emitted. Re-run with the local Worker/Vitest environment available. |

## Shared boundary inventory

| surface | evidence | risk | owner | planned task | environment limitation |
|---|---|---|---|---|---|
| Admin shell semantics | `apps/web/components/admin/admin-shell.tsx:28-45` provides the shell and `main`; `:177-244` has explicit loading, unauthenticated, forbidden, and error states; `:274` provides the page `h1`. | Baseline has useful semantic landmarks and state text, but shared mobile focus return and broader state announcements need deterministic assertions. | Web Admin UI | Task 2 | Authenticated browser checks require provisioned auth-email transport. |
| Admin navigation | `apps/web/components/admin/admin-navigation.ts:18-65` maps Core-provided codes to canonical links/icons; shell navigation is labeled at `admin-shell.tsx:109,129,155`. | Core visibility is preserved, but active-link semantics, keyboard/focus coverage, and mobile menu lifecycle require focused tests. | Web Admin UI | Task 2 | Local stack is not assumed running by baseline. |
| Admin route layout | `apps/web/app/admin/layout.tsx:8-15` mounts one `AdminContextProvider` and `AdminShellBoundary` around workspaces. | Shared boundary is centralized; representative workspace loading/empty/error/permission states need coverage rather than route-specific assumptions. | Web Admin UI | Task 2 | Authenticated route evidence is gated by auth email. |
| Web → Core request forwarding | `apps/web/lib/core-client/request.ts:1-6` copies incoming headers; protected routes such as `apps/web/app/api/admin/context/route.ts` use `requestHeaders(request)` and `coreClient(env.CORE)`. | Header forwarding is broad and currently unfiltered; cookie/request correlation behavior and approved metadata should be asserted before security hardening. | Web boundary | Task 3 | Service Binding invocation requires local Worker stack for integration evidence. |
| Typed Core client boundary | `apps/web/lib/core-client/core.ts:11` contains the single `unknown` cast to `CoreServiceBinding`; route modules use this adapter. | The cast is intentionally isolated, but static checks should prevent raw D1/schema imports or response payload leakage into Web. | Web/Core contracts | Task 3 | No production binding is exercised by this local baseline. |
| Core fetch/health/readiness | `apps/core/src/index.ts:799-829` exposes `/health`, request IDs, structured health data, auth routes, and payment webhook ingress; `health()` logs environment and DB-binding status. | Health is structured and request-referenced; Worker-local invocation and fail-closed auth/provider boundary cases need integration checks. | Core platform | Task 4 | Full Core test run timed out in this Windows environment; no crash details available in the bounded run. |
| Wrangler configuration | `apps/web/wrangler.jsonc:11-24` declares CORE and development loopback origin; `apps/core/wrangler.jsonc:18-38` declares D1/EMAIL, development vars, and required Mapbox secret. | Development mock payment and loopback origins are safe only when production overrides are enforced; dry-run evidence does not prove production secret provisioning. | Platform/Operations | Tasks 3–4 | Production configuration and auth-email sender are not available locally. |
| Auth email and E2E gates | `apps/web/tests/admin-foundation.spec.ts:5-10,58-61` documents `E2E_AUTH_EMAIL_CONFIGURED=1`; `admin-promotions.spec.ts:4-10` retains the same explicit gate. | Authenticated admin journeys cannot be called passing; removing the gate or bypassing verification would weaken the boundary. | Auth/Operations | Tasks 2, 4 | Development auth-email transport is not configured; preserve this limitation and provision it separately. |
| Representative workspace surface | `apps/web/app/admin/` contains operational, catalog, inventory, procurement, receiving, fulfillment, delivery, customers, staff, payments, analytics, audit, and settings workspaces; Web build enumerated these routes. | Broad surface area increases repeated accessibility/state and unbounded-work risk; follow-up tasks should target shared compositions and representative queues. | Web Admin UI | Tasks 2–4 | Browser list is deterministic; runtime route behavior needs a running local stack. |
| DoorDash reference plan | `docs/superpowers/plans/DOORDASH_REFERENCE_FRONTEND_PLAN.md` was already modified before this task and remains untouched. | Unrelated owner work must not be overwritten during readiness changes. | Owner | All tasks | None. |

## Scope conclusion

The baseline is reproducible and identifies no direct Web D1/schema import in the
source search. Existing code already forwards Core request metadata and exposes
structured health, while the remaining work is testable accessibility,
security-boundary, Worker-local, and operations evidence. The auth-email
transport remains the explicit blocker for authenticated Playwright flows.
