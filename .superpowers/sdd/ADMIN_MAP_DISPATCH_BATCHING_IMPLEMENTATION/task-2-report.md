# Task 2 Report: Canonical Delivery Batch Migration 0043

## Status and scope

Task 2 is implemented and verified in the isolated
`E:/GithubProjects/freshmarkets/.worktrees/maps-program` worktree. The change is limited to exact
migration `0043_delivery_batches_and_map_stops.sql`, its full pre-0043 preservation integration
test, and the test-setup selection needed to apply 0043 only after compatibility fixtures are
seeded. No Task 3+ delivery reads, route preview, atomic command, Web route/UI, Rider runtime, new
Cloudflare resource, or unrelated Admin Catalog change is included.

## Strict TDD evidence

The full preservation test and its pre-0043 setup path were written before the migration existed.

- Genuine RED: `pnpm --filter @freshmarkets/core test -- delivery-map-migration.integration.test.ts`
  exited 1. The fixture seeded successfully and the sole test failed specifically with
  `0043_delivery_batches_and_map_stops.sql must exist before the preservation fixture can upgrade:
  expected undefined to be defined`.
- First GREEN after the minimum migration: the same command exited 0; 1 file and 1 test passed.
- Existing-suite compatibility RED 1: the focused delivery set exposed three failures because the
  rebuild had accidentally dropped the historical `delivery_job.fulfillment_mode` default.
  Restoring `DEFAULT 'SCHEDULED'` moved the failures to the next real compatibility boundary.
- Existing-suite compatibility RED 2: the focused delivery set then exposed three failures because
  the first draft invented a new `delivery_job.order_id` foreign key that pre-0043 never enforced
  and compatibility projection fixtures intentionally do not require. The migration now retains
  stable `order_id` identity without inventing that FK; all rebuild-lost and new canonical
  batch/stop/rider/event relationships remain constrained.
- Focused compatibility GREEN:
  `pnpm --filter @freshmarkets/core test -- delivery-map-migration.integration.test.ts operational-read-models.integration.test.ts cycle-lifecycle.integration.test.ts operations-exception.integration.test.ts`
  exited 0; 4 files and 13 tests passed.
- Full Core GREEN: `pnpm --filter @freshmarkets/core test` exited 0; 95 files and 514 tests passed.

## Schema before and after

Before 0043:

- `delivery_batch` required a Scheduled cycle and stored only status, legacy `rider_user_id`,
  created time, and version.
- `delivery_job` supported Instant nullable cycle after 0021, retained legacy Rider auth-user
  identity and raw address snapshot, and had canonical status/version/timestamps after 0039.
- `delivery_stop` stored batch/job/sequence/status, compatibility `proof_json`, and version only.
- There was no application-owned canonical Rider row and no Delivery-owned event/proof table.

After 0043:

- `rider_identity` is application-owned and links the historical assigned Staff identity to a
  canonical Rider ID. Historical rider auth IDs are retained only as compatibility columns.
- `delivery_batch` carries fulfillment mode, nullable-only-for-Instant cycle, required location,
  optional zone, canonical Rider, closed lifecycle state, optimistic version, created/updated,
  dispatched/completed timestamps, and compatibility `rider_user_id`.
- `delivery_job` carries batch/manual sequence, mode/cycle, backfilled location/zone/promise,
  canonical Rider, compatibility Rider/auth snapshot fields, legal state, version, and timestamps.
- `delivery_stop` has exactly one row per migrated job, unique assigned batch sequence, immutable
  coordinate/address/contact/instruction snapshots, legal state/result timestamps/failure fields,
  version/timestamps, and byte-preserved compatibility proof JSON.
- `delivery_event` materializes existing Delivery Job `domain_event` history and is append-only;
  it carries job, stop, Rider, event/time, metadata, and optional unique idempotency identity.
- `delivery_proof` retains the exact historical proof bytes and canonical stop/Rider/time identity;
  photo/signature columns remain nullable future metadata and 0043 claims no photo/signature MVP.

The rebuild is forward-only: legacy stop/job/batch tables are renamed, canonical tables are
created, all rows are copied/backfilled, canonical proofs/events are materialized, legacy tables
are dropped only after copying, and indexes/triggers are recreated. Migrations 0041 and 0042 are
untouched and remain registered before 0043.

## Preservation and constraint evidence

The test starts from the complete migration chain through 0042 and seeds three committed
delivery contexts: Scheduled unbatched, Instant unbatched, and Scheduled already batched/delivered.
It also seeds one ordered legacy stop, canonical status history in `domain_event`, an active
application Staff/Rider identity, exact address snapshots, legacy Rider auth identity, versions,
timestamps, delivered time, and proof JSON.

After applying only 0043, the test proves:

- 3 jobs, 1 historical batch, and exactly 3 unique job stops remain; no existing stop is duplicated;
- Instant job cycle remains null while Scheduled contexts retain their cycle;
- location/zone/mode/cycle and canonical Rider context are backfilled from immutable fulfillment
  evidence without changing Order state;
- address snapshot, compatibility proof JSON, source `domain_event.payload_json`, canonical
  `delivery_event.metadata_json`, delivered timestamps, IDs, sequences, and versions are exact;
- stop coordinates and address/contact/instruction snapshots reject mutation;
- event updates/deletes reject, event idempotency keys are unique, and foreign-key check is empty;
- invalid Instant-with-cycle and Scheduled-without-cycle batches reject;
- `sqlite_master`, table metadata, row counts, indexes, triggers, and `PRAGMA foreign_key_check` are
  inspected by real D1 operations rather than source-text assertions.

