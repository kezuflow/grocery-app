# FreshMarkets Product Program Progress Ledger

Reconciled 2026-08-27. This ledger records present evidence, not authority. Canonical documents and
owner decisions override historical completion labels, commit messages, and self-review notes.

## Current status

| Program | Demonstrated implementation | Open acceptance / decision | State |
|---|---|---|---|
| Remediation Plans 01-07 | Core boundary, authorization, payment inbox/reactions, quote/order and operational foundations have focused tests | Full phase acceptance remains governed by the canonical implementation plan | PARTIAL / VERIFIED SLICES |
| Program 1 / Plan 08 | Composition split, operational read models, admin/rider surfaces and Playwright specs exist | Authenticated staff/rider journeys were gated/skipped; skipped tests are not acceptance evidence | OPEN |
| Program 2 | Scheduled-job registry, run records, cutoff/closeout, reaction redrive and reconciliation sweeps have integration tests | Production provider behavior and deployed cron observation | IMPLEMENTED LOCAL SLICE |
| Program 3 | Provider-neutral authorization, membership state, billing-calendar and scheduler seams pass mock tests | Production recurring mandate, automatic charging, and retry ownership are not approved or implemented | OPEN / NOT PRODUCTION-OPERATIONAL |
| Program 4 | Deterministic mock payment adapter, explicit selection, signed events, reconciliation/refund simulation and fail-closed policy | No production provider is selected | MOCK MVP ONLY |
| Program 5 | Instant fulfillment mode, holds, capacity and commitment foundations exist | Admin mode-configuration surface and complete browser acceptance | PARTIAL |
| Program 6 | Auth verification/reset delivery now uses the Core Cloudflare Email Service port | Product notification templates/events/delivery are not built | NOT STARTED EXCEPT AUTH EMAIL |
| Programs 7-14 | Plans and occasional schema seams only | Written program outcomes and acceptance criteria | NOT STARTED |

## 2026-08-27 reconciliation slice

- Removed unapproved production payment adapters and vendor-specific retry/readiness assumptions.
- Made payment selection explicit and limited `mock` to allowed local/test environments.
- Repaired Web → Core → Payments reaction → Order local checkout and paid-but-uncommitted redrive so
  one canonical payment can create at most one order.
- Removed customer grocery-cancellation RPC/contract exposure.
- Added pre-payment authoritative recalculation and explicit changed-total acceptance.
- Added versioned integer delivery configuration, provider-neutral route-distance port, Core-only
  Mapbox adapter, immutable delivery snapshots, and corrective migration `0022`.
- Added Cloudflare Email Service auth delivery behind the Core port with fake binding tests and
  fail-closed configuration.
- Added fresh and populated-0021 migration verification. Historical accepted migrations remain
  unchanged.

## Evidence policy

- `DONE`, `COMPLETE`, `SELF-REVIEWED`, a commit SHA, or a passing unit test never establishes
  production-operational behavior by itself.
- A provider-neutral seam tested only with `mock` is reported as a mock-tested seam.
- Skipped/gated Playwright tests are recorded as skipped and leave their parent acceptance criterion
  open.
- External sender/domain, Mapbox secret, OAuth, and production payment configuration are deployment
  work and are not fabricated in source.
- Git history retains the detailed historical slice record; it is evidence of implementation work,
  not a current status source.

## Next incomplete work

1. Finish current-tree verification and record exact results in the reconciliation task report.
2. Provision and pass authenticated Plan 08 browser flows without skips.
3. Obtain owner approval for a production payment/recurring model before implementing one.
4. Complete the remaining Program 5 admin configuration surface.
5. Begin Program 6 product notifications only from an approved spec; do not silently expand into
   Programs 7-14.
