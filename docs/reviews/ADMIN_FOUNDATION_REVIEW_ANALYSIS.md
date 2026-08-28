# Admin Foundation Recommended Fixes

**Scope:** Admin Foundation Slices 1–4  
**Purpose:** Recommended remediation only. No implementation changes are included.

## Recommended order

1. Fix Slice 3 privacy actions and Slice 4 reserved promotion codes.
2. Fix command concurrency, Audit, and idempotency integrity across Slices 2–4.
3. Correct contract and read-model boundary violations.
4. Complete the Admin workspaces and recovery states.
5. Add the missing authenticated Playwright coverage.

## Slice 1 — Admin Foundation

### 1. Add the Audit detail surface

Create `apps/web/app/admin/audit/[audit-event-id]/page.tsx` and load the existing
`GET /api/admin/audit/[audit-event-id]` route. Display the sanitized metadata, before/after values,
actor, scope, reason, correlation ID, and timestamp. Handle loading, forbidden, not-found, and error
states.

**Tests:** Add route-to-page Playwright coverage proving an Audit row opens its sanitized detail.

### 2. Add an explicit admin scope selector

Use the scope options already returned by `AdminContextProvider`. Store one selected market or
location scope, render it in `AdminShell`, and require scoped workspaces to consume that explicit
selection. Do not treat the list of IAM assignments as the selected command target.

**Tests:** Cover global, market, location, no-scope, unavailable-scope, and scope-change behavior.

### 3. Fail the shell when scope loading fails

In `apps/web/app/admin/admin-context-provider.tsx`, preserve errors returned by
`/api/admin/scopes` instead of converting them to an empty successful result. Show the request
reference and provide a retry action.

### 4. Delegate validated Audit inputs

In the Core entrypoint and Web Audit routes, pass normalized validation output rather than the
original request values. Replace permissive `Date.parse` validation with a strict ISO-8601 instant
schema for `from` and `to`.

**Tests:** Add whitespace-normalization and invalid/non-ISO timestamp cases.

### 5. Separate permission and recoverable error states

Give the Audit workspace distinct forbidden and transient-error views. Add retry for network and
server failures. Highlight the active navigation item using the current pathname instead of always
highlighting Overview.

### 6. Complete Slice 1 browser acceptance coverage

Provision a real Staff test principal with capabilities and scopes. Add Playwright journeys for:

- capability-filtered navigation;
- selected scope;
- Audit rows and detail;
- filtered-empty Audit results;
- forbidden and request-reference errors;
- accessible mobile navigation.

The Slice 1 gate remains open until these tests run without skips.

## Slice 2 — Staff & Access

### 1. Rebuild replacement commands around one correct CAS transaction

Fix `setAdminStaffRoles`, `setAdminStaffScopes`, and `setAdminRoleCapabilities` so one transactional
batch performs:

1. the expected-version comparison;
2. relationship replacement;
3. aggregate version increment;
4. Audit append;
5. idempotency completion.

Do not check the old version after incrementing it. A zero-row CAS must not write Audit or mark the
command successful. Determine success from the guarded mutation result, not merely from a later
version value that another command could have produced.

**Tests:** Add successful replay, conflicting replay, concurrent winner, stale no-op, no-false-Audit,
and idempotency-record status assertions for all three commands.

### 2. Make every material mutation atomic with Audit and idempotency

Apply the same transaction boundary to staff update, access change, role update, role archive, and
invitation revocation. For session revocation, batch the Better Auth session deletion, Audit append,
and idempotency completion in D1, or define an explicit recoverable operation if a future auth
adapter prevents atomicity.

An Audit failure must not be ignored after the authoritative mutation succeeds.

### 3. Correct command replay ordering

Check the idempotency record before rejecting an already-achieved state. An identical replay of
SUSPEND, ACTIVATE, archive, or invitation revocation must return the authoritative successful result.
A reused key with a different payload must return `IDEMPOTENCY_CONFLICT`.

### 4. Validate assigned scopes against authoritative geography

Before replacing Staff scopes, confirm that every market and location exists and is active. Reject
unknown or inactive IDs with `VALIDATION_FAILED`. Preserve the canonical market/location hierarchy
and prevent invalid `staff_scope` records.

**Tests:** Cover unknown, inactive, mismatched, duplicate, global, market, and location scopes.

### 5. Resolve archived-role authorization behavior

Decide whether archiving immediately removes authority from existing assignments.

- Recommended: archived roles remain visible for history but contribute no capabilities in
  `applicationContext`.
- If existing assignments must remain effective, document that explicitly and provide a separate
  role-deactivation operation.

Add authorization tests for a principal whose assigned role becomes archived.

### 6. Remove Better Auth identifiers from Staff DTOs

Remove `authUserId` from `AdminStaffSummary` and `AdminStaffDetail`. Keep the Better Auth user ID as
an internal Application IAM linkage. Email remains the only authentication-sourced display field.

Update contracts, Core projections, and contract tests together.

### 7. Repair invitation revocation

Add a dedicated Web route that calls `revokeAdminStaffInvitation`. Update the Staff page to use it,
collect an operator-provided reason, require confirmation, show the Core result, and reload only
after success.

**Tests:** Cover success, already-revoked replay, invalid state, forbidden access, and command error.

### 8. Complete the Staff workspace

Add UI controls for:

- updating the Staff display name;
- assigning global, market, and location scopes;
- atomic role replacement with an explicit Save action.

Use the Core-provided capability set to hide or disable manage actions for `staff.read`-only users.
Require confirmation for suspension, session revocation, invitation revocation, and role archival.
Disable command controls while a request is pending.

### 9. Improve Staff workspace recovery states

Do not convert failed invitation, role, or capability queries into empty data. Show the error and
request reference. On `STALE_VERSION`, reload authoritative state before allowing another command.
Represent pending, success, forbidden, conflict, and terminal failure separately.

### 10. Reconcile the invitation contract

Update `docs/architecture/API_CONTRACTS.md` so `admin.staff.invite` consistently returns
`AdminStaffInvitationView`, matching the deferred identity-provisioning lifecycle and implemented
service contract.

### 11. Complete Slice 2 browser acceptance coverage

Add authenticated Playwright journeys for:

- invitation creation and revocation;
- Staff rename and access changes;
- role and scope replacement;
- live session revocation;
- role creation, update, capabilities, and archive;
- read-only permission behavior;
- stale/conflict and error recovery.

The Slice 2 gate remains open until these tests execute without skips.

## Slice 3 — Customer CRM

### 1. Include the privacy-request version in queue results

Add `version` to the `listPrivacyRequests` projection. The UI currently submits an undefined
`expectedVersion`, so every privacy action is rejected at the boundary.

**Tests:** Assert the queue version through Core, BFF, and one authenticated UI action.

### 2. Make privacy transitions one guarded transaction

Guard the privacy mutation, Audit append, and idempotency completion with the same status/version
comparison. A stale command must not create Audit evidence or a successful idempotency record.
Determine success from the guarded mutation, not a later version that another command may have
produced.

### 3. Repair access and privacy replay handling

Resolve idempotency before checking the current lifecycle state. Identical successful replays must
return their original result. Mark stale access claims failed or retryable instead of leaving them
permanently `PROCESSING`.

**Tests:** Cover identical replay, conflicting replay, stale no-op, concurrent winner, and
idempotency-record state.

### 4. Remove Better Auth IDs from Customer DTOs

Remove `authUserId` from `AdminCustomerSummary` and related public projections. Retain it only as an
internal linkage; email is the sole authentication-owned Customer display field.

### 5. Correct Customer order and Audit summaries

Count only canonically committed orders and derive the last-order timestamp from the same set.
Build material history from Audit events about the Customer and linked privacy requests, rather
than filtering only on the Customer auth user as actor.

### 6. Make session revocation atomic

Batch Better Auth session deletion, Audit append, and idempotency completion, or implement an
explicit reconciliation path. Never ignore a failed Audit append after sessions were deleted.

### 7. Align privacy persistence with the canonical model

Replace the scalar `resolution` storage with the canonical structured `resolution_json` shape, or
record an approved canonical-model change before retaining the scalar representation.

### 8. Complete Customer CRM recovery and browser coverage

Keep one idempotency key for each logical submission, disable duplicate commands while pending,
reload on `STALE_VERSION`, and hide or disable manage controls for read-only users. Add authenticated
Playwright journeys for invitation, access, session, closure, and every privacy transition.

## Slice 4 — Promotions

### 1. Reserve system promotion codes

Reject `INTRO_TRIAL`, `LEGACY_TRIAL_HISTORY`, and the reserved system namespace in Core, with a D1
constraint where practical. An Admin-created collision must never expose membership-trial grants or
redemptions through the Promotions workspace.

### 2. Make update and grant commands atomic

Execute each Promotion mutation, Audit append, and idempotency completion in one transaction. Add a
canonical uniqueness rule for a targeted Promotion grant so a retry or second key cannot create an
unintended duplicate.

**Tests:** Inject Audit/idempotency failures and cover duplicate grants and partial-failure retries.

### 3. Repair lifecycle concurrency and replay

Resolve successful idempotent replay before lifecycle legality checks. Determine status-change
success from the guarded mutation and target status, not only `version === expectedVersion + 1`.
Ensure losing commands do not remain `PROCESSING` or return another command's result.

### 4. Implement the approved update and benefit surfaces

Permit name/description changes on non-archived Promotions while restricting definition changes to
`DRAFT`. Expose both fixed and percent creation plus draft editing in the workspace, with contracts
that clearly separate metadata updates from definition updates.

### 5. Return Core-derived allowed actions

Add capability- and lifecycle-derived `allowedActions` to the Promotion detail read model. Hide or
disable activate, deactivate, archive, edit, and grant controls for `promotions.read`-only users.

### 6. Validate grant and redemption list boundaries correctly

Replace the generic list schema with a detail-plus-pagination schema that requires `promotionId`.
Malformed service-binding calls must return `VALIDATION_FAILED` before reaching D1.

### 7. Complete Promotions recovery and browser coverage

Preserve one idempotency key per submission, disable pending actions, confirm destructive actions,
reload on stale versions, and surface grant/redemption read failures instead of empty lists. Add
authenticated Playwright coverage for create, edit, activate, preview, grant, deactivate, and
archive, including the percent-discount path.

## Completion gate

Before closing any slice, run the focused contract/Core/Web suites and the full repository gates.
Then run all authenticated Admin Playwright journeys on a provisioned local stack. A skipped browser
test remains an unmet acceptance condition.
