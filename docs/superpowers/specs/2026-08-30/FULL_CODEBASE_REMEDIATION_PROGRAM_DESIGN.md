# Full Codebase Remediation Program Design

**Status:** Approved in chat on 2026-08-30; written specification awaiting final review  
**Repository:** FreshMarkets  
**Delivery model:** Trunk-based, staged commits intended for `main`  
**Implementation boundary:** Everything outside the separately active Admin Dashboard and Maps programs

## Purpose

This program turns the current architecture into a safe, executable MVP rather than changing its direction. The two-Worker modular monolith, Core authority, Service Binding boundary, bounded-context ownership, integer money and quantities, provider-confirmed financial outcomes, and explicit state machines remain mandatory.

The work addresses every actionable item from the full-codebase review:

1. checkout, membership, payment, refund, and commitment correctness;
2. migration, idempotency, inbox, cart, and environment reliability;
3. Worker, Web, contract, dependency-boundary, and security hardening; and
4. the non-admin, non-maps customer MVP surfaces already defined by canonical product documents.

## Canonical inputs

Implementation must continue to obey:

- `AGENTS.md`
- `docs/architecture/ARCHITECTURE.md`
- `docs/architecture/DOMAIN_MODEL.md`
- `docs/architecture/STATE_MACHINES.md`
- `docs/architecture/DATA_MODEL.md`
- `docs/architecture/API_CONTRACTS.md`
- `docs/product/MVP_SCOPE.md`
- `docs/product/IMPLEMENTATION_PLAN.md`
- `docs/architecture/NAMING_CONVENTIONS.md`
- `docs/design/marketplace/DESIGN.md`
- `docs/design/marketplace/REFERENCES.md`

These remediation specifications refine implementation; they do not weaken or replace any locked invariant.

## Explicit exclusions and coordination rules

- Do not redesign or remediate the Admin Dashboard UI, Admin information architecture, admin catalog work, or admin maps/dispatch surfaces in this program.
- Do not modify geocoding, Mapbox map rendering, customer pin confirmation, route drawing, dispatch batching, or rider navigation behavior owned by the Maps program.
- Cross-cutting files touched by those programs, especially `apps/core/src/index.ts`, `packages/contracts/src/index.ts`, checkout pages, and shared navigation, may be integrated only after the corresponding in-flight work lands on `main`.
- Admin commands may consume corrected Core policies after integration, but this program will not alter their UX.
- A production payment provider is not invented. Core will expose and test a complete adapter contract, explicit readiness state, and fail-closed configuration so an approved provider can be added without changing domain policy.
- BIR invoice storage seams will be implemented, but unapproved tax computations, serial formats, and retention rules will remain unavailable rather than guessed.

## Delivery decomposition

### Program 1 — Checkout and financial safety

Specification: `CHECKOUT_FINANCIAL_SAFETY_REMEDIATION_DESIGN.md`

This is the release-blocking program. It centralizes membership entitlement, enforces commerce policy at authoritative boundaries, hardens capacity commitment, makes payment/authorization replay recoverable, classifies ambiguous provider outcomes safely, persists provider-customer mappings, and prevents over-refund.

### Program 2 — Runtime and persistence reliability

Specification: `RUNTIME_PERSISTENCE_RELIABILITY_REMEDIATION_DESIGN.md`

This program makes the migration chain truthful for populated databases, makes runtime environment validation fail closed, gives carts proper concurrency and idempotency, and gives provider inbox records a durable retry path.

### Program 3 — Architecture and security hardening

Specification: `ARCHITECTURE_SECURITY_HARDENING_DESIGN.md`

This program reduces the Core entrypoint and contract hotspot without adding deployments, enforces import direction mechanically, bounds public request bodies, completes Web security headers, repairs request correlation, and restores repository verification gates.

### Program 4 — Customer MVP completion

Specification: `CUSTOMER_MVP_COMPLETION_DESIGN.md`

This program implements the remaining customer-facing behavior already required by MVP scope: checkout promotions, order detail/timeline, reorder, issue intake, fail-closed cancellation availability and pre-commit abandonment, additive amendments, transactional notifications, invoice readiness, and explicit Instant/Scheduled selection after maps integration. Committed-order customer cancellation remains unavailable until its separately required payment/refund policy is approved canonically.

## Sequencing and dependency rules