Indexes added/restored include Rider status/location; batch active-context and Rider/open work;
job context/status and batch/sequence; unique stop/job and partial unique batch/sequence; event
job/time and idempotency; and proof Rider/time. Status-check triggers exist for batch/job/stop,
the stop destination/snapshot immutability trigger is installed, and event update/delete triggers
enforce append-only history.

## Fresh verification gates

- `pnpm format:check` — exit 0; 639 files matched.
- `pnpm naming:check` — exit 0.
- `pnpm migration:check` — exit 0; fresh apply and populated 0021-to-current upgrade valid.
- `pnpm lint` — exit 0; 19 pre-existing warnings and 0 errors.
- `pnpm typecheck` — exit 0; all six participating workspace projects.
- `pnpm --filter @freshmarkets/core build` — exit 0; Wrangler dry-run succeeded.
- `pnpm --filter @freshmarkets/core test` — exit 0; 95 files and 514 tests.
- `git diff --check` — exit 0 before report/commit and rerun immediately before commit.

## Files and compatibility decisions

Task 2 files are exactly:

- `.superpowers/sdd/ADMIN_MAP_DISPATCH_BATCHING_IMPLEMENTATION/task-2-report.md`
- `apps/core/migrations/0043_delivery_batches_and_map_stops.sql`
- `apps/core/src/delivery/infrastructure/delivery-map-migration.integration.test.ts`
- `apps/core/src/test-setup.ts`

No separate Delivery schema mapping exists in the repository, so no runtime mapping was changed.
`rider_user_id` and stop `proof_json` remain compatibility/history columns; deletion or rewriting is
deferred until every historical caller/read has migrated. The historical Scheduled and timestamp
defaults remain so current compatibility inserts continue to work. Job location/zone and stop
coordinates may remain null only where legacy evidence cannot supply them; later Core reads and
commands must fail assignment closed for missing authoritative coordinates. The migration
backfills canonical Rider identities only for Staff identities already referenced by historical
delivery assignment. Rider provisioning and compatibility-command retirement belong to later
authorized tasks.

## Concerns and next-task reliance

- Existing compatibility assignment still writes `rider_user_id`; Tasks 3/5 must use canonical
  `rider_id` for the new map/atomic command and preserve the documented compatibility retirement
  boundary until old callers move.
- The current historical schema permits raw JSON without a database `json_valid` constraint. All
  application-produced and tested snapshots are valid JSON; production rollout should retain the
  normal migration preflight/backup discipline before applying any JSON-extracting backfill.
- No public contract or canonical-document update is needed in Task 2 because Task 1 already made
  the approved persistence/state/API rulings authoritative.

Tasks 3–5 may rely on canonical Rider/batch/job/stop/event/proof tables, manual stop order, mode and
cycle constraints, immutable destination snapshots, append-only events, optimistic versions, and
the active-context/Rider indexes. They may not rely on any runtime query, route provider, command,
or Web behavior from this task.

## Review fix round 1

All four review findings were confirmed with new pre-fix tests before implementation. The
full-chain migration fixture first failed while applying 0043 to schema-valid historical
`LEGACY_OPEN` / `MYSTERY` batch statuses. The Instant and Scheduled paid-commitment tests first
failed because the transaction created a delivery job without its required canonical stop; after
stop insertion was added, they remained red until authoritative location/zone context was also
written to the delivery job.

The migration is now rollout-safe for the complete requested pre-0043 input space: empty batches,
cycles without capacity, unbatched stops with sequences, batched stops without sequences,
duplicate stops for one job, duplicate/zero/negative sequences, and unconstrained batch/stop
statuses. It deterministically chooses one canonical stop per job and normalizes assigned
sequences, while `delivery_batch_compatibility_history` and
`delivery_stop_compatibility_history` retain every original row and the exact original status,
sequence, proof, Rider, version, timestamp, and snapshot bytes. Both history tables are indexed
and append-only. Empty or otherwise unresolvable historical batches use the constrained
`LEGACY_UNRESOLVED` + `EXCEPTION` path with null location/zone rather than an invented hub; newly
created resolved batches still require a valid location/context.

Canonical instruction snapshots now prefer structured `delivery_instructions_json` and fall back
deterministically to legacy pre-0042 `notes`. The source `address_snapshot_json` is copied
byte-for-byte. The full-chain test covers both paths. `rider_identity.staff_id` and
`auth_user_id` are nullable optional unique links; auth is deliberately not a lifecycle-owning
foreign key. Valid historical staff/auth links are backfilled, unmappable `rider_user_id` values
remain losslessly represented in compatibility history, and an application-owned Rider with
neither link is accepted.

The paid-order commitment transaction now allocates job and stop IDs before its D1 batch and
atomically inserts exactly one unbatched canonical stop immediately after every new Instant or
Scheduled delivery job. The stop snapshots coordinates, address, contact, and instructions; the
job receives the same authoritative fulfillment location/zone context. The existing rollback
test now also proves that a later transaction failure leaves neither job nor stop behind.

Review-fix verification:

- Focused migration and both paid-commitment suites: exit 0; 3 files, 8 tests.
- Full Core suite: exit 0; 95 files, 514 tests.
- The final format, naming, migration, lint, typecheck, Core build, and diff gates were rerun after
  this report was appended and before the separate fix commit.

No Task 3+ command, query, route, provider, contract, or UI work was added. A deliberately mixed
location/zone legacy batch remains outside the confirmed fixture set; 0043 deterministically uses
the first ranked stop context and retains every source row in compatibility history, so rollout
does not abort or erase the conflicting evidence. Later operational reads must continue to treat
legacy `EXCEPTION` work as non-assignable until explicitly reconciled.
