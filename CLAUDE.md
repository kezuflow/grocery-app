# FreshMarkets — Claude Working Guide

## Before any architectural or implementation work

Read `AGENTS.md` first. It is the enforcement and documentation router for this
repository and points you to the canonical document(s) relevant to the change you
are about to make. Follow its Documentation Router and Phase Execution Rules.

## Canonical documentation

These directories are the source of truth. Do not contradict them, and update them
in the same change when an approved decision changes (never silently):

- `docs/architecture/` — runtime, repository, ownership, layering, contracts, data
  model, and state machines.
- `docs/product/` — MVP scope, phased implementation plan, and implementation
  status.
- `docs/design/` — admin and marketplace design and component guidance.

This file does not restate the architecture. Read the canonical documents; do not
rely on a summary here.

## Use the architecture-reviewer subagent

Delegate to the `architecture-reviewer` subagent (`.claude/agents/architecture-reviewer.md`)
for:

- **Phase readiness** — before starting a new implementation phase, to decide if the
  prerequisites are actually met (returns READY / READY AFTER SMALL FIXES / BLOCKED).
- **Architecture reviews** — to check that work respects boundaries, ownership,
  layering, contracts, the D1 data model, and locked business invariants.
- **Dependency reviews** — to check phase dependencies and cross-domain coupling.
- **Implementation-drift reviews** — to find where code and canonical documentation
  have diverged.

The reviewer is review-only: it inspects and reports, and does not implement fixes
unless you explicitly instruct it to afterward.

## Repository shape

pnpm monorepo. `apps/web` (vinext presentation Worker), `apps/core` (authoritative
Worker), and shared `packages/*`. Validate changes with `pnpm check`
(format, lint, typecheck, test, build) as described in `README.md`.
