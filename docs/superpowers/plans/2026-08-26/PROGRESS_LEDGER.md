# FreshMarkets Superpowers Progress Ledger

Recovery record for the product feature programs defined in `PRODUCT_FEATURE_PROGRAMS.md` and the
completed architecture remediation program (`REMEDIATION_PROGRAM.md`). Any session resuming work
must read `AGENTS.md`, `TRUNK.md`, `PRODUCT_FEATURE_PROGRAMS.md`, and this ledger's "Next
incomplete task" column before touching a worktree. This is a trunk-based repository: commit and
push only `main`; no feature branches or PRs without owner-approved exception; never force-push.

## Program / Spec Status

| Program | Spec status | Plan status | Worktree / location | State |
|---|---|---|---|---|
| Remediation Plans 01-07 + Plan 08 P1 core (authz audit, domain routes, `requestCancellation`) | approved (executed) | executed + reviewed | landed on `main` via remediation branch merge (PR #1, `7111518`) | COMPLETE |
| product-rulings reconciliation (D1-D11 into canonical docs; program map; ledger) | approved | done | landed directly on `main` per `TRUNK.md` | COMPLETE |
| Program 1 — Plan 08 completion | remediation program text is the spec base; slices approved by owner directive | Slices 1-2 done | direct on `main` per `TRUNK.md` | IN PROGRESS — next: Admin UI |
| Program 2 — Scheduled Jobs & Reconciliation | not started | not started | — | NOT STARTED |
| Program 3 — Renewal / Trial Conversion / Dunning | canonical policy approved (D2, encoded); program spec not started | not started | — | NOT STARTED |
| Program 4 — Payment Provider Readiness | not started (blocked on provider selection) | not started | — | BLOCKED-HUMAN |
| Program 5 — Instant Mode | design brainstorm not started (D1 requires dedicated design spec) | not started | — | NOT STARTED |
| Program 6 — Transactional Notifications | not started (blocked on email provider selection for delivery slices) | not started | — | BLOCKED-HUMAN (partial) |
| Program 7 — Delivery Instructions | not started | not started | — | NOT STARTED |
| Program 8 — Product Media (R2) | not started | not started | — | NOT STARTED |
| Program 9 — Order Detail / Tracking | not started | not started | — | NOT STARTED |
| Program 10 — Order-Issue Intake | not started | not started | — | NOT STARTED |
| Program 11 — Reorder / Buy Again | not started | not started | — | NOT STARTED |
| Program 12 — Privacy / Account Closure | not started | not started | — | NOT STARTED |
| Program 13 — Tax/Invoicing Seams | not started | not started | — | NOT STARTED |
| Program 14 — Support / Contact | not started | not started | — | NOT STARTED |

## Task Ledger

| Program/spec | Task | Status | Commit SHA | Verification | Review result | Push result | Next incomplete task |
|---|---|---|---|---|---|---|---|
| product-rulings reconciliation | Reconcile D1-D11 + additional rulings into canonical docs; write program map + ledger; land on `main` | DONE | see `git log` "docs: reconcile product rulings D1-D11 and approve feature programs" on `main` | docs-only; `pnpm naming:check` pass | owner-approved landing during trunk cleanup | pushed to `origin/main` | Wave 0 programs |
| Program 1 / Slice 1 | Composition-root extraction: entrypoint -> transport+composition+delegation; domain moved to customer/geography/membership/commerce/checkout/orders/procurement/operations/payments modules; ownership test extended RED-first | DONE | `19d3cf1` | `pnpm check` green (format/naming/lint/typecheck/182 tests/recursive builds); `check:vinext` exit 0; `git diff --check` clean | self-review pass; behavior-preserving with one noted error-precedence normalization in receiveProcurement (session resolved before requirement lookup) | pushed `origin/main` | Program 1 / Slice 2 | Scoped operational read models + commitment seeds fulfillment/delivery records + assignRider + rider-job restriction on advanceDelivery | DONE | `131f493` | pnpm check green (187 core tests incl. 5-test matrix); vinext 0 | self-review; rider-assigned-job restriction implements the documented route contract; flagged in report | pushed `origin/main` | Slice 3: purpose-built Admin operational UI |
| Slice 2: purpose-built operational read models |
| Program 2 | cron registry + hold-expiry slice | NOT STARTED | — | — | — | — | full brainstorm/spec |
| Program 3 | state/command machinery slice | NOT STARTED | — | — | — | — | full brainstorm/spec |
| Program 4 | provider integration spec | BLOCKED-HUMAN | — | — | — | — | provider selection |
| Program 5 | Instant design spec | NOT STARTED | — | — | — | — | brainstorm (twelve D1 areas) |
| Program 6 | templates/render/dispatch slice | NOT STARTED | — | — | — | — | brainstorm/spec |
| Programs 7-14 | (one row per slice once planned) | NOT STARTED | — | — | — | — | short-form specs |

## Session Recovery Notes

- Repository policy is trunk-based development (`TRUNK.md`): commit directly to `main`, push with
  `git push origin main`. `.githooks/pre-push` rejects non-`main` pushes; bypass only with
  owner-approved `--no-verify`. Worktrees isolate uncommitted state only.
- The short-lived branch `feature/product-rulings-reconciliation` (and its remote copy) was an
  exception created before the trunk policy existed; its content was landed on `main` and the
  branch deleted in the same cleanup. Do not recreate it.
- History context: remediation work merged via PR #1 (`7111518`); the generated-typings formatting
  fix reached `main` through merge `cb00658`/`0721e12`; the duplicate orphan commit `49d89eb` that
  briefly carried the same fix on the feature branch is intentionally not part of `main`.
- The rejected dirty Phase 4C implementation and untracked `0015_phase4c_subscriptions.sql` are
  gone from all working trees (owner-approved discard). Their recorded evidence (SHA-256 baseline)
  remains in `REMEDIATION_PROGRAM.md`; do not recreate them. The next accepted migration number
  starts at `0019`.
- Tracked migrations end at `0018_checkout_orders.sql`.
- Verification gates per slice: `pnpm naming:check`, `pnpm typecheck`, `pnpm test`, `pnpm lint`,
  `pnpm format:check` (changed files), `pnpm -r build` when bindings/contracts change, fresh-D1
  migration apply for migration-owning slices, `check:vinext` for Web boundary slices.
