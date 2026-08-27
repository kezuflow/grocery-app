# Admin Staff & Access Slice 2 Implementation Plan

**Goal:** Deliver Staff & Access administration — staff invitations, identity provisioning data,
activation/suspension, canonical capability-based role administration, market/location scope
assignment, and Better-Authoritative session revocation — as purpose-built Core commands/read
models behind thin Web BFF adapters and a Staff workspace, without beginning Customer CRM or any
later slice.

**Spec:** `docs/superpowers/specs/ADMIN_CRM_ANALYTICS_API_DESIGN.md` (Staff, Roles, and Access
section). Contracts already named in `docs/architecture/API_CONTRACTS.md` (`admin.staff.*`,
`admin.roles.*`, `admin.capabilities.list`).

**Tech Stack:** TypeScript 7, Cloudflare WorkerEntrypoint RPC, D1/SQLite, Drizzle for IAM, vinext
App Router, React 19, the Slice 1 shell (`AdminContextProvider`, `AdminShell`, `--fm-*` themed
shadcn-source primitives), Vitest 4 + Cloudflare Vitest pool, Playwright.

## Global constraints

- `apps/core` is the only business, authorization, and D1 authority; Web routes are transport-only
  Service Binding adapters.
- Better Auth owns credentials and sessions. Staff identities, roles, capabilities, scopes, and
  invitations are Application IAM rows linked to the Better Auth user ID. Better Auth rows are
  never returned as Staff DTOs (email display join is the only permitted authentication field).
- No `isAdmin` shortcut: every query/command requires `staff.read`/`staff.manage` **plus a global
  scope**. Staff administration is a central, global-scope concern for MVP; market/location-scoped
  principals cannot administer staff. This rule is recorded in canonical docs in the final task.
- Material commands take a caller-stable `idempotencyKey` and `expectedVersion` where concurrent
  mutation is possible, require a reason for material/destructive actions, append `audit_event`
  rows, and return the authoritative Core result.
- Session revocation goes through Better Auth's server API (`revokeUserSessions`) — Core composes
  it inside an authorized application command; Web never touches sessions.
- Lists are bounded and cursor-paginated. New source uses canonical dot-form capabilities only.
- Roles are archived, never deleted; archived roles cannot be assigned and keep history.
- No Customer tables, pages, or CRM behavior. No public HTTP APIs, CORS, DO/Workflows/KV/Queues.
- Preserve all pre-existing dirty files (owner-owned storefront work incl. `globals.css`); stage
  only files named by each task.

## Authorization rule (authoritative for this slice)

Staff administration resources are global. Reads require `staff.read` and a `{kind:"global"}`
scope; commands require `staff.manage` and a global scope. A principal without the global scope
receives `FORBIDDEN` even when the capability row exists. Scope assignment on staff (what a staff
member may do elsewhere) is data set by `setAdminStaffScopes`, separate from the caller's own
scope.

## File ownership map

- `packages/contracts/src/admin-staff-access.ts` (+ `.test.ts`): Staff/Roles/Capabilities DTOs and
  `AdminStaffAccessService`.
- `apps/core/migrations/0027_staff_administration.sql`: `staff_invitations`, `staff_identity.version`,
  `role.description/status/version`.
- `apps/core/src/admin/application/`: `list-admin-staff.ts`, `get-admin-staff.ts`,
  `list-admin-staff-invitations.ts`, `invite-admin-staff.ts`, `update-admin-staff.ts`,
  `change-admin-staff-access.ts`, `set-admin-staff-roles.ts`, `set-admin-staff-scopes.ts`,
  `revoke-admin-staff-sessions.ts`, `list-admin-roles.ts`, `get-admin-role.ts`,
  `create-admin-role.ts`, `update-admin-role.ts`, `set-admin-role-capabilities.ts`,
  `archive-admin-role.ts`, `list-capability-definitions.ts`,
  `admin-staff-access.integration.test.ts`, `admin-roles.integration.test.ts`.
- `apps/core/src/audit/application/append-audit-event.ts`: durable audit append used by the
  commands above (Audit context owns the write; callers compose it).
- `apps/core/src/index.ts`: flat WorkerEntrypoint methods with boundary validation.
- `apps/web/app/api/admin/staff/**`, `apps/web/app/api/admin/roles/**`,
  `apps/web/app/api/admin/capabilities/route.ts`,
  `apps/web/app/api/admin/staff-access-routes.test.ts`: thin BFF adapters.
- `apps/web/app/admin/staff/page.tsx`, `apps/web/app/admin/staff/[staff-id]/page.tsx`,
  `apps/web/app/admin/staff/roles/page.tsx`, `apps/web/app/admin/staff/roles/[role-id]/page.tsx`,
  `apps/web/components/admin/staff-access-navigation.test.ts`,
  `apps/web/tests/admin-staff-access.spec.ts`: Staff workspace UI.

## Shared kernel decisions

