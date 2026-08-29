# Full Codebase Review and Remediation Report

**Repository:** FreshMarkets

**Review date:** 2026-08-30

**Scope:** Whole repository except the separately owned Admin Dashboard and Maps programs
**Status:** Programs 1–2 implemented and verified; Programs 3–4 approved and sequenced after Maps integration

## Executive assessment

FreshMarkets has the right architectural direction: a two-Worker Cloudflare deployment, a Core-authoritative modular monolith, Service Binding contracts, explicit domain state machines, integer money and inventory quantities, and unusually strong canonical documentation for an MVP-stage system. The central recommendation is to keep that direction and make it executable. A microservice split, new stateful platform primitive, public business API, or duplicated Web authority would add risk without solving the current problems.

The review found four material classes of work:

1. release-blocking financial and commitment correctness;
2. migration, runtime, cart, idempotency, and provider-inbox reliability;
3. architecture-boundary, request-security, correlation, readiness, and maintainability hardening; and
4. incomplete customer MVP behavior already promised by the canonical product documents.

The first two classes are implemented in the protective remediation worktree and have passed complete Core/Web verification plus a managed live storefront flow. The remaining two have approved, task-level, test-driven implementation plans but intentionally wait for the concurrent Maps task to release shared entrypoints, contracts, checkout, CSP, and Web shell files.

## What is strong today

### Architecture and domain modeling

- Core is correctly positioned as the sole business authority and D1 owner.
- The UI/application/domain/repository/storage direction is explicit and appropriate.
- Authentication and application authorization are separated: Better Auth answers identity; Core IAM answers capability and scope.
- Payments is separate from Membership and Orders, which prevents browser/provider state from becoming business truth.
- Subscription, order, payment, refund, fulfillment, delivery, procurement, receiving, and cycle lifecycles are modeled independently.
- Order history is designed around immutable commercial and fulfillment snapshots.
- Integer minor-unit money and integer base-unit inventory rules avoid floating-point and unit-conversion corruption.
- The scheduled/instant and stocked/planned distinctions are correctly independent.
- The repository explicitly resists premature microservices, Queues, Durable Objects, KV, Workflows, and public business APIs.

### Documentation and product constraints

- `AGENTS.md` is an effective enforcement/router document rather than a second architecture source.
- Canonical architecture, domain, state, data, API, MVP, and implementation documents clearly identify ownership.
- Locked invariants rule out common commerce errors: zero-price fallbacks, browser-confirmed payment success, mutable paid orders, customer hub selection, and uncontrolled promotion scripting.
- The repository workflow and naming/migration gates are unusually explicit for a single-developer project.

### Test posture

- Worker-local integration tests exercise real D1 migrations and domain behavior.
- Existing tests cover many legal/illegal transitions, authorization scopes, idempotency, snapshots, and provider reactions.
- The managed Playwright stack can provision Core/Web locally and prove a real Service Binding customer flow.

## Findings and remediation status

