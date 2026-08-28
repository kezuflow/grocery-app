# Admin Promotions Slice 4 Implementation Plan

**Goal:** Deliver controlled Promotion administration — definitions over the closed benefit
vocabulary, draft lifecycle (create/update/activate/deactivate/archive), read-only preview,
targeted grants, and redemption inspection — as purpose-built Core commands/read models behind
thin Web BFF adapters and a Promotions workspace, without beginning Catalog/Inventory work,
without touching the introductory-trial authority, and without adding any redemption application
to checkout (that belongs to the checkout/Quote domain, not this admin slice).

**Spec:** `docs/superpowers/specs/ADMIN_CRM_ANALYTICS_API_DESIGN.md` (Promotions section).
Contracts named in `docs/architecture/API_CONTRACTS.md` (`admin.promotions.*`).

## Global constraints

- `apps/core` is the only business, authorization, and D1 authority; Web routes are transport-only.
- Authorization: `promotions.read` (reads/preview) / `promotions.manage` (commands) **plus a global
  scope**. Promotions are global; scoped principals receive `FORBIDDEN`.
- Closed vocabularies only: benefit types exactly `ORDER_FIXED_DISCOUNT` and
  `ORDER_PERCENT_DISCOUNT` are manageable in this slice (the order-benefit subset the current
  commerce seam can represent). `MEMBERSHIP_FEE_WAIVER` stays exclusively owned by the
  introductory-trial authority (`INTRO_TRIAL` grant) and is never creatable here;
  `DELIVERY_FEE_WAIVER`/`DELIVERY_FEE_DISCOUNT` and non-MINIMUM_SUBTOTAL rule types are schema-ready
  but deferred until the Quote path consumes them. Unknown types fail closed.
- Lifecycle: `DRAFT -> ACTIVE (activate) -> INACTIVE (deactivate) -> ARCHIVED (archive)`;
  `INACTIVE -> ACTIVE` reactivation allowed; `ARCHIVED` is terminal; only `DRAFT` may be updated
  (versioned definitions) plus name/description on any non-archived row; history is preserved —
  no delete path exists.
- Preview is read-only: it evaluates the same closed policy a Quote would (status/window/minimum
  subtotal, deterministic fixed/percent computation, capped at the subtotal) and never claims
  usage, writes a redemption, or mutates state.
- Grants create `promotion_grant` rows (reusing the canonical 0017 tables, `benefit_code` = the
  promotion code) targeted to one customer with max redemptions; redemptions are listed, never
  created, by admin. The `INTRO_TRIAL` grant is invisible to this admin surface.
- Material commands: caller-stable `idempotencyKey`, `expectedVersion` where concurrent mutation is
  possible, `audit_event` rows (`PROMOTION.*` closed vocabulary), authoritative results.
- Preserve owner-owned files; stage only files named by each task.

## File ownership map

- `packages/contracts/src/admin-promotions.ts` (+ test): Promotion DTOs, requests,
  `AdminPromotionsService`.
- `apps/core/migrations/0029_promotion_administration.sql`: rebuild `promotion` with the canonical
  definition shape (closed benefit types, `DRAFT|ACTIVE|INACTIVE|ARCHIVED` status, usage limits,
  priority/automatic, `version`) copying legacy rows additively.
- `apps/core/src/admin/application/`: `promotion-administration-access.ts` (shared guard),
  `list-admin-promotions.ts`, `get-admin-promotion.ts`, `create-admin-promotion.ts`,
  `update-admin-promotion.ts`, `change-admin-promotion-status.ts` (activate/deactivate/archive),
  `preview-admin-promotion.ts`, `grant-admin-promotion.ts`, `list-promotion-redemptions.ts`,
  `list-promotion-grants.ts`, `admin-promotions.integration.test.ts`.
- `apps/core/src/index.ts`: flat WorkerEntrypoint methods with boundary validation.
- `apps/web/app/api/admin/promotions/**`, `apps/web/app/api/admin/promotion-routes.test.ts`.
- `apps/web/app/admin/promotions/page.tsx`,
  `apps/web/app/admin/promotions/[promotion-id]/page.tsx`,
  `apps/web/tests/admin-promotions.spec.ts`.

## Composed decisions

- `AdminPromotionSummary`: `promotionId`, `code`, `name`, `description`, `status`, `benefitType`,
  `discountMinor`, `percent`, `minimumMinor`, window (`startsAt`/`endsAt`), usage limits,
  `automatic`, `priority`, `version`, `createdAt`, `updatedAt`.
- Preview input: `{ promotionId, subtotalMinor }`; output: `{ eligible, reasonCode, discountMinor }`
  with reason codes `PROMOTION_INACTIVE`, `PROMOTION_NOT_STARTED`, `PROMOTION_EXPIRED`,
  `MINIMUM_ORDER_NOT_MET` (reusing canonical `AppErrorCode` vocabulary).
- Percent computation: `ceil(subtotalMinor * percent / 100)`; fixed capped at subtotal; both
  integers only.
- Grants: `{ promotionId, customerId, maxRedemptions, idempotencyKey }` → `promotion_grant` row
  (`benefit_type` from the promotion, `benefit_code` = promotion code, status `ACTIVE`).
  Redemptions listing: `promotion_redemption` rows joined via `benefit_code` = promotion code,
  excluding `INTRO_TRIAL` unless it belongs to this promotion (it never does).

## Tasks

1. **Contracts** — failing tests, then `admin-promotions.ts` wired into `index.ts`/`core-service.ts`.
   Commit `feat(admin): define promotions contracts`.
2. **Migration `0029_promotion_administration.sql`** — rebuild `promotion` additively (copy legacy
   rows, closed benefit/status vocabularies, usage limits, version) + integration test + README.
   Commit `feat(iam): add promotion administration tables`.
3. **Reads + preview** (list/get/preview/redemptions/grants) with integration tests; wiring. Commit
   `feat(admin): add promotion read models`.
4. **Commands** (create/update/activate/deactivate/archive/grant) with integration tests; wiring.
   Commit `feat(admin): add promotion commands`.
5. **BFF routes** + delegation tests. Commit `feat(web): proxy promotion administration`.
6. **Promotions workspace UI** (list + create, detail with lifecycle/preview/grants/redemptions) +
   Playwright spec (gated honestly). Commit `feat(admin): add promotions workspace`.
7. **Docs + full gate + push.** Commit `docs(admin): record promotions slice`.

## Acceptance checklist

- [ ] Promotion reads/commands are `promotions.read`/`promotions.manage` + global-scope gated in Core.
- [ ] Only the closed order-benefit vocabulary is creatable; membership trial authority untouched.
- [ ] Lifecycle is legal and terminal-archived; only drafts change definitions; history preserved.
- [ ] Preview is read-only and deterministic; grants are targeted; redemptions are read-only.
- [ ] Web is transport-only; the workspace covers loading/empty/permission/error states.
- [ ] No Catalog changes begin; no owner-owned file touched; full gate passes.
