---
name: phase-review
description: Reviews one phase or a range of FreshMarkets implementation phases against canonical documentation and the actual repository. Use before implementation or to audit completed phases.
argument-hint: "[phase | start to end | all]"
disable-model-invocation: true
context: fork
agent: architecture-reviewer
background: false
---

# Phase Review

Review the implementation phases requested by the user:

$ARGUMENTS

## Interpret the argument

Accept:

- `2` -> review Phase 2
- `2 to 5` -> review Phases 2, 3, 4, and 5
- `1 to 12` -> review Phases 1 through 12 inclusive
- `all` -> review every phase defined in IMPLEMENTATION_PLAN.md

If the requested range is invalid or refers to phases that do not exist,
report that clearly and stop.
Do not ask the user to restate a valid range.

## Required context

Before reviewing phases:

1. Read `/AGENTS.md`.
2. Read `/CLAUDE.md`.
3. Read `/docs/product/IMPLEMENTATION_STATUS.md`.
4. Read `/docs/product/IMPLEMENTATION_PLAN.md`.
5. Read the canonical architecture documents relevant to the requested phases.
6. Inspect the actual repository implementation where necessary.

Do not assume a phase is implemented merely because it appears in the plan.
Use IMPLEMENTATION_STATUS.md and the actual repository to establish reality.

## Review behavior by phase status

For each requested phase:

### If IMPLEMENTED

Audit the actual implementation against:

- AGENTS.md
- canonical architecture
- domain model
- state machines
- API contracts
- data model
- implementation plan
- relevant design documentation

Inspect actual:

- source code
- contracts
- migrations
- configuration
- tests
- bindings
- authorization
- persistence

Determine whether the implementation is suitable foundation for subsequent phases.

### If IN PROGRESS

Audit both:

- work already implemented
- remaining documented requirements

Identify blockers before additional implementation continues.

### If NOT IMPLEMENTED

Do not report missing code as a defect.
Instead perform a readiness and dependency review:

- prerequisites
- architecture dependencies
- domain dependencies
- schema dependencies
- contract dependencies
- authorization requirements
- concurrency/idempotency requirements
- required tests
- unresolved decisions
- dependencies on earlier phases

Determine whether the phase can safely be implemented when its turn arrives.

## Cross-phase review

When more than one phase is requested, do not review each phase in isolation.
Also trace dependencies across the entire requested range.

Look for:

- capability introduced too late
- earlier phase depending on a later phase
- duplicated responsibilities
- architectural boundary drift
- state-machine mismatches
- data-model inconsistencies
- missing contracts
- missing authorization foundations
- premature infrastructure
- MVP functionality that has no implementation phase
- future functionality leaking into earlier phases

Trace important rules through:
architecture
-> domain
-> state machine
-> data model
-> contracts
-> implementation
-> tests
-> dependent phases

## Architecture priorities

Always check:

- Web/Core authority boundary
- typed Cloudflare Service Bindings
- D1 authority
- Better Auth ownership
- authentication vs authorization
- customer/staff principal separation
- RBAC and scopes
- command/query boundaries
- DTO vs persistence separation
- D1 atomicity
- concurrency
- idempotency
- immutable snapshots
- payment -> order commitment
- order -> demand/reservation
- cutoff -> procurement
- receiving -> inventory/fulfillment
- fulfillment -> delivery

Do not recommend abstractions merely for architectural purity.
Do not rewrite working code without a concrete correctness,
security, dependency, or maintainability reason.

## Severity

Use:

- BLOCKER
- HIGH
- MEDIUM
- LOW

## Phase verdicts

For implemented phases:

- PASS
- PASS WITH REQUIRED FIXES
- FAIL

For unimplemented phases:

- READY
- READY AFTER PRIOR-PHASE FIX
- BLOCKED BY DEPENDENCY
- BLOCKED BY DECISION

## Output files

Create one review artifact for each requested phase:
`/docs/reviews/PHASE_XX_REVIEW.md`

Use zero-padded phase numbers.
Examples:

- Phase 1 -> `PHASE_01_REVIEW.md`
- Phase 8 -> `PHASE_08_REVIEW.md`
- Phase 12 -> `PHASE_12_REVIEW.md`

Each phase review must contain:

# Phase XX Review

## Status
Current implementation status.

## Verdict
The phase verdict.

## Purpose
What this phase is supposed to establish.

## Dependencies
Hard and soft dependencies.

## Findings
Only meaningful findings with severity.
For implementation findings include exact file paths and symbols where possible.

## Architecture Compliance
Relevant canonical architecture checks.

## Data and Contract Review
Relevant persistence and API-contract concerns.

## Authorization
Relevant authentication/authorization requirements.

## Concurrency and Idempotency
Only where applicable.

## Tests
Existing tests for implemented phases or required tests for future phases.

## Required Before Proceeding
Only actions actually required.

## Can Be Deferred
Issues that should deliberately wait.

## Handoff Recommendation
Whether this phase should receive an implementation handoff.

## Range summary

When reviewing more than one phase, also create:
`/docs/reviews/PHASE_<START>_TO_<END>_SUMMARY.md`

Example:
`/docs/reviews/PHASE_01_TO_12_SUMMARY.md`

The summary must contain:

# Phase Range Review

## Overall Verdict

## Phase Matrix

| Phase | Status | Verdict | Blocking Dependency |
|---|---|---|---|

## Cross-Phase Dependency Problems

## Architecture Drift

## Critical Path
Show the dependency-aware implementation sequence.

## Must Fix Now
Only issues blocking the next implementation phase.

## Fix Later
Map each deferred issue to the phase before which it must be resolved.

## Unresolved Decisions
Only decisions that materially affect implementation.

## Recommended Next Phase
State exactly what should happen next.

## Important restrictions

This skill is review-only.

Do NOT:

- implement application functionality
- modify application source
- create migrations
- refactor code
- install packages
- change runtime configuration
- silently repair findings
- mark handoffs APPROVED
- begin another phase

You MAY create or replace only the requested files under `/docs/reviews/`.

End by reporting:

- phases reviewed
- files created
- overall verdict
- next recommended action
