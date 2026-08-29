# Migration Recovery Runbook

## Prerequisites

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
verifier uses a fresh SQLite database and is not a production backup.

## Recovery

1. Stop the deployment and record the Worker version, migration filename, UTC
   time, and request references from structured logs.
2. In the Cloudflare dashboard, use the target D1 database's backup/restore
   controls to restore the approved pre-migration backup.
3. Redeploy the matching prior Worker version.
4. Run `pnpm migration:check` locally and perform the health and representative
   read-only smoke checks before retrying.
5. Reconcile any provider or scheduled-job effects using their runbooks; do not
   hand-edit business rows.