- Staff list pagination: keyset `(created_at, staffId)` descending, `limit` 1–100 default 50.
- Roles pagination: keyset by `code` ascending (small closed set), `limit` 1–100 default 50.
- `AdminStaffSummary/Detail` carry `roleCodes`, `capabilityCodes`, `scopes`, `version`, `createdAt`,
  `status`, and Better-Auth-sourced `email` (display join only).
- Invitation lifecycle for MVP: `inviteAdminStaff` creates the durable `PENDING` record (unique
  normalized email among `PENDING`, 14-day expiry, idempotent). Acceptance/provisioning of a new
  Better Auth identity is **explicitly deferred** to the slice that implements the public
  invitation-acceptance flow; existing-user provisioning is out of scope here. Invitations are
  visible via `listAdminStaffInvitations` (Staff workspace queue) and revocable via
  `changeAdminStaffAccess`-style command `revokeAdminStaffInvitation` folded into the invite
  module (status `REVOKED`).
- Audit actions (closed vocabulary for this slice): `STAFF.INVITED`, `STAFF.UPDATED`,
  `STAFF.ACCESS_CHANGED`, `STAFF.ROLES_SET`, `STAFF.SCOPES_SET`, `STAFF.SESSIONS_REVOKED`,
  `STAFF.INVITATION_REVOKED`, `ROLE.CREATED`, `ROLE.UPDATED`, `ROLE.CAPABILITIES_SET`,
  `ROLE.ARCHIVED`. Rows carry actor, resource ids, reason, sanitized before/after snapshots, and
  `correlation_id = requestId`.

---

### Task 1: Define the Staff & Access contracts

Files: create `packages/contracts/src/admin-staff-access.ts` + `.test.ts`; modify
`packages/contracts/src/index.ts`, `core-service.ts`, `core-service.test.ts`.

- TDD: failing tests for the closed status/action vocabularies, purpose-built DTO shape
  (`satisfies`), and `AdminStaffAccessService` membership in `ImplementedCoreService`.
- DTOs: `AdminStaffSummary`, `AdminStaffDetail`, `AdminStaffPage`, `AdminStaffInvitationView`,
  `AdminStaffInvitationPage`, `AdminRoleSummary`, `AdminRoleDetail`, `AdminRolePage`,
  `CapabilityDefinitionView`, `SessionRevocationResult`, request types with `expectedVersion`/
  `idempotencyKey`/`reason` per the shared kernel decisions, and `AdminStaffAccessService`
  (15 methods listed above).
- Verify: `pnpm --filter @freshmarkets/contracts test && pnpm --filter @freshmarkets/contracts typecheck`.
- Commit: `feat(admin): define staff access contracts`

### Task 2: Staff administration persistence

Files: create `apps/core/migrations/0027_staff_administration.sql`,
`apps/core/src/iam/staff-administration-migration.integration.test.ts`; modify
`apps/core/migrations/README.md`.

- Migration: `staff_invitations` per `DATA_MODEL.md` (status check, unique idempotency key, unique
  partial index one `PENDING` per normalized email); `staff_identity.version INTEGER NOT NULL
  DEFAULT 1`; `role.description TEXT NOT NULL DEFAULT ''`; `role.status TEXT NOT NULL DEFAULT
  'ACTIVE' CHECK (status IN ('ACTIVE','ARCHIVED'))`; `role.version INTEGER NOT NULL DEFAULT 1`.
- Tests prove: table/columns exist, canonical capability rows still seed, defaults backfill
  (`role_operations_admin.status='ACTIVE'`, `version=1`).
- Verify: focused vitest + `pnpm migration:check` + `pnpm naming:check`.
- Commit: `feat(iam): add staff administration tables`

### Task 3: Staff read models

Files: create `list-admin-staff.ts`, `get-admin-staff.ts`, `list-admin-staff-invitations.ts`,
`admin-staff-access.integration.test.ts` (read tests first); modify `apps/core/src/index.ts`.

- Coverage: unauthenticated `UNAUTHENTICATED`; capability-without-global-scope and non-staff
  `FORBIDDEN`; bounded keyset list; detail `NOT_FOUND`; email surfaced only as display data.
- Wire `listAdminStaff` / `getAdminStaff` / `listAdminStaffInvitations` entrypoint methods with
  `authenticatedRequestSchema`-based boundary validation.
- Commit: `feat(admin): add staff read models`

### Task 4: Staff commands

Files: create `append-audit-event.ts`, `invite-admin-staff.ts`, `update-admin-staff.ts`,
`change-admin-staff-access.ts`, `set-admin-staff-roles.ts`, `set-admin-staff-scopes.ts`,
`revoke-admin-staff-sessions.ts`, and command integration tests (extend
`admin-staff-access.integration.test.ts`); modify `apps/core/src/index.ts`.

- Coverage per command: FORBIDDEN (capability/scope), VALIDATION_FAILED (unknown role id, archived
  role assignment, malformed scope), STALE_VERSION (conditional version update), identical replay
  returns original result, conflicting hash `IDEMPOTENCY_CONFLICT`, audit row appended with
  before/after, suspension blocks nothing at Better Auth (status is application-owned) but session
  revocation is a separate explicit command that invalidates real sessions (proved with a live
  sign-in cookie).
