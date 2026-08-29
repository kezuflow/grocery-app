# Admin and Platform Readiness Slice 9 Final Gate

Recorded 2026-08-30. This is descriptive evidence; canonical architecture, domain, contract,
state-machine, data-model, product, and design documents remain authoritative.

## Gate decision

**BLOCKED for release evidence.** The implementation remediation is complete, but the repository
format gate still fails on 28 pre-existing/owner files and the performance gate cannot pass until
Chrome DevTools tracing produces LCP, INP, CLS, network, and accessibility evidence. Unavailable
browser metrics are not a pass.

## Acceptance matrix

| Criterion                    | Evidence                                                                                                | Result  |
| ---------------------------- | ------------------------------------------------------------------------------------------------------- | ------- |
| Admin accessibility/states   | Component coverage plus deterministic authenticated responsive/keyboard browser flows                   | PASS    |
| Authentication/authorization | Real Better Auth cookie flow, application Staff roles/capabilities/scopes, authorized and denied routes | PASS    |
| Web/Core boundary            | Service Binding stack, BFF allowlist tests, fail-closed envelopes, security verifier                    | PASS    |
| Command correctness          | Focused Core integration/concurrency/replay tests for all remediation findings                          | PASS    |
| Worker readiness             | Shell-free verifier, migration/build checks, local health/BFF probes when stack is active               | PASS    |
| Repository format            | `pnpm format:check` reports 28 pre-existing/owner files outside this readiness change                     | BLOCKED |
| Performance                  | Chrome trace tooling unavailable; see the performance report                                            | BLOCKED |
| Documentation                | Finding disposition, program map, implementation status, and readiness reports reconciled               | PASS    |

## Implemented readiness work

- `apps/web/tests/admin-authenticated-fixture.ts` provisions verified Better Auth users and
  application-owned Staff access in a fresh, dedicated E2E D1 directory without a public test
  endpoint. Allowed and denied principals use separate browser contexts.
- `apps/core/wrangler.e2e.jsonc` supplies an isolated test-only Core configuration for port 3100;
  production and ordinary development auth email remain fail-closed.
- Admin Playwright suites share the fixture. Each domain has a real authorized workspace path and
  capability-denial path; command-bearing slices 2–7 also exercise a successful real command and
  the same command's capability denial. Slices 1 and 8 are read-only by design. Mocked browser
  state is limited to deterministic UI edge cases.
- `scripts/verify-worker-readiness.mjs` invokes child processes with `shell: false`; on Windows it
  runs pnpm's JavaScript entrypoint through `node.exe`, preserves status/stdout/stderr, and retains
  the existing timeout.

No public API, CORS policy, production binding, Durable Object, Workflow, Queue, or runtime
readiness endpoint was introduced.

## Verification matrix

| Check                                             | Fresh result                                                           |
| ------------------------------------------------- | ---------------------------------------------------------------------- |
| Workspace tests                                   | PASS — Contracts 38, Web 125, Core 447, Config/Domain/Validation 6     |
| Full Admin Playwright suite                       | PASS — 42/42 against the fresh isolated Web/Core/D1 stack              |
| Real authenticated fixture coverage               | PASS — 23 tests use isolated authenticated Staff/non-Staff contexts    |
| Workspace typecheck                               | PASS                                                                   |
| Core/Web builds                                   | PASS                                                                   |
| Vinext compatibility                              | PASS — 100%, 9 supported, 0 partial/issues                             |
| Naming and migrations                             | PASS                                                                   |
| Security verifier                                 | PASS                                                                   |
| Worker verifier tests/default/dry-run/local probe | PASS                                                                   |
| Lint                                              | PASS with 20 warnings                                                  |
| Format                                            | FAIL — 28 pre-existing/owner files outside this final readiness change |
| Browser performance                               | BLOCKED — Chrome DevTools MCP unavailable                              |

The exact commands executed were `pnpm test`, `pnpm typecheck`, `pnpm -r build`,
`pnpm naming:check`, `pnpm migration:check`, `pnpm lint`, `pnpm format:check`,
`pnpm --filter @freshmarkets/web check:vinext`, `node scripts/verify-readiness-security.mjs`,
`node --test scripts/verify-worker-readiness.test.mjs`, `node scripts/verify-worker-readiness.mjs`,
`node scripts/verify-worker-readiness.mjs --dry-run`, and `git diff --check`. The exact Admin
browser command was:

```powershell
$env:E2E_START_STACK='1'; pnpm --filter @freshmarkets/web exec playwright test tests/admin-analytics.spec.ts tests/admin-catalog.spec.ts tests/admin-customers.spec.ts tests/admin-finance.spec.ts tests/admin-foundation.spec.ts tests/admin-operations.spec.ts tests/admin-pagination.spec.ts tests/admin-promotions.spec.ts tests/admin-readiness.spec.ts tests/admin-staff-access.spec.ts
```

The repository is therefore not release-green even though the Admin remediation tests pass. The
format failure was not rewritten because it spans unrelated catalog/storefront and earlier files;
the performance blocker requires the external trace capability described below.

## Remaining release blockers

1. Approve and format the 28 pre-existing/owner files, or explicitly waive that repository gate.
2. Install/configure Chrome DevTools MCP, run the route-level traces listed in
   `ADMIN_READINESS_SLICE_9_PERFORMANCE.md`, and record the measured results.

No product or architecture decision is required unless the performance traces expose a defect.
