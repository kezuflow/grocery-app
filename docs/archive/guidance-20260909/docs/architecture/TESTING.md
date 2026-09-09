# FreshMarkets Testing and Verification

Status: active engineering policy, updated 2026-09-07. This document defines evidence requirements, not product acceptance criteria. Read the relevant canonical domain documents and [CODING_STANDARDS.md](CODING_STANDARDS.md) first.

## Choose checks by risk

Run focused checks while iterating. At implementation-phase completion, run the repository aggregate gate and any relevant checks it does not contain. Do not rerun an unchanged full suite repeatedly after it passes without a new concern.

| Change                                                         | Required evidence                                                                                                                                                                                                                            |
| -------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Markdown only                                                  | Review factual claims and local links, `git diff --check`, `pnpm naming:check`; validate documented command names against manifests. No application tests merely to prove prose.                                                             |
| Small presentation/copy change                                 | Relevant lint/type checks and visual/accessibility verification; existing focused UI tests when behavior changes. Do not create tests that only mirror copy or CSS implementation.                                                           |
| Domain rule or defect                                          | Focused regression showing the failing behavior, legal/illegal boundary cases, affected workspace tests and type/lint checks.                                                                                                                |
| Auth, authorization, financial, inventory, or lifecycle change | Core Worker/D1 integration tests for scope, state guards, replay, failure atomicity, and races, plus relevant contract/Web flows.                                                                                                            |
| Shared contract or runtime configuration                       | Contracts/Core/Web typechecks, affected tests, architecture/readiness checks, both builds; binding freshness and vinext compatibility checks when affected.                                                                                  |
| Schema or migration change                                     | Fresh database creation, constraints/foreign keys, representative fixtures and Worker/D1 operations; upgrade tests for every retained supported baseline. Apply the pre-launch policy instead of inventing unnecessary legacy compatibility. |
| Provider integration                                           | Adapter fixtures plus webhook authentication, replay, timeout/unknown-outcome and reconciliation tests; separately recorded sandbox acceptance for actual account capabilities.                                                              |

Tests should fail when the intended observable behavior is broken, not when harmless implementation details change. Prefer a small useful test over coverage percentages or assertions that restate the implementation.

For agent instructions or verification-tool changes, check the changed documentation/configuration, run `pnpm harness:test`, and execute the affected guards against the working tree. Add a negative fixture when changing enforcement. Do not run unrelated application suites solely because a harness file is executable. After sufficient checks pass, rerun only for a new edit, failure, or unresolved risk; phase-completion gates still apply.

## Existing commands and their limits

Run from the repository root using the Node and pnpm versions declared in `package.json`.

| Command                                        | What it establishes                                                                                                                                                                                      |
| ---------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `pnpm naming:check`                            | Repository path/package/migration naming conventions.                                                                                                                                                    |
| `pnpm terminology:check`                       | Configured product terminology scan; not business correctness.                                                                                                                                           |
| `pnpm architecture:check`                      | The dependency and transport/contract boundaries implemented by the static verifier; not every architectural invariant.                                                                                  |
| `pnpm readiness:check`                         | Configured source-level security/readiness guards; not external account activation.                                                                                                                      |
| `pnpm migration:check`                         | SQLite schema application and selected migration/invariant scenarios from the current verifier scripts.                                                                                                  |
| `pnpm catalog:check`                           | Generated catalog artifact matches its maintained source.                                                                                                                                                |
| `pnpm format:check`                            | Formatter checks for the paths declared by the root script; it does not currently cover all repository Markdown.                                                                                         |
| `pnpm lint`                                    | Configured Oxlint checks in apps/packages.                                                                                                                                                               |
| `pnpm typecheck`                               | Workspace TypeScript checks.                                                                                                                                                                             |
| `pnpm test`                                    | Workspace Vitest suites. Core's configured suite runs with the Cloudflare Workers pool and D1 migrations.                                                                                                |
| `pnpm harness:test`                            | Node test suites under `scripts/*.test.mjs`, including architecture/security diagnostics, Git source discovery, naming, and readiness-tool regressions. These are distinct from workspace Vitest suites. |
| `pnpm --filter @freshmarkets/web check:vinext` | Installed vinext compatibility scan.                                                                                                                                                                     |
| `pnpm --filter @freshmarkets/core build`       | Wrangler deployment dry run; no production deployment.                                                                                                                                                   |
| `pnpm --filter @freshmarkets/web build`        | Web production build; not a browser journey or deployment.                                                                                                                                               |
| `pnpm --filter @freshmarkets/web test:e2e`     | Playwright execution against the configured local/managed stack.                                                                                                                                         |
| `pnpm check`                                   | Root aggregate gate, including formatting, conventions, migrations, HEAD commit-message validation, architecture, readiness, lint, types, Vitest, and builds.                                            |

`pnpm check` also runs `harness:test`. It does not include `catalog:check`, `check:vinext`, binding freshness, provider sandbox acceptance, or Playwright. Add the relevant checks rather than treating the aggregate as universal proof. `pnpm commit:check` validates the existing HEAD; it does not validate uncommitted content or a future commit message.

