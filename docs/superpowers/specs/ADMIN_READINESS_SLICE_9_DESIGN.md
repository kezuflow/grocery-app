# Admin and Platform Readiness Slice 9 Design

## Status

Approved scope: cross-workspace readiness hardening after Slice 8. This design does not add a
business workflow or change a canonical domain rule.

## Goal

Make the existing FreshMarkets Web/Core MVP demonstrably ready for the next deployment step by
closing shared accessibility and boundary gaps, measuring obvious request/render costs, and proving
Worker-local and production-like operational checks without introducing new infrastructure.

## Scope

### Accessibility and UI safety

- Audit shared Admin shell, navigation, tables, forms, dialogs, loading/empty/error states, and
  Analytics for semantic headings, labels, keyboard operation, visible focus, focus return, live
  status updates, contrast-safe status text, and mobile touch targets.
- Correct reusable shared components and the highest-risk workspace violations rather than adding a
  parallel component system.
- Add automated checks for representative unauthenticated, forbidden, loading, empty, error, and
  keyboard flows. Authenticated browser journeys remain explicitly environment-gated when the
  local email transport is unavailable.

### Security and boundary assurance

- Verify Web forwards cookies and correlation headers to Core and never reads business D1 directly.
- Verify Core derives identity from Better Auth, requires capability plus scope, rejects malformed
  or out-of-scope resources, and does not expose Better Auth/raw persistence/provider payloads.
- Scan source/configuration for committed secrets, unsafe production defaults, public CORS/general
  REST exposure, and dependency/runtime drift. Keep mock providers development-only and preserve
  production fail-closed configuration.
- Add regression tests for unauthorized access, request-id propagation, cookie handling, and
  representative injection/validation boundaries. Do not create a second auth authority.

### Performance and operational readiness

- Measure representative Web and Core routes with the existing tooling and identify actionable
  render-blocking, oversized, duplicate, or unbounded work.
- Apply only low-risk fixes supported by current vinext/Worker behavior; do not add caches, queues,
  Durable Objects, projections, or external analytics infrastructure without measured need.
- Prove `vinext check`, production builds, Wrangler dry-runs, Worker-local health/Service Binding
  smoke checks, migration verification, and structured error/correlation behavior.
- Document deployment, migration backup/restore, rollback, provider/webhook replay, failed-job,
  and auth-email transport runbooks with clear environment-specific prerequisites.

## Architecture and data flow

Browser requests enter Web. Web route handlers and server components remain thin adapters and call
the typed Core Service Binding. Core performs authentication, capability/scope resolution, domain
validation, and D1 reads/writes. Readiness checks observe this path; they do not bypass it or mutate
business state. Operational checks use existing health/readiness endpoints, local Wrangler
configuration, and test fixtures.

No migration, public RPC, domain state machine, provider contract, or deployment topology change is
required by this design. If a finding would require one, it becomes a separately approved change
instead of being hidden inside readiness work.

## Error and environment policy

- User-facing errors retain stable Core error codes and request references.
- Security failures fail closed; missing capability and out-of-scope access are never represented as
  empty success data.
- Unavailable provider/auth-email dependencies are reported as explicit environment prerequisites,
  not silently replaced with insecure bypasses.
- Performance observations include the measured route, environment, sample size, and limitation;
  no unsupported production latency claim is made from local-only evidence.

## Acceptance criteria

1. Shared Admin controls and representative workspaces pass automated accessibility assertions for
   keyboard/focus/labels/semantic status and preserve responsive layouts.
2. Web/Core boundary tests prove cookie and request-id forwarding, no direct Web D1 access, and
   capability/scope enforcement across representative global, market, and location requests.
3. Secret/config and dependency checks identify no newly introduced production credential or unsafe
   mock-provider default; existing warnings are documented with ownership.
4. Representative performance checks produce actionable evidence and any low-risk fixes pass
   focused regression tests.
5. `vinext check`, typechecks, lint, naming, migrations, tests, Worker builds, Wrangler dry-runs,
   and local Service Binding/health smoke checks are recorded. Environment-gated checks state why
   they could not run.
6. Deployment, rollback, migration recovery, webhook replay, failed-job, and auth-email setup
   runbooks are present and reference the actual current commands/configuration.
7. No Slice 10/product feature work, new service, public API, Durable Object, Queue, Workflow, or
   analytics projection is introduced.

## Deferred findings

The existing unprovisioned local auth-email transport may continue to block authenticated
Playwright execution. Any previously identified cross-domain non-atomic audit transaction issue
remains owned by the operational command refactor and is not expanded here.