- Commit: `feat(admin): add staff commands`

### Task 5: Role administration and capability vocabulary

Files: create `list-admin-roles.ts`, `get-admin-role.ts`, `create-admin-role.ts`,
`update-admin-role.ts`, `set-admin-role-capabilities.ts`, `archive-admin-role.ts`,
`list-capability-definitions.ts`, `admin-roles.integration.test.ts`; modify
`apps/core/src/index.ts`.

- Coverage: create validates canonical capability codes (`isAdminCapability`), unique code
  (`CONFLICT`), setCapabilities atomic replace with version guard, archive rejects nothing with
  active assignments? — policy: archive is allowed and recorded; assigning an archived role fails
  closed; archived roles cannot be updated except by policy commands.
- Commit: `feat(admin): add role administration`

### Task 6: Thin Web BFF routes

Files: create `apps/web/app/api/admin/staff/route.ts`,
`apps/web/app/api/admin/staff/[staff-id]/route.ts`,
`apps/web/app/api/admin/staff/invitations/route.ts`,
`apps/web/app/api/admin/staff/[staff-id]/access/route.ts`,
`apps/web/app/api/admin/staff/[staff-id]/roles/route.ts`,
`apps/web/app/api/admin/staff/[staff-id]/scopes/route.ts`,
`apps/web/app/api/admin/staff/[staff-id]/sessions/revoke/route.ts`,
`apps/web/app/api/admin/roles/route.ts`, `apps/web/app/api/admin/roles/[role-id]/route.ts`,
`apps/web/app/api/admin/roles/[role-id]/capabilities/route.ts`,
`apps/web/app/api/admin/roles/[role-id]/archive/route.ts`,
`apps/web/app/api/admin/capabilities/route.ts`,
`apps/web/app/api/admin/staff-access-routes.test.ts`.

- Transport-only: forward cookies, generate request id, map/validate transport shapes, delegate
  once; malformed numeric inputs return 400 `VALIDATION_FAILED` without calling Core.
- Verify: route tests + `lib/core-client/core.test.ts` + `architecture/ownership.scan.test.ts` +
  web typecheck.
- Commit: `feat(web): proxy staff access administration`

### Task 7: Staff & Access workspace

Files: create `apps/web/app/admin/staff/page.tsx`,
`apps/web/app/admin/staff/[staff-id]/page.tsx`, `apps/web/app/admin/staff/roles/page.tsx`,
`apps/web/app/admin/staff/roles/[role-id]/page.tsx`,
`apps/web/components/admin/staff-access-navigation.test.ts`,
`apps/web/tests/admin-staff-access.spec.ts`; modify
`apps/web/components/admin/admin-navigation.ts` (+ test) to attach Staff sub-navigation entries.

- Reuse Slice 1 shell/primitives. Command forms send `idempotencyKey` + `expectedVersion`, render
  Core results, never optimistically commit. Loading/empty/filtered-empty/permission/error states
  with request references. Destructive actions (suspend, revoke sessions, archive) require a
  reason and confirmation.
- Verify: web vitest + typecheck + `check:vinext` + build; provisioned Playwright executed/skipped
  reported truthfully (email-gated journeys remain an unmet gate).
- Commit: `feat(admin): add staff access workspace`

### Task 8: Canonical documentation and Slice 2 gate

Files: modify `docs/architecture/API_CONTRACTS.md`, `docs/architecture/DATA_MODEL.md`,
`docs/product/IMPLEMENTATION_STATUS.md`, `docs/superpowers/plans/ADMIN_CRM_ANALYTICS_PROGRAM_MAP.md`.

- Record: staff-administration authorization rule (global scope), invitation lifecycle deferral,
  migration 0027, `AdminStaffAccessService` semantics, audit action vocabulary.
- Gate: `pnpm naming:check && pnpm migration:check && pnpm lint && pnpm typecheck && pnpm test &&
  pnpm -r build && pnpm --filter @freshmarkets/web check:vinext`; forbidden-pattern scans; slice
  changed-file review (no storefront/owner-owned files).
- Commit: `docs(admin): record staff access slice`

## Slice 2 acceptance checklist

- [ ] Staff reads/commands are `staff.read`/`staff.manage` + global-scope gated in Core.
- [ ] Invitations, access changes, role/scope replacement, and revocation are idempotent,
      version-guarded, audited, and return authoritative results.
- [ ] Roles are capability-closed (canonical dot-form), archived not deleted, and archived roles
      fail closed on assignment.
- [ ] Better Auth remains the session authority; revocation invalidates live sessions.
- [ ] Web is transport-only; Staff workspace renders Core results with explicit states.
- [ ] No Customer CRM, no public API, no direct D1 access, no owner-owned file touched.
- [ ] Full gate passes; Playwright executed vs skipped reported truthfully.