Architecture source discovery includes tracked and non-ignored untracked files under `apps` and `packages`; security source discovery covers `apps/core/src`. Both read working-tree content, exclude declaration files and local deletions, and fail if Git enumeration fails. Security telemetry analysis excludes test files. These static checks do not establish runtime authorization, alias resolution completeness, or end-to-end security. Their Node fixtures run in temporary Git repositories, never by staging test violations in the user's checkout.

Local Git hooks enforce only their configured convention checks. There are no GitHub Actions checks. Hook success does not mean tests, types, builds, or business acceptance passed.

Focused examples:

```text
pnpm --filter @freshmarkets/contracts test
pnpm --filter @freshmarkets/core exec vitest run --config vitest.config.ts src/orders/application/apply-checkout-payment-reaction.integration.test.ts
pnpm --filter @freshmarkets/web exec playwright test --list
```

The first two execute tests; Playwright `--list` only discovers tests. Confirm paths against the current checkout before copying a dated command.

The existing Playwright configuration accepts `APP_BASE_URL` for an already-running stack. `E2E_START_STACK=1` builds and provisions a dedicated local stack using `apps/core/.wrangler/e2e-state`; inspect the setup before invoking it because it prepares disposable test data. Never point destructive test setup at a retained or production database. Do not run an extra Core listener alongside the auxiliary-Worker dev topology unless a test specifically needs it.

`E2E_STATE_NAME` selects a separate direct child of `apps/core/.wrangler` for managed setup and authenticated fixtures. Names must match `e2e-[a-z0-9-]+`. Setup resets that selected directory, so choose a new name or an already identified disposable directory. The default remains `e2e-state`; setting a new name does not authorize resetting existing state.

Authenticated fixture SQL uses the installed `wrangler-e2e` CLI and explicit `wrangler.e2e.jsonc`, matching the managed local controller. A newer CLI intermittently executed local SQL but failed to exit within the fixture timeout. Fixture success still requires a zero exit status; neither printed SQL success nor a timeout is accepted as completed setup. Production/build Wrangler and existing timeout/assertions remain unchanged.

## Required failure and concurrency scenarios

For a changed critical command, select every applicable case:

1. Valid authorized operation produces the intended state and all required effects.
2. Unauthenticated, unauthorized, wrong-customer, and wrong-location calls are rejected by Core, including direct RPC calls that bypass UI checks.
3. Invalid input, illegal state, stale version, or a lost conditional claim produces no partial business writes and no success idempotency record.
4. Identical replay returns the same operation; changed payload with the same key conflicts. Multi-item/multi-pool operations produce distinct effects without unique-key collisions.
5. Two competing operations cannot collectively overconsume a bounded resource or create duplicate ownership/financial effects. Assert database state, ledger/audit effects, and returned outcomes, not only status codes.
6. A provider accepts an operation but the response or local persistence is lost; recovery uses the same identity and cannot repeat a charge, refund, booking, or other external effect blindly.
7. Duplicate, delayed, out-of-order, unknown-resource, and concurrent provider events either apply legally or remain recoverable. A stored inbox row is not automatically an applied event.
8. Boundary times are tested exactly before, at, and after the relevant instant with an injected clock. Avoid sleeps as a substitute for deterministic domain-time tests.
9. Cancellation and terminal states block inappropriate later work. Projections cannot accidentally reopen an aggregate or overwrite successful financial evidence.
10. A failed noncritical notification does not reverse a successful business transition; duplicate/retry/dead-letter behavior is tested independently.

## Fixtures and test boundaries

- Keep policy tests small and deterministic. Inject time, IDs, and provider/integration ports where nondeterminism matters.
- Use realistic integer quantities, currencies, distinct locations, and multi-line examples. Single-item happy paths are insufficient for batched commerce effects.
- Use real migrations and database constraints for persistence claims. A mocked repository returning success cannot prove atomicity or uniqueness.
- At least one integration journey must reach each changed critical operational state through real preceding commands. Directly seeding an otherwise unreachable state can hide a missing transition; seeded unit scenarios are still useful when that boundary is stated.
- Test doubles model a known boundary. Do not recreate the entire implementation inside a mock or call a mock-only route an end-to-end production flow.
- Node SQLite probes help isolate SQL bugs but are not proof of Worker bindings, D1 runtime behavior, cookies, Service Bindings, R2, or provider connectivity.
- Maintain contract validation and Web/Core method conformance as interfaces change. Check both success and failure DTOs; do not use type assertions to construct invalid fixtures unnoticed.
- Use semantic browser locators and observable UI behavior. Check focus, keyboard operation, loading/error/permission/conflict states for changed interactions.

## Reporting and release evidence

- Record the command, scope/environment, outcome, and relevant limitations. Distinguish executed, listed, skipped, failed, blocked, dry-run, and externally verified results.
- A pre-existing failure needs evidence and a clear impact statement. A new regression is part of the work; do not hide it behind historical warnings.
- Do not equate passing test counts with complete business coverage. Include uncovered failure paths and provider/account/deployment gates that remain unresolved.
- Complete a phase only against its acceptance criteria and current runtime evidence. Dated reports remain dated evidence; do not relabel them as fresh verification.
- For documentation-only changes, verify the diff contains only intended documentation and accurately say that application behavior was not changed or revalidated.