1. Program 1 lands first because later customer behavior depends on trustworthy payment and commitment semantics.
2. Program 2 lands next because Programs 3 and 4 must build on safe migrations, carts, environment configuration, and inbox retry.
3. Program 3 lands after the Admin and Maps programs finish touching the shared Core entrypoint and Web shell. It may be rebased before implementation but must not rewrite their behavior.
4. Program 4 lands as vertical customer slices. Promotions precede final quote UI; order read models precede reorder/issues/amendments; notifications subscribe to already-committed domain events; invoice persistence is written only at canonical paid-order commitment.

Each program receives its own implementation plan and review checkpoint. Every behavioral task uses test-driven development: failing test, observed failure, minimal implementation, passing focused suite, then refactor.

## Shared technical decisions

### Authority

- Web remains an experience and transport adapter.
- Core remains the only business authority and D1 owner.
- Membership owns entitlement decisions.
- Promotions owns benefit selection, eligibility, stacking, grants, and redemptions.
- Payments owns provider operations, canonical financial state, financial replay, refunds, and reconciliation.
- Orders owns paid-order commitment, immutable snapshots, customer lifecycle commands, amendments, and order history.
- Notifications owns delivery attempts and templates but never changes domain outcomes.
- Analytics remains a derived read side and is not changed by this program except to consume new domain events later.

### Time and concurrency

- Time-sensitive policies receive an explicit `at`/`now` instant from the application boundary.
- Client commands use stable idempotency keys and aggregate versions where concurrent mutation is possible.
- Provider events never accept client aggregate versions.
- Every conditional financial, capacity, cart, or state mutation must prove one successful claim inside the same D1 atomic batch that writes its consequences.
- A zero-row guarded update is a domain conflict and must roll back dependent writes.

### Errors

- Public contracts expose stable error codes and safe messages, never provider payloads, raw database errors, or secrets.
- Provider outcomes distinguish definitive rejection from ambiguous transport or persistence failure.
- Ambiguous money movement remains non-terminal and visible through reconciliation.
- Missing configuration fails closed with `CONFIGURATION_ERROR` or a more specific stable code.

### Data evolution

- New schema changes use the next available migration number at implementation time.
- Historical migration `0021_instant_mode.sql` will be made safe for future pre-0021 upgrades; databases that already applied it remain unaffected.
- Migration verification includes fresh apply, true populated N-1 upgrades, foreign-key checks, row-count checks, and snapshot equality for rebuilt data.

## Program-wide acceptance criteria

The program is complete only when all of the following are true:

- No paid Scheduled order can commit without acquiring capacity atomically.
- No paid order, quote, or payment can bypass membership entitlement or minimum basket policy.
- `ACTIVE`, `TRIALING`, and `PAST_DUE` entitlement behavior is identical at eligibility, quote, payment, and commitment boundaries.
- A provider timeout never becomes a false definitive failure.
- Replaying a payment or recurring-authorization command returns a usable action or a stable terminal result without another uncontrolled side effect.
- Outstanding refunds reserve refundable value so their total cannot exceed the captured amount.
- Provider-customer mappings are durably stored and reused.
- A populated pre-0021 database can complete the repository migration chain without losing order, item, fulfillment, delivery, quote, or attempt records.
- Preview, staging, and production cannot boot with development secrets, loopback origins, or insecure cookies.
- One customer cannot acquire multiple active carts through a first-touch race; cart mutation rejects stale versions and replays idempotently.
- `RETRY_REQUIRED` provider inbox records can be safely reclaimed and redriven with bounded attempts and escalation.
- Web buffers no unbounded public body, emits a complete security-header baseline, and returns the same request ID that Core receives.
- Core remains one modular-monolith Worker, but transport adapters and contracts are small enough to review by bounded context.
- Checkout promotions, customer order detail/timeline, reorder, issue intake, pre-commit abandonment/fail-closed committed cancellation availability, amendments, notifications, invoice seams, and fulfillment-mode selection have typed Core commands/read models and browser acceptance coverage.
- `pnpm check`, `pnpm catalog:check`, Core/Web builds, `vinext check`, focused Worker-local integration tests, and relevant Playwright journeys pass without relying on skipped acceptance tests.

## Baseline evidence

The isolated worktree was created from `main` commit `5dd450e`. Before specification changes, `pnpm test` passed 146 test files and 726 tests. The earlier review separately identified a red catalog-generation check, one stale storefront Playwright assertion, a moderate transitive esbuild advisory, and formatting failures limited to the excluded in-flight Admin work.

## Documentation updates during implementation

Each program must update the canonical document that owns any changed contract or data shape in the same commit as the code. `IMPLEMENTATION_STATUS.md` is updated only after canonical documents and executable behavior agree. Final program reports must list schema migrations, RPC changes, tests, operational rollout needs, and any decision that still requires the owner or an external provider.
