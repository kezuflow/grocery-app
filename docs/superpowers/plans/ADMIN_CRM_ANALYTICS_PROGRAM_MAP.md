# Admin, CRM, and Analytics Program Map

**Approved design:** `docs/superpowers/specs/ADMIN_CRM_ANALYTICS_API_DESIGN.md`

## Purpose

This map prevents the approved admin program from becoming one oversized implementation context.
Each slice receives its own implementation plan, execution session, verification gate, and commit
sequence. Completing one slice does not authorize the next.

## Shared invariants

- `apps/core` is the only business, authorization, and D1 authority.
- `apps/web` uses typed Service Binding calls through thin same-origin BFF routes.
- Better Auth owns credentials and sessions; Customer and Staff remain application domains.
- Writes are named commands, not raw CRUD or arbitrary status setters.
- Material commands require capability/scope authorization, caller-stable idempotency,
  `expectedVersion` when concurrent, a reason when material, and Audit.
- Promotions use the closed canonical benefit/rule vocabulary and preserve history.
- Analytics publishes only versioned approved metric definitions.
- Existing unrelated storefront changes remain untouched.

## Dependency order

| Slice | Deliverable | Entry dependency | Stop gate |
|---|---|---|---|
| 1 | Canonical admin capabilities, context/scopes, Audit read API, capability-aware shell foundation | Approved design | Context, Audit, BFF, and shell tests pass; no Staff CRUD begins |
| 2 | Staff invitations, identities, roles, capabilities, scopes, suspension, session revocation | Slice 1 | Staff/RBAC flows pass; no Customer tables or pages begin |
| 3 | Customer CRM, access disable/restore, composed detail, privacy/closure requests | Slices 1–2 | CRM/privacy flows pass; no Promotion management begins |
| 4 | Controlled Promotion definitions, lifecycle, preview, grants, redemptions | Slices 1–3 | Promotion invariants and UI pass; no Catalog changes begin |
| 5 | Catalog, categories, units, SKUs, availability, pricing, media, Inventory | Slices 1–4 | Catalog/Inventory flows pass; no finance work begins |
| 6 | Orders, issues, Payments, Refunds, Memberships, reconciliation exceptions | Slices 1–5 | Finance and lifecycle flows pass; no operations convergence begins |
| 7 | Procurement, Receiving, Fulfillment, Delivery, mode configuration, exception convergence | Slices 1–6 | Operational flows pass; no Analytics definitions begin |
| 8 | Metric definitions, Analytics queries, Overview, approved exports | Slices 1–7 | Metric reconciliation passes; blocked metrics remain unavailable |
| 9 | Cross-workspace accessibility, security, performance, Worker-local and production readiness | Slices 1–8 | All required non-skipped acceptance gates pass |

## Slice-owned migrations

- Slice 1: `0026_admin_foundation.sql` — canonical capability seeds/mapping and additive Audit query
  columns/indexes.
- Slices 2–8 allocate the next available additive migration only after comparing the slice
  requirements with the then-current `main` branch. Later slices do not reserve migration numbers
  speculatively. Their migrations cover only gaps approved by that slice's reviewed plan.

## Plan production rule

Before a later slice begins, create `docs/superpowers/plans/ADMIN_<SLICE>_IMPLEMENTATION_PLAN.md`
from the then-current repository. The plan must re-read the canonical documents, compare current
migrations/contracts/code, name exact files and interfaces, use TDD, and contain a stop gate. Do not
reuse stale file inventories from this program map.

## Active plan

Slice 1 is implemented per
`docs/superpowers/plans/ADMIN_FOUNDATION_SLICE_1_IMPLEMENTATION_PLAN.md` (commits `5af8f2a`
through the foundation-slice documentation commit). Its authenticated Playwright journeys remain
an unmet gate pending a provisioned local auth-email transport; the unmodified owner-owned
`apps/web/app/globals.css` deferred the shadcn CLI in favor of hand-themed shadcn-source
primitives. Slice 2 is not authorized for implementation and requires its own plan produced from
the then-current repository per the plan production rule.
