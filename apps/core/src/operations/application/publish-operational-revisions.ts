import type { OperationalHub } from "../infrastructure/operational-hub";

type PendingRevision = { location_id: string; revision: number };

/** A failed publish remains pending in D1 and is retried by the minute job. */
export async function publishOperationalRevisions(
  database: D1Database,
  hubs: DurableObjectNamespace<OperationalHub>,
  limit = 25,
): Promise<number> {
  const pending = await database
    .prepare(
      `SELECT location_id, revision FROM operational_revision
       WHERE published_revision < revision ORDER BY location_id LIMIT ?`,
    )
    .bind(limit)
    .all<PendingRevision>();
  let published = 0;
  let failed = false;
  for (const row of pending.results) {
    try {
      await hubs.getByName(row.location_id).publish(row.revision);
      await database
        .prepare(
          `UPDATE operational_revision SET published_revision=?
           WHERE location_id=? AND published_revision<? AND revision>=?`,
        )
        .bind(row.revision, row.location_id, row.revision, row.revision)
        .run();
      published += 1;
    } catch {
      failed = true;
    }
  }
  if (failed) throw new Error("Some operational revisions remain unpublished");
  return published;
}
