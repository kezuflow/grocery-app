# GLM 5.3 Flash High/Max Prompt — FreshMarkets Admin Program

Copy the prompt below into a new coding-agent task. This version is intentionally planning-first and
phase-gated so a smaller or faster model does not attempt the entire program in one context window.

```text
You are working in E:\GithubProjects\freshmarkets.

OBJECTIVE
Create a dependency-ordered, implementation-ready plan for the approved FreshMarkets Admin, CRM,
Analytics, Staff & Access, Promotions, and operational dashboard program. Do not implement app code
in this task. Your output is the plan and a precise recommendation for the first execution slice.

AUTHORITATIVE SOURCE ORDER
When information conflicts, obey this order:
1. AGENTS.md
2. docs/architecture/ARCHITECTURE.md
3. docs/architecture/DOMAIN_MODEL.md
4. docs/architecture/STATE_MACHINES.md
5. docs/architecture/DATA_MODEL.md
6. docs/architecture/API_CONTRACTS.md
7. docs/product/MVP_SCOPE.md
8. docs/product/IMPLEMENTATION_PLAN.md
9. docs/design/admin/DESIGN.md
10. docs/design/admin/COMPONENTS.md
11. docs/superpowers/specs/ADMIN_CRM_ANALYTICS_API_DESIGN.md
Implementation status, old plans, migrations, README files, and code are evidence only and cannot
override those documents.

MANDATORY STARTUP SEQUENCE
1. Read AGENTS.md and every authoritative file above completely.
2. Read docs/product/IMPLEMENTATION_STATUS.md.
3. Run git status --short and git log -5 --oneline.
4. Inventory packages/contracts/src, apps/core/src, apps/core/migrations, apps/web/app/admin,
   apps/web/app/api/admin, apps/web/components/admin, and relevant tests.
5. Distinguish each operation as CURRENTLY IMPLEMENTED, CANONICAL BUT UNIMPLEMENTED, or NEWLY
   APPROVED BY THE DESIGN SPEC. Never call a proposed route existing.
6. Report the inventory and any contradiction before writing the plan.

SCOPE LOCK
The approved program contains exactly these workstreams:
A. Shared admin contract/IAM/context/shell/audit foundation.
B. Staff identities, roles, capabilities, scopes, invitations, suspension, and session revocation.
C. Customer CRM, access disable/restore, privacy/closure requests, and composed Customer detail.
D. Controlled Promotions definitions, lifecycle, preview, grants, redemptions, and reporting.
E. Catalog, SKU, controlled units, availability, prices, media, and Inventory administration.
F. Orders, issues, Payments, Refunds, Memberships, and reconciliation exceptions.
G. Procurement, Receiving, Fulfillment, Delivery, mode configuration, and operational exceptions.
H. Versioned Analytics definitions/read models, Overview, and approved exports.
I. Cross-workspace verification, accessibility, security, and production readiness.

OUT OF SCOPE
- Public REST/CORS or direct Web-to-D1 access.
- Generic raw-table CRUD or generic status setters.
- Hard deletion of Orders, Payments, Refunds, redemptions, Subscriptions, inventory ledgers, or Audit.
- Password/session-token access by admin DTOs.
- A global isAdmin authority.
- Arbitrary Promotion scripts or expressions.
- Directly setting Subscription ACTIVE or Payment SUCCEEDED.
- Guessing blocked GMV/revenue/AOV/MRR/churn/refund-rate or other accounting definitions.
- New microservices, Durable Objects, Workflows, KV, or Queues without an approved measured need.
- Production payment-provider or renewal/retry policy selection.
- Any current unrelated storefront work.

NON-NEGOTIABLE DOMAIN GUARDS
- apps/web is presentation only; apps/core is authoritative.
- Web calls Core through typed Cloudflare Service Bindings.
- Better Auth owns authentication; Customer and Staff are application-owned principals.
- Customer CRUD means approved profile/support changes, access disable/restore, session revocation,
  and privacy/closure workflows. It does not mean hard deletion of retained history.
- Staff CRUD means invitation/provisioning, metadata, activation/suspension, roles, capabilities,
  scopes, and session revocation. Admin never accepts or returns passwords.
- Promotions use only the closed canonical benefits/rules and preserve redemption history.
- Every material mutation is a named command with capability/scope authorization, caller-stable
  idempotency, expectedVersion when concurrent, reason when material, and Audit.
- Analytics owns no source domain state and publishes only one versioned canonical definition per
  metric. Blocked metrics return unavailable with a reason.
- Money is integer minor units. Inventory/demand is integer GRAM, MILLILITER, or PIECE.
- Fulfillment mode and sourcing mode remain separate.

DIRTY-WORKTREE SAFETY
The repository may already contain unrelated uncommitted storefront work. Treat every existing
modification and untracked file as user-owned. Do not edit, format, stage, delete, reset, move, or
commit those files. Do not run git reset --hard or git checkout --. Plans must name only files that
belong to the active slice. The repository uses trunk-based development on main; do not create a
feature branch or PR.

ANTI-DRIFT PROTOCOL
Maintain a Scope Ledger at the top of your working response with four fields:
- Active objective
- Active slice
- In-scope files/domains
- Explicitly excluded files/domains

Before each plan task, write a one-line invariant check: "This task advances [active slice] and does
not begin [next slice]." If it does not, remove or defer it.

Every five plan tasks, perform a Context Checkpoint:
1. Re-read AGENTS.md and the approved design spec.
2. Restate Core ownership, the active slice, and the next unimplemented acceptance criterion.
3. Compare planned files against git status.
4. Remove speculative infrastructure, generic CRUD, duplicate business logic, and later-slice work.

Do not use "TODO", "TBD", "implement later", "add validation", "handle errors", or "write tests"
without exact schemas, cases, commands, files, and expected results. Do not invent existing symbols.
Verify every referenced file/function/type with rg before naming it in the plan.

PLAN REQUIREMENTS
Write docs/superpowers/plans/ADMIN_CRM_ANALYTICS_IMPLEMENTATION_PLAN.md using small,
dependency-ordered tasks. Each task must include:
- exact files to create/modify/test;
- exact interfaces consumed and produced;
- a failing test first;
- the command to prove the intended failure;
- minimal implementation steps;
- focused verification commands and expected results;
- documentation/status updates when behavior changes;
- one focused conventional commit, staging only the task's files.

The plan must use these execution slices and must not merge them into one change:
1. Shared contract/IAM/context/shell/audit foundation.
2. Staff & Access.
3. Customer CRM and privacy/closure.
4. Promotions.
5. Catalog and Inventory.
6. Orders, Payments, Refunds, Memberships, and issues.
7. Procurement, Receiving, Fulfillment, Delivery, and mode configuration.
8. Analytics and Overview.
9. Cross-workspace verification and production readiness.

For each slice, include entry dependencies, migrations, Core commands/queries, shared contracts,
Web BFF routes, admin pages/components, tests, acceptance criteria, explicit exclusions, and a stop
gate. Recommend only Slice 1 for the first implementation session.

REQUIRED FINAL SELF-REVIEW
Before claiming the plan complete:
1. Map every section of the approved design spec to at least one plan task.
2. Search the plan for placeholders and vague steps, then replace them.
3. Verify type/function names remain consistent across tasks.
4. Verify the plan never exposes raw Better Auth/D1/provider rows.
5. Verify no destructive hard-delete endpoint was introduced.
6. Verify blocked Analytics metrics remain unavailable.
7. Verify no unrelated dirty storefront file is named for modification.
8. Report any unresolved contradiction; do not resolve it by assumption.

STOP CONDITION
After saving and self-reviewing the plan, stop. Report the plan path, the exact proposed Slice 1
scope, risks, and verification commands. Do not implement, migrate, commit, push, or start Slice 1
until the human explicitly approves execution.
```
