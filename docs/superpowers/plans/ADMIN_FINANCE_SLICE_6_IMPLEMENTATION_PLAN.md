# Admin Orders, Payments & Memberships Slice 6 Implementation Plan

**Goal:** Deliver finance/lifecycle administration — order list/detail with composed status,
order cancellation through the canonical command, payment/refund/reconciliation inspection with a
guarded refund request, membership list and lifecycle (pause/resume/cancel), and the customer
order-issue queue — as purpose-built Core commands/read models behind thin Web BFF adapters,
without beginning operations convergence (Procurement/Receiving/Fulfillment/Delivery surfaces)
or Analytics.

**Spec:** `docs/superpowers/specs/ADMIN_CRM_ANALYTICS_API_DESIGN.md` (Orders/Payments/Memberships
sections). Contracts named in `docs/architecture/API_CONTRACTS.md` (`admin.orders.*`,
`admin.payments.*`, `admin.memberships.*`, `admin.orderIssues.*`).

## Global constraints

- `apps/core` is the only business, authorization, and D1 authority; Web routes are transport-only.
- Authorization: `orders.read`/`orders.manage` for order surfaces, `payments.read`/`refunds.manage`
  for payments/refunds, `memberships.read`/`memberships.manage` for membership lifecycle — all plus
  a global scope (finance state is global for MVP; scoped principals receive `FORBIDDEN`).
- Cancellation goes through the canonical `cancelOrder` command (legal transitions, refund seam,
  idempotency) — admin never patches order status. Refund requests insert `payment_refund` rows in
  `REQUESTED` with idempotency; canonical refund outcomes arrive through the payment seam, never by
  admin assertion. `memberships.recover` is explicitly deferred (it must consume a
  provider-confirmed canonical outcome; no production provider is approved).
- Order issues get a new `order_issue` table (closed category/status vocabularies, staff
  assignment, version guard). Issue actions never authorize a refund.
- Material commands: caller-stable `idempotencyKey`, `expectedVersion`, required reasons,
  `audit_event` rows (`ORDER.*`/`PAYMENT.*`/`MEMBERSHIP.*`/`ISSUE.*` closed vocabulary).
- Preserve owner-owned files; stage only files named by each task.

## File ownership map

- `packages/contracts/src/admin-finance.ts` (+ test): `AdminOrdersService`, `AdminPaymentsService`,
  `AdminMembershipsService`, `AdminOrderIssuesService` DTOs/requests.
- `apps/core/migrations/0030_order_issues.sql` + integration test + README.
- `apps/core/src/admin/application/`: `finance-administration-access.ts`, `finance-reads.ts`
  (orders list/detail, payments list, reconciliation cases, memberships list/detail, issues
  list/detail), `finance-commands.ts` (cancel order, request refund, resolve reconciliation case,
  membership pause/resume/cancel, issue actions), `admin-finance.integration.test.ts`.
- `apps/core/src/index.ts`: flat WorkerEntrypoint methods with boundary validation.
- `apps/web/app/api/admin/{orders,payments,memberships,order-issues}/**`,
  `apps/web/app/api/admin/finance-routes.test.ts`.
- `apps/web/app/admin/orders/page.tsx`, `apps/web/app/admin/orders/[order-id]/page.tsx`,
  `apps/web/app/admin/payments/page.tsx`, `apps/web/app/admin/memberships/page.tsx`,
  `apps/web/app/admin/issues/page.tsx`, `apps/web/tests/admin-finance.spec.ts`.

## Composed decisions

- `AdminOrderSummary`: orderId, customer email, status, totalMinor/currency, payment status,
  fulfillment status, delivery status, committed/created timestamps. Detail adds item snapshots and
  recent audit. Orders read from `grocery_order` composed with `order_payment_reaction`,
  `fulfillment_record`, `delivery_job`.
- Payments list composes `payment_intent` with refund totals; reconciliation queue lists
  `payment_reconciliation_case` OPEN rows; resolve sets `RESOLVED` with reason + audit.
- Refund request: insert `payment_refund` (REQUESTED, idempotency key, reason); intent status is
  NOT changed by admin (canonical outcome comes from the provider seam). Rejects when no intent,
  non-positive amount, or amount exceeding intent amount.
- Membership list composes `subscription` + customer email; pause/resume/cancel wrap the existing
  canonical commands with staff authorization (`memberships.manage` + global) and audit; recover is
  deferred.
- Order issue lifecycle: `SUBMITTED -> CLAIMED -> INVESTIGATING -> RESOLVED|ESCALATED`
  (`ESCALATED -> INVESTIGATING`); actions guarded by version; resolving records resolution text.

## Tasks

1. **Contracts** — failing tests, `admin-finance.ts` wired into `index.ts`/`core-service.ts`.
   Commit `feat(admin): define finance contracts`.
2. **Migration `0030_order_issues.sql`** + integration test + README. Commit
   `feat(iam): add order issue tables`.
3. **Reads + commands** with integration tests; entrypoint wiring. Commit
   `feat(admin): add finance read models and commands`.
4. **BFF routes** + delegation tests. Commit `feat(web): proxy finance administration`.
5. **Workspace UI** (orders list/detail, payments, memberships, issues) + Playwright spec (gated
   honestly). Commit `feat(admin): add finance workspace`.
6. **Docs + full gate + push.** Commit `docs(admin): record finance slice`.

## Acceptance checklist

- [ ] Order cancellation runs the canonical command (no status patching) with refund seam.
- [ ] Refund requests are idempotent, amount-validated, and never assert canonical outcomes.
- [ ] Membership lifecycle wraps canonical commands with staff authorization + audit; recover
      deferred explicitly.
- [ ] Order issues carry a legal lifecycle; actions never authorize refunds.
- [ ] Web is transport-only; workspaces cover loading/empty/permission/error states.
- [ ] No operations convergence or Analytics begins; no owner-owned file touched; full gate passes.
