# FreshMarkets Engineering

Authoritative implementation and verification requirements. [AGENTS.md](../../AGENTS.md) owns execution and routing; [PRODUCT.md](../product/PRODUCT.md) owns business intent. These requirements apply to the changed scope, not a mandate for unrelated refactoring.

## Readability and module design

- Prefer straightforward code with clear inputs, outputs, and ownership. Name functions after the operation they perform and values after their domain meaning; use explicit units such as `amountMinor`, `quantityBase`, and `expiresAt`.
- Keep functions and modules cohesive. Split when responsibilities or reasons to change diverge, not to satisfy arbitrary line-count limits. Do not create a helper, class, interface, package, or service for every noun.
- Extract repeated business rules into their owning domain policy. Small presentation duplication is preferable to a premature abstraction coupling unrelated workflows.
- Keep transport handlers thin. Application commands orchestrate; domain policies decide; repositories persist; adapters translate external protocols. Domain code must not import D1, Worker bindings, route handlers, or provider implementation code.
- Depend on narrow ports at real side-effect boundaries. Avoid wrapper layers that only rename the same call, generic repository frameworks, and configurable rules engines without a concrete need.
- Use comments for invariants, intent, provider quirks, and tradeoffs. Remove stale comments and unreachable code when changing the relevant path. A TODO must describe the missing behavior and consequence, not conceal an incomplete acceptance criterion.
- Do not keep unused compatibility layers solely because an earlier generated plan created them. Apply the lifecycle policy below before removing a consumed interface or stored representation.

## TypeScript and boundary validation

- Keep the repository's strict type checks. Use `unknown` for untrusted data and narrow it through runtime validation before use. A type assertion is not validation.
- Prefer discriminated unions for distinct states/results instead of combinations of nullable fields or unrelated booleans. Use exhaustive handling where the vocabulary is closed.
- Use explicit input/output types at shared contracts and exported application boundaries; allow inference for clear local values. Do not spread assertions throughout callers to compensate for an inaccurate contract.
- Do not introduce `any`, double assertions such as `as unknown as T`, non-null assertions, `@ts-ignore`, or `@ts-nocheck` to silence a defect. An unavoidable integration limitation belongs in a narrow adapter with an explanation and a focused boundary test. A deliberate `@ts-expect-error` in a negative type test must explain the expected failure.
- Validate IDs, enums, lengths, integer ranges, money/currency, quantities, timestamps, URLs, files, and pagination at the appropriate trust boundary. Reuse shared structural validators; keep authorization and business eligibility authoritative in Core.
- Return purpose-built DTOs, stable error codes, and plain serializable data over Service Bindings. Do not export ORM rows, infrastructure handles, secrets, or provider payloads as public types.