| Priority | Finding | Risk | Remediation status |
| --- | --- | --- | --- |
| Critical | Entitlement, price, minimum-basket, payment, capacity, and order-commitment checks were not uniformly enforced at every authoritative boundary. | Paid orders could be committed under stale or incomplete policy. | Fixed and verified in Program 1. |
| Critical | Scheduled paid commitment did not prove one atomic capacity claim with the order consequence. | Capacity oversell under concurrency. | Fixed with guarded atomic commitment and race tests. |
| Critical | Provider timeouts/ambiguous outcomes and replay paths could lose usable actions or misclassify financial state. | False failure, duplicate external action, or unrecoverable customer flow. | Fixed with claim-before-provider-call, durable action recovery, canonical observation classification, and reconciliation. |
| Critical | Outstanding refund value was not reserved atomically. | Concurrent refunds could exceed captured value. | Fixed with atomic reservation and replay-safe observation handling. |
| High | Historical migration `0021` could not safely upgrade a populated pre-instant schema while preserving the full foreign-key graph. | Production upgrade failure or data loss. | Fixed; fresh, populated `0020 -> current`, and later upgrade paths are verified. |
| High | Deployed runtime configuration accepted development secrets/origins/cookies/mock-provider combinations. | Insecure preview/production boot. | Fixed with cached typed fail-closed Core/Web validation. |
| High | A first-touch cart race could create multiple active carts; mutation lacked complete version/idempotency semantics. | Split customer state and lost concurrent updates. | Fixed with reconciliation/index, first-touch conflict handling, expected versions, and stable idempotency. |
| High | Provider inbox retry records lacked durable lease/redrive/escalation behavior. | Webhooks could remain indefinitely unprocessed or process concurrently. | Fixed with normalized observations, leases, bounded backoff, scheduler redrive, and one-time escalation. |
| High | Renewal initiation ownership was ambiguous and scheduler recovery incomplete. | Duplicate/misowned billing attempts or missed confirmed outcomes. | Fixed with explicit disabled-by-default ownership gate; outcome/dunning/grace recovery continues independently. |
| High | The Core entrypoint and legacy contract barrel are collision hotspots with weak executable layer enforcement. | Review difficulty, cross-context coupling, and repeated concurrent conflicts. | Program 3 planned; waits for Maps shared-file ownership to finish. |
| High | Public request bodies are inconsistently bounded and Web security/correlation policy is incomplete. | Memory abuse, unsafe media/body handling, inconsistent CSP/headers, weak incident traceability. | Program 3 planned with incremental readers, route migration, header tests, and one request ID end to end. |
| High | Customer Membership, promotion checkout, order detail, reorder, issues, abandonment, amendments, notifications, invoice readiness, and explicit mode selection are incomplete. | Canonical MVP cannot be considered launch-complete. | Program 4 planned as thirteen vertical, test-driven slices after Program 3. |
| Medium | Catalog generation depended on migrations beyond the schema boundary it owns; storefront assertions and dependency audit were stale. | Generator breakage from unrelated later schema and false verification failures. | Fixed; owned-boundary generation, current assertions, and a narrow esbuild override now pass. |
| Medium | Production lint/generated-type/readiness warnings and transport duplication remain. | Operational noise and slower safe changes. | Included in Program 3 acceptance. |

## Implemented remediation

### Program 1 — Checkout and financial safety

The completed work now guarantees:

- one canonical Membership entitlement decision at eligibility, quote, payment, and commitment;
- explicit persisted quote components rather than overloaded/implicit totals;
- authoritative minimum-basket enforcement at every payment/commit boundary;
- payment replay resolution before revalidation can invalidate a previously accepted action;
- atomic Scheduled capacity claim and exact quote-to-order commitment;
- durable provider-customer reuse;
- recoverable external provider actions and authorization flows;
- claim-before-provider-call for recurring authorization;
- atomic refundable-value reservation; and
- replay-safe canonical financial observations with ambiguous outcomes routed to reconciliation.

Completion commit: `840dee6`.

### Program 2 — Runtime and persistence reliability

The completed work now guarantees:

- a populated historical database can traverse the repaired instant-mode migration without losing dependent commerce/operations rows;
- deployed environments fail closed on weak secrets, insecure origins/cookies, incomplete OAuth pairs, or mock payment providers;
- one active ordinary cart per customer, including first-touch concurrency;
- cart mutation compare-and-swap and idempotent replay with controlled unavailable/price-unavailable lines;
- retired inventory triggers remain retired throughout the upgrade graph;
- provider inbox observations are bounded, normalized, leased, redriven, and escalated safely;
- renewal initiation is explicitly gated while confirmed-outcome/dunning/grace recovery remains active;
- catalog generation stops at its owned migration boundary; and
- the audited transitive esbuild issue is removed through a narrow workspace override.

Completion commit: `b287303`.

## Remaining approved work

### Program 3 — Architecture and security hardening

The approved plan will:

- decompose the single Core Service Binding implementation into bounded-context RPC adapters while retaining one `WorkerEntrypoint`;
- make contract files authoritative and prove entrypoint conformance at compile time;
- add an AST-based import/architecture verifier;
- replace unbounded public JSON/text reads with incremental size/content-type validation;
- complete production CSP and standard security headers while preserving landed Maps sources;
- carry one validated request ID from Web through Core/provider/reconciliation and back;
- separate liveness from bounded readiness and provider capability readiness;
- regenerate Worker types and close actionable production warnings; and
- verify auth redirects, payment webhooks, Service Bindings, D1, cron, and representative browser flows.

Plan: `docs/superpowers/plans/2026-08-30/ARCHITECTURE_SECURITY_HARDENING_IMPLEMENTATION.md`.

