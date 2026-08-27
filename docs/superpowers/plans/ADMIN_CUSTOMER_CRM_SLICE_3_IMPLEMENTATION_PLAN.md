# Admin Customer CRM Slice 3 Implementation Plan

**Goal:** Deliver Customer CRM administration — customer search/list, composed detail, commerce
access disable/restore, session revocation, customer invitations, and the privacy/closure request
queue — as purpose-built Core commands/read models behind thin Web BFF adapters and a Customers
workspace, without beginning Promotion management or any later slice.

**Spec:** `docs/superpowers/specs/ADMIN_CRM_ANALYTICS_API_DESIGN.md` (Customer CRM section).
Contracts named in `docs/architecture/API_CONTRACTS.md` (`admin.customers.*`, `admin.privacy.*`).

## Global constraints

- `apps/core` is the only business, authorization, and D1 authority; Web routes are transport-only.
- Better Auth rows are never Customer DTOs; the display `email` join is the only authentication
  field. `customer_principal.status` is the commerce access gate; `customer` remains the aggregate.
- Authorization: `customers.read` (reads) / `customers.manage` (commands) **plus a global scope**.
  Customer identity is global for MVP; scoped principals receive `FORBIDDEN`.
- No hard deletion: closure/anonymization is a request workflow; retention-policy-backed
  anonymization is not approved, so `COMPLETE` records resolution only. Access disabling stays the
  explicit `changeAccess` command.
- Material commands: caller-stable `idempotencyKey`, `expectedVersion` where concurrent mutation is
  possible, required reasons, `audit_event` rows (`CUSTOMER.*`/`PRIVACY.*` closed vocabulary),
  authoritative results (`IDEMPOTENCY_CONFLICT` on hash mismatch, `STALE_VERSION` on version loss).
- `admin.customers.update` is **explicitly deferred**: no application-owned mutable customer profile
  field is approved in `DATA_MODEL.md` (support notes and segments remain unapproved good-to-haves).
- Invitations: durable `PENDING` record per normalized email (14-day expiry, idempotent);
  acceptance/provisioning of a new identity is deferred with the staff-invitation deferral.
- Preserve owner-owned files; stage only files named by each task.

## File ownership map

- `packages/contracts/src/admin-customers.ts` (+ test): Customer CRM DTOs and
  `AdminCustomerService`/`AdminPrivacyService`.
- `apps/core/migrations/0028_customer_crm.sql`: `customer_invitation`, `privacy_request`.
- `apps/core/src/admin/application/`: `list-admin-customers.ts`, `get-admin-customer.ts`,
  `list-customer-invitations.ts`, `invite-customer.ts`, `change-customer-access.ts`,
  `revoke-customer-sessions.ts`, `request-customer-closure.ts`, `list-privacy-requests.ts`,
  `apply-privacy-action.ts`, `customer-administration-access.ts` (shared guard),
  `admin-customers.integration.test.ts`.
- `apps/core/src/index.ts`: flat WorkerEntrypoint methods with boundary validation.
- `apps/web/app/api/admin/customers/**`, `apps/web/app/api/admin/privacy-requests/**`,
  `apps/web/app/api/admin/customer-routes.test.ts`: thin BFF adapters.
- `apps/web/app/admin/customers/page.tsx`, `apps/web/app/admin/customers/[customer-id]/page.tsx`,
  `apps/web/app/admin/customers/privacy/page.tsx`,
  `apps/web/tests/admin-customers.spec.ts`: Customers workspace UI.

## Composed read-model decisions

- `AdminCustomerSummary`: identity (`customerId`, `email`, `phone`), commerce-access status from
  `customer_principal.status`, `subscriptionState` (current subscription status or null),
  `orderCount`/`lastOrderAt` from committed orders, aggregate `version`, `createdAt`. Lifetime
  spend/AOV are **excluded** — their canonical metric definitions are unapproved.
- `AdminCustomerDetail` = summary + ten most recent Audit events for the customer's auth user
  (sanitized summaries reusing the Slice 1 Audit redaction path).
- Privacy request lifecycle (closed): `SUBMITTED -> VERIFYING|APPROVED|REJECTED`,
  `VERIFYING -> APPROVED|REJECTED|ESCALATED`, `APPROVED -> PROCESSING`,
  `PROCESSING -> COMPLETED|ESCALATED`, `ESCALATED -> PROCESSING`. Illegal transitions return
  `ILLEGAL_TRANSITION`.

## Tasks

1. **Contracts** — failing tests, then `admin-customers.ts` wired into `index.ts`/`core-service.ts`.
   Commit `feat(admin): define customer crm contracts`.
2. **Migration `0028_customer_crm.sql`** + integration test + README. Commit
   `feat(iam): add customer crm tables`.
3. **Customer read models** (list/get, invitations) + integration tests; entrypoint wiring. Commit
   `feat(admin): add customer read models`.
4. **Customer commands** (invite, changeAccess, revokeSessions, requestClosure) and privacy
   lifecycle (list/applyAction) + tests; wiring. Commit `feat(admin): add customer commands`.
5. **BFF routes** + delegation tests. Commit `feat(web): proxy customer administration`.
6. **Customers workspace UI** (list + invite, detail with actions, privacy queue) + Playwright
   spec (gated honestly). Commit `feat(admin): add customer crm workspace`.
7. **Docs + full gate + push.** Commit `docs(admin): record customer crm slice`.

## Acceptance checklist

- [ ] Customer reads/commands are `customers.read`/`customers.manage` + global-scope gated in Core.
- [ ] Access disable/restore is principal-gated, version-guarded, audited, idempotent.
- [ ] Privacy requests carry a legal-transition lifecycle; no hard deletion path exists.
- [ ] Better Auth rows are not Customer DTOs; sessions revoked only through Core.
- [ ] Web is transport-only; the workspace covers loading/empty/permission/error states.
- [ ] No Promotion management begins; no owner-owned file touched; full gate passes.