Type narrowing and discriminated-union behavior should follow the installed compiler and the [TypeScript handbook](https://www.typescriptlang.org/docs/handbook/2/narrowing.html), not remembered syntax from another version.

## Commands, state, and authorization

- Every meaningful write has a named command, one owning context, validated preconditions, a legal transition, capability/ownership/scope enforcement, and a defined result. Do not expose arbitrary status or field patches for lifecycle changes.
- Derive identity from the authenticated Core context. Caller-supplied resource IDs and browser scope preferences are inputs to authorize, never proof of authority.
- Revalidate mutable prerequisites at the write boundary. UI-disabled controls, prior reads, middleware, and cached permissions do not protect concurrent commands.
- Coordinate cross-context effects through application operations. A provider adapter or projection must not directly mutate another context's lifecycle merely because all tables share D1.
- Separate preparation, payment, delivery, refund, and other independently owned states. Do not infer one successful transition from a superficially similar status in another system.
- Resolve exact idempotent replay after authenticating and authorizing the resource, before state-dependent rejection of a command that already succeeded. Key reuse with another intent is a conflict.
- Give a command one stable identity and each distinct effect its own derived identity. A multi-line operation must not reuse one unique ledger key across different lines or pools.

## D1 writes and concurrency

### Policy versus storage integrity

Core domain policies decide business eligibility and legal transitions; application commands enforce them with authorization, scope, current state and version at the write boundary. Keep changeable decisions such as delivery-mode eligibility, preparation/handover prerequisites, pricing authority, promotion eligibility/stacking, cutoff rules and transfer-route eligibility out of permanent schema triggers and method-specific lifecycle checks. Persist the facts and evidence those policies need. A rule being locked for the current release does not automatically make a database trigger its owner.

Keep keys, foreign keys, typed/required fields, valid stored enums, exact quantities/money, unique operation identities, immutable committed evidence and concurrency protection in storage. For delivery, retain one active/uncertain attempt, pending-cancellation exclusion, consistent recorded timestamps and complete assignment identity. Core owns whether manual delivery is eligible and which transition may occur; the database does not require Scheduled mode or map manual status to mandatory handover evidence.

Promotion uniqueness identifies the applied benefit/redemption, not how many benefits a component may receive. Core owns stacking and usage-count semantics, with limit checks inside the same transaction as the redemption and every dependent effect. Flexible stored cadence must be validated against implemented Core policy before it becomes runtime authority. Retired fee configuration is historical evidence, not a disabled-but-reactivatable setting. Do not remove a concurrency guard without a tested atomic replacement.

Command-owned conditional SQL is appropriate for atomically revalidating a policy against current data; this differs from installing that policy as a global trigger. Guard the entire write set, including audit and idempotency results. Before removing an existing gate used by a live command, prove equivalent Core rejection and race safety. For an unimplemented feature, keep its entry points unavailable and record the missing command enforcement and acceptance tests in its owning phase. Do not delete legacy triggers indiscriminately or weaken corruption/recovery defenses merely because they involve multiple tables.

### Atomic persistence

- Bind SQL values; allow-list any dynamic identifiers or sort expressions. Select only needed columns and keep SQL in the repository/read-model layer.
- Enforce stable invariants with database keys, uniqueness, foreign keys, and checks where appropriate, alongside application policy. Choose indexes from actual query predicates and ordering.
- Treat validation followed by an unconditional write as a race. Use expected state/version or another database-enforced claim, inspect affected-row counts, and ensure every dependent write shares the winning guard.
- A zero-row conditional update is not a SQL exception. Calling `batch()` and throwing after it returns does not undo a later successful statement. Construct batches so a lost claim produces no business effects or a database failure rolls back the entire unit; test the full write set.
- Validate rejection conditions before mutation. On a domain rejection, business balances, lifecycle records, audit-success events, and idempotency-success results must remain unchanged. An intentional rejected-attempt diagnostic is separate from a successful business event.
- Persist business state, required ledger/audit effects, durable notification intent, and command result consistently. A read model is derived evidence, not another source of truth.
- Never claim a D1 transaction makes an external API call atomic. Handle database/provider and database/R2 boundaries with durable intent, recovery, and compensation where required.

Cloudflare documents transactional failure behavior for [D1 batches](https://developers.cloudflare.com/d1/worker-api/d1-database/#batch). The application must separately enforce its business preconditions and zero-row conflict behavior.

## External effects, retries, and Worker execution

- Claim and persist a stable operation identity before a payment, booking, refund, upload, or notification side effect. Record enough protected evidence to recover a lost response without repeating the operation blindly.
- Distinguish definite rejection, transient failure, and unknown outcome. A timeout after submission is not proof that nothing happened. Preserve successful provider observations even when downstream application work fails.
- Use bounded retries with one clear owner, backoff, and a terminal recovery/escalation path. Honor verified provider idempotency and retry semantics. Do not create nested retries in every layer.
- Verify provider events before trusting them. Deduplicate by provider event identity, track received versus applied work, and let redelivery/reconciliation retry incomplete processing. Receipt alone is not successful application.
- Share normalization/application logic between webhook and provider refresh paths. Handle duplicate, out-of-order, replacement, and conflicting observations explicitly; do not rely solely on a universal numeric status rank.
- Await critical business work. Do not use floating promises or `waitUntil` as a guarantee that a payment, reservation, or lifecycle transition will complete durably.
- Use `waitUntil` only for appropriate noncritical work with explicit failure handling. Durable notification transport follows the approved outbox/Queue design; it is not a route for critical commerce transitions. See [Workers context documentation](https://developers.cloudflare.com/workers/runtime-apis/context/).
- Keep request/session-specific mutable data out of module-global state. Request-scoped dependency/auth reuse is allowed; it must not leak permissions or data across callers.

## Security and error handling

- Preserve Better Auth cookie, origin, redirect, CSRF, verification, and session semantics. Do not add development bypasses to application authentication or financial-success paths.
- Keep secrets in the configured server environment. Test doubles and synthetic credentials belong in isolated tests; they never prove production provider readiness.
- Bound public bodies and uploads before parsing. Validate uploaded content and ownership, generate storage keys in Core, and do not trust MIME labels or caller-selected object paths alone.
- Treat external URLs, redirect targets, file paths, and stored JSON as untrusted. Restrict them to the intended protocol/origin/namespace before using them.
- Use the redacting telemetry boundary. Never log passwords, tokens, cookies, reset/verification URLs, payment actions, raw provider bodies, or full address/contact snapshots, including in development. Protected audit/inbox persistence follows its own access and retention policy.
- Do not swallow errors or fabricate a successful/empty result. Distinguish unavailable, denied, empty, conflict, and failed states. Translate unexpected errors at the boundary with a safe request reference and preserved internal cause.

## Web, performance, and accessibility

- Web renders Core decisions and submits explicit commands. Client validation improves feedback; it never replaces Core validation or owns price, stock, entitlement, or lifecycle rules.
- Prefer server reads for initial read-heavy screens. Avoid a server-page-to-client-to-local-HTTP-to-Core waterfall when the server already has the Service Binding.
- Use existing shadcn primitives and shared operational compositions. Show loading, empty, unavailable, denied, stale, pending, and failed states with accessible labels, keyboard behavior, focus management, and status announcements.
- Keep IDs, expected versions, provider details, and persistence vocabulary out of ordinary operator forms unless users need them for a real decision. The UI obtains concurrency evidence from Core read models.
- Prevent accidental duplicate submission and stale-response overwrites. Do not optimistically display a financially or operationally committed result before Core confirms it.
- Bound lists and use stable, scope-bound pagination. Avoid unbounded reads, N+1 query loops, and cross-request authorization caches. Do not turn partial data or missing access into zero metrics.
- Measure a performance problem before adding caching, indexes, denormalized projections, or new infrastructure. Verify freshness, invalidation, and permission isolation with the optimization.

## Pre-launch schema and interface policy

The owner confirms FreshMarkets has not launched. Prefer a coherent model over preserving accidental pre-launch schema or API history. Within authorized implementation work, agents may rename or replace tables/columns, improve constraints and relationships, remove unused compatibility paths, and rewrite or squash migration baselines when that simplifies the design. Routine pre-launch redesign does not require another approval solely because old migrations exist.

- Update all affected repositories, contracts, consumers, migration/generation tooling, seeds, and tests in the same coherent change. Record the reason and the reset/upgrade procedure.
- Keep schema creation reproducible from an empty database. A resettable environment may be recreated from the reviewed baseline; do not retain an artificial upgrade chain only to accommodate disposable fixtures.
- Check actual deployment consumers and data before treating an environment as disposable. Pre-launch permission is not permission to silently erase shared staging records, secrets, provider operations, or unrelated local work.
- Rewriting an applied migration does not update an existing database. Explicitly recreate an identified disposable database or provide an upgrade path for retained data. Do not run destructive remote resets as an incidental test or documentation task.
- Rework migration validators and generated-seed tooling when the model changes; retain meaningful constraint and behavior assertions rather than deleting checks to make the suite green. Generated files are regenerated from their maintained source.
- Once a production baseline or any retained deployment must be supported, preserve its applied migration history and use forward, tested upgrades. Coordinate mixed Web/Core versions where deployments can be skewed.
- Schema flexibility does not remove runtime data-integrity rules: money/units remain exact, business writes remain authorized and atomic, and retained commercial/audit evidence remains truthful.

This lifecycle policy supersedes blanket append-only or indefinite-compatibility instructions in older engineering plans. It does not change business policy or itself execute a schema redesign.

## Dependencies and verification discipline

- Reuse installed packages and repository conventions before adding dependencies. Assess runtime compatibility, maintenance, security exposure, and bundle impact for additions; do not upgrade packages incidentally.
- Use the package manager and versions declared by the root manifests. Regenerate bindings/types from their source configuration; do not manually patch generated output.
- Verify framework/provider behavior against installed code/types and current official documentation when needed. Do not apply generic Next.js or Node assumptions to vinext/Workers.
- Run the checks selected by [verification requirements](#choose-checks-by-risk). Fix regressions; identify unrelated baseline failures with evidence. Do not suppress diagnostics, weaken assertions, skip tests, or expand allow-lists just to pass.
- Finish with a diff review for scope, unintended files, secrets, stale imports/comments, and unsupported claims. Report what changed, what ran, what failed or was not run, and any remaining material risk.

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

## Files And Directories

- Source directories and static source files use lowercase kebab-case: `core-client`, `state-machines.ts`.
- Test files keep the source name and add `.test` before the extension: `service.test.ts`, `page.test.tsx`.
- React component identifiers use PascalCase in code; their filenames remain lowercase kebab-case.
- Next/vinext route conventions are allowed where required: `page.tsx`, `layout.tsx`, `route.ts`, `loading.tsx`, `error.tsx`, `not-found.tsx`, `middleware.ts`, and dynamic segments such as `[slug]`, `[...path]`, and `[[...path]]`.
- Type declaration files may use the generated `worker-configuration.d.ts` name.
- Documentation filenames use uppercase kebab-free names already established by the repository, such as `ARCHITECTURE.md`; new canonical docs should use uppercase letters and underscores only when matching an existing document family.
- User-approved Superpowers execution plans may use the standard dated lowercase form `docs/superpowers/plans/YYYY-MM-DD-lowercase-kebab.md`; they are implementation artifacts rather than canonical architecture/product documents.

## Database And Packages

- D1 migration files use four digits, an underscore, and lowercase snake_case: `0007_add_refund_indexes.sql`.
- SQL table and column names use lowercase snake_case.
- Workspace package names use the `@freshmarkets/*` scope and a lowercase kebab-case package name.
- TypeScript/JavaScript identifiers use `camelCase`; types, classes, and React components use `PascalCase`; constants use `UPPER_SNAKE_CASE` only for true constants.
- Public contract fields use camelCase even when their D1 storage columns use snake_case.

## Commit Messages

New commits use the Conventional Commits format:

```text
<type>(<optional-scope>): <imperative description>
```

Allowed types are `build`, `chore`, `ci`, `docs`, `feat`, `fix`, `perf`, `refactor`, `revert`, and `test`. Use `!` before the colon for a breaking change, for example `feat(api)!: replace the catalog response`. Descriptions must be non-empty and must not end with a period.

Run `pnpm commit:check` to validate `HEAD`. Run `pnpm hooks:install` once per clone to enable the repository-managed `.githooks/commit-msg` hook for new commits. Existing history predating this rule is not rewritten automatically.

## Git workflow

This is a single-developer repository. All work lands on `main` directly.

- Commit to `main` and push with `git push origin main`.
- Do not create, push, or open PRs from feature branches unless the owner explicitly requests an exception for a specific change.
- The `.githooks/pre-push` guard rejects pushes of any branch other than `main`; bypass only with `--no-verify` when the owner approves an exception.
- Use separate git worktrees only to isolate uncommitted local state, and land their commits back on `main` promptly.

## Local convention checks (no GitHub-side checks)

- Every **commit** runs locally via `.githooks`: `commit-msg` validates the commit-message convention; `pre-commit` validates file/path naming conventions.
- Every **push** runs locally via `.githooks/pre-push`: the trunk guard (main only), file naming conventions, and commit-message conventions for the full pushed range.
- The GitHub Actions commit-message workflow was removed; all enforcement is local. `git push --no-verify` bypasses only for owner-approved exceptions.

## What hooks do not prove

The hooks do not run the full type, lint, test, or build suites. Run the checks appropriate to the change before declaring it complete. Do not bypass hooks to conceal a failure or widen allow-lists to accommodate a new violation. Report existing unrelated failures separately from regressions. Schema migration strategy follows the pre-launch/retained-deployment policy in [ENGINEERING.md](ENGINEERING.md), independently of Git commit history.
