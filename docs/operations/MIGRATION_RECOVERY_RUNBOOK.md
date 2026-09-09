# Migration Recovery Runbook

## Choose the lifecycle first

FreshMarkets is pre-launch. A better schema may replace or squash the development baseline under [ENGINEERING.md](../architecture/ENGINEERING.md#pre-launch-schema-and-interface-policy). This runbook does not require preserving disposable fixtures or an obsolete migration chain.

For a disposable local environment, identify its exact database/persistence directory, update the baseline and all consumers/seeds/verifiers, then recreate only that environment through its reviewed setup workflow. Verify clean initialization and relevant Worker/D1 tests. Editing an already-applied migration does not upgrade its database.

For shared staging data that must be retained, or a supported production baseline, use a tested migration/upgrade and recovery procedure. Identify the actual database and code version; do not infer disposability from an environment label. No documentation or test command authorizes a destructive remote reset.

## Retained-environment prerequisites

- Identify the target Core D1 database and an approved maintenance window.
- Confirm a recent platform-managed D1 backup exists before applying a
  production migration. Backup operations are performed in Cloudflare, never
  by copying credentials into a command line.

## Preflight and apply

```text
pnpm migration:check
pnpm --filter @freshmarkets/core build
```

Apply migrations through the reviewed Core deployment process. The local
verifier exercises SQLite schemas and selected upgrades; it is neither a production backup nor proof of Worker/D1 runtime integration. See [ENGINEERING.md](../architecture/ENGINEERING.md#choose-checks-by-risk).

## Recovery

1. Stop further deployment/traffic promotion and record the Worker version, migration filename, UTC
   time, and request references from structured logs.
2. Assess writes and provider operations since the recovery point before restoring. Prefer a forward repair when it preserves valid new work. If restoration is required, use the target database's verified recovery procedure and account for post-backup writes; restoration is not automatically harmless.
3. Redeploy the matching prior Worker version.
4. Run `pnpm migration:check` locally and perform the health and representative
   read-only smoke checks before retrying.
5. Reconcile any provider or scheduled-job effects using their runbooks; do not
   hand-edit business rows.