### Program 4 — Customer MVP completion

The approved plan will deliver:

- a Core-owned Membership experience and complete lifecycle target surface;
- deterministic one-merchandise-plus-one-delivery checkout promotions with commit-time redemption;
- customer-safe order detail and a canonical multi-context timeline;
- current-state reorder into the ordinary active cart;
- typed customer issue intake feeding the existing operational queue without refund authority;
- pre-commit abandonment and fail-closed committed-order cancellation availability;
- additive Scheduled amendments with independent current pricing, payment, and commitment;
- a durable transactional notification outbox, templates, attempts, retries, and scheduler;
- immutable invoice-readiness persistence without guessed tax/serial policy;
- Core-routed explicit Instant/Scheduled selection after a confirmed Maps address; and
- a managed end-to-end journey covering the complete customer path.

Plan: `docs/superpowers/plans/2026-08-30/CUSTOMER_MVP_COMPLETION_IMPLEMENTATION.md`.

## Verification evidence for completed programs

At Program 2 closeout:

- shared contract/package tests passed;
- Core passed 104 files and 572 tests;
- Web passed 37 files and 176 tests;
- typecheck, naming, migration, and catalog checks passed;
- Core and Web production builds passed;
- dependency audit reported zero advisories;
- the managed live storefront Playwright flow passed 17 of 17 tests with no skipped acceptance counted as complete; and
- a targeted format check across 198 remediation-owned files passed.

The root format gate remained red only in three then-concurrent Admin-owned files and was not masked or rewritten by this program. Those files are re-evaluated after Admin/Maps integration before Program 3 begins.

## Systems-design recommendations

1. Keep the modular monolith until a measured deployment/scale/ownership constraint justifies another runtime boundary. Internal bounded-context adapters are the correct next modularity step.
2. Treat typed Service Binding contracts as product APIs even though they are internal: purpose-built DTOs, compatibility discipline, versioned business definitions, and conformance tests remain mandatory.
3. Keep financial truth and operational truth separate. Provider initiation, browser return, inventory/capacity commitment, order state, refund state, and notification delivery must continue to advance independently through explicit reactions.
4. Prefer durable D1 inbox/outbox patterns for critical retryable work before adding Queue. Add Queue only if measured throughput/latency or isolation requirements outgrow the current scheduled redrive design.
5. Keep customer read models purpose-built and privacy-minimized. Never reuse Admin projections or raw joins for customer timelines, invoices, issues, or payment summaries.
6. Make every concurrency rule executable with an index, guarded update, atomic batch, idempotency identity, or lease—not only a comment/test.
7. Treat readiness as capabilities, not configuration strings. A payment/email adapter is ready only when the required configured operations are present and deployment acceptance proves them.
8. Preserve immutable commercial snapshots and use amendments/adjustments/events for correction. Do not evolve toward arbitrary order row editing.
9. Keep promotions closed and data-driven. Expand the rule vocabulary only through versioned canonical types and migrations; never introduce executable scripts.
10. Do not declare launch readiness until the owner approves and provisions the external policies listed below.

## External decisions and launch gates

The repository can implement safe seams but cannot invent these owner/provider decisions:

- production payment provider, credentials, webhook signing/mapping, reconciliation operations, and renewal ownership;
- transactional email delivery provider/domain, SPF/DKIM/DMARC, sending limits, and operational escalation destination;
- BIR/accounting tax classification, seller/taxpayer facts, official invoice serial/issuance/retention policy, and electronic-invoice integration;
- committed grocery-order cancellation/refund policy and its mode/cutoff/payment rules;
- production Cloudflare WAF/rate-limit rules for auth, password reset, address search, payment initiation, and webhooks; and
- final preview/staging/production secrets, origins, OAuth callbacks, cron configuration, and operational alerting.

Until those are approved, production paths must remain unavailable or readiness-failed; development mocks are not evidence of production readiness.

## Integration risk and control

The remediation range is isolated from base commit `5dd450e`. Current Maps overlap is limited to the Core entrypoint, shared validation, contract barrel, and canonical/status documentation. After Maps finishes, the range is replayed commit-by-commit onto current `main`; conflicts preserve landed Admin/Maps behavior and reapply each remediation invariant deliberately. Program 3 begins only after a complete integrated naming/migration/catalog/type/test/build baseline is green.
