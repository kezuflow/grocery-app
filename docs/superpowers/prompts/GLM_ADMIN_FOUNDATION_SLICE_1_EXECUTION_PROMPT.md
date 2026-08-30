# GLM 5.3 High/Max Prompt — Execute Admin Foundation Slice 1

Use this prompt in a fresh GLM 5.3 High or Max coding task. Max is recommended for Tasks 1–3. Start a
fresh context at a task boundary if the model starts summarizing instead of verifying.

```text
You are implementing ONLY FreshMarkets Admin Foundation Slice 1 in:
E:\GithubProjects\freshmarkets

READ FIRST, COMPLETELY, IN THIS ORDER
1. AGENTS.md
2. docs/architecture/ARCHITECTURE.md
3. docs/architecture/DOMAIN_MODEL.md
4. docs/architecture/STATE_MACHINES.md
5. docs/architecture/DATA_MODEL.md
6. docs/architecture/API_CONTRACTS.md
7. docs/product/PRODUCT_SCOPE.md
8. docs/product/IMPLEMENTATION_PLAN.md
9. docs/design/admin/DESIGN.md
10. docs/design/admin/COMPONENTS.md
11. docs/superpowers/specs/ADMIN_CRM_ANALYTICS_API_DESIGN.md
12. docs/superpowers/plans/ADMIN_CRM_ANALYTICS_PROGRAM_MAP.md
13. docs/superpowers/plans/ADMIN_FOUNDATION_SLICE_1_IMPLEMENTATION_PLAN.md

ACTIVE OBJECTIVE
Execute Slice 1 task-by-task: canonical admin capabilities, scoped admin context/scopes, authorized
redacted Audit reads, thin Web BFF routes, capability-aware admin shell, and Audit page.

ABSOLUTE SCOPE LOCK
Do not implement Staff CRUD, Customer CRM, Promotions, Catalog admin, Inventory UI, Orders admin,
Payments/Refunds/Memberships admin, Procurement/Receiving expansion, Delivery expansion, Analytics,
Overview metrics, notifications, exports, or later program slices. Do not create placeholder pages.
Do not add a public API, CORS, generic /api/admin/rpc, direct Web D1 access, generic status setters,
or hard-delete behavior.

DIRTY WORKTREE RULE
Before every task run git status --short. Record exact pre-existing modified and untracked files as
USER-OWNED. Never edit, format, stage, delete, move, reset, or commit them. Never run git reset
--hard or git checkout --. Stage only files listed by the active plan task.

At plan-writing time apps/web/app/globals.css and several storefront pages/components/tests were
user-owned changes. Re-discover current state. If Task 7 needs a target that remains dirty, STOP
before Task 7 and report the overlap. Do not resolve it yourself.

SOURCE AUTHORITY
AGENTS.md and canonical architecture/product/design documents override the plan on conflict. The
approved design controls the new API organization. Migrations/code/status are evidence, not
authority. Never invent a symbol: verify it with rg before editing or referencing it.

ANTI-DRIFT LEDGER
At the top of every progress update print:
Active slice: 1 — Admin Foundation
Active task: <number and name>
Allowed deliverable: <one sentence copied from the plan>
Explicit exclusions: Staff CRUD; Customer CRM; Promotions; later workspaces
User-owned dirty files: <current list or "none">

Before every code edit state:
"This edit is required by Task <N> and does not begin Slice 2."
If that sentence is false, do not make the edit.

EXECUTION PROTOCOL
1. Use the implementation plan exactly in order; do not combine or reorder tasks.
2. Inspect every named existing file fully before editing.
3. Write the specified failing test first.
4. Run the focused command and confirm the expected failure is caused by missing behavior.
5. Implement the minimum described behavior using apply_patch for edits.
6. Run focused tests/typecheck and read complete output.
7. Inspect git diff and staged names; exclude every unrelated file.
8. Commit with the exact conventional commit message from the task.
9. Stop for review after the commit. Report changed files, test evidence, and risks.
10. Continue only when the human says CONTINUE SLICE 1 TASK <next number>.

CONTEXT CHECKPOINT — AFTER EVERY TASK
- Re-read AGENTS.md, the design spec, and the next Slice 1 task.
- Re-run git status --short.
- Restate Core authority, Service Binding boundary, active task, and exclusions.
- Verify no proposed route was described as pre-existing.
- Verify no later-slice file or behavior entered the diff.

DOMAIN AND SECURITY GUARDS
- Better Auth owns authentication only; never return credential/session-token internals.
- Application IAM owns Staff roles/capabilities/scopes; no isAdmin shortcut.
- Use dot-form capabilities in new source. Preserve colon rows only through additive migration.
- Core enforces capability and market/location scope for every admin query.
- Audit returns purpose-built DTOs, never raw rows or raw JSON strings.
- Redact password/token/secret/cookie/authorization/accessToken/refreshToken/idToken/providerPayload.
- Lists are bounded and cursor-paginated; malformed cursors fail VALIDATION_FAILED.
- Web handlers validate transport input, forward session headers, call coreClient, and return Core.
- No module-level mutable request state or floating promises.

SHADCN/VINEXT GUARD
Use shadcn source primitives as required by Task 7. Follow the official existing-project command in
the plan. Do not overwrite existing Button/Badge. Inspect CLI diff immediately. If globals.css or a
target has user-owned changes, STOP; do not merge, reset, or overwrite it. Run vinext check and build
before claiming the UI task complete.

NO VAGUE WORK
Do not use placeholders or vague future-work language. Use exact schemas, cases, files, commands, and
outcomes from the plan. If a named symbol is absent and no earlier task creates it, stop and report
the mismatch.

COMPLETION EVIDENCE
Never claim a task or Slice 1 complete without fresh command output. A skipped Playwright test is an
unmet gate. Before the final report run every Task 8 command, inspect full output, and compare changed
files with the initial dirty-worktree ledger.

STOP NOW AFTER TASK 1
Begin with Task 1 only. After its focused commit, stop and report:
- commit hash;
- files changed;
- exact tests/typechecks and pass/fail counts;
- current git status;
- whether a user-owned file was touched;
- risks or plan contradictions;
- exact Task 2 entry condition.

Do not push. Do not begin Task 2 until the human says CONTINUE SLICE 1 TASK 2.
```
