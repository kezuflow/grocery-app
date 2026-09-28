import type { MessageHub } from "../infrastructure/message-hub";

type Pending = { audience_key: string; revision: number };

/** Failed delivery remains in D1; HTTP reads remain authoritative. */
export async function publishMessageRevisions(
  database: D1Database,
  hubs: DurableObjectNamespace<MessageHub>,
  limit = 25,
): Promise<number> {
  const pending = await database
    .prepare(`SELECT audience_key,revision FROM order_message_revision
      WHERE published_revision<revision ORDER BY audience_key LIMIT ?`)
    .bind(limit)
    .all<Pending>();
  let published = 0;
  let failed = false;
  for (const row of pending.results) {
    try {
      await hubs.getByName(row.audience_key).publish(row.revision);
      await database
        .prepare(`UPDATE order_message_revision SET published_revision=?
          WHERE audience_key=? AND published_revision<? AND revision>=?`)
        .bind(row.revision, row.audience_key, row.revision, row.revision)
        .run();
      published += 1;
    } catch {
      failed = true;
    }
  }
  if (failed) throw new Error("Some message revisions remain unpublished");
  return published;
}
