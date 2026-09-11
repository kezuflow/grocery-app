import type { PromotionAdministrationAccess } from "./promotion-administration-access";
export const requireMediaEffect = (db: D1Database) =>
  db.prepare("INSERT INTO admin_command_abort(id) SELECT -1 WHERE changes()!=1");
export function mediaAuthorityGuard(db: D1Database, actor: PromotionAdministrationAccess) {
  return db
    .prepare(
      "INSERT INTO admin_command_abort(id) SELECT -1 WHERE NOT EXISTS(SELECT 1 FROM staff_identity s JOIN staff_scope sc ON sc.staff_id=s.id JOIN staff_role sr ON sr.staff_id=s.id JOIN role_permission rp ON rp.role_id=sr.role_id JOIN permission p ON p.id=rp.permission_id WHERE s.id=? AND s.auth_user_id=? AND s.status='active' AND sc.scope_kind='global' AND p.code='promotions.manage')",
    )
    .bind(actor.staffId, actor.authUserId);
}
export type MediaUpload = {
  id: string;
  banner_id: string;
  object_key: string;
  content_digest: string;
  status: "PENDING" | "UNKNOWN" | "STORED" | "ATTACHED" | "ABANDONED";
  lease_token: string | null;
  lease_expires_at: number | null;
  version: number;
};
export function readMediaUpload(db: D1Database, scope: string, key: string) {
  return db
    .prepare(
      "SELECT id,banner_id,object_key,content_digest,status,lease_token,lease_expires_at,version FROM banner_media_upload WHERE command_scope=? AND idempotency_key=?",
    )
    .bind(scope, key)
    .first<MediaUpload>();
}

/** One immutable object identity is recorded before storage. Unknown writes are observed,
 * never treated as absent merely because the original response was lost. */
export async function storeMediaUpload(
  db: D1Database,
  bucket: R2Bucket,
  upload: MediaUpload,
  bytes: ArrayBuffer,
  mimeType: string,
): Promise<boolean> {
  if (upload.status === "ATTACHED" || upload.status === "ABANDONED") return false;
  const now = Date.now();
  if (upload.lease_token && (upload.lease_expires_at ?? 0) > now) return false;
  if (upload.status === "STORED" || upload.status === "UNKNOWN" || upload.lease_token) {
    let stored: R2Object | null;
    try {
      stored = await bucket.head(upload.object_key);
    } catch {
      return false;
    }
    if (stored) {
      if (
        stored.customMetadata?.contentDigest !== upload.content_digest ||
        stored.size !== bytes.byteLength
      )
        return false;
      const claimed = await db
        .prepare(
          "UPDATE banner_media_upload SET status='STORED',lease_token=NULL,lease_expires_at=NULL,version=version+1,updated_at=? WHERE id=? AND version=? AND status IN ('PENDING','UNKNOWN','STORED')",
        )
        .bind(now, upload.id, upload.version)
        .run();
      return claimed.meta.changes === 1;
    }
    // An absent observation is not proof that the previous write failed. A retry
    // uses the same immutable bytes/key and an atomic create-only precondition.
  }
  const lease = crypto.randomUUID();
  const claimed = await db
    .prepare(
      "UPDATE banner_media_upload SET status='PENDING',lease_token=?,lease_expires_at=?,version=version+1,updated_at=? WHERE id=? AND version=? AND status IN ('PENDING','UNKNOWN','STORED') AND (lease_token IS NULL OR lease_expires_at<=?)",
    )
    .bind(lease, now + 120000, now, upload.id, upload.version, now)
    .run();
  if (claimed.meta.changes !== 1) return false;
  let stored = false;
  try {
    const result = await bucket.put(upload.object_key, bytes, {
      onlyIf: { etagDoesNotMatch: "*" },
      sha256: upload.content_digest,
      httpMetadata: { contentType: mimeType },
      customMetadata: {
        bannerId: upload.banner_id,
        mediaId: upload.id,
        contentDigest: upload.content_digest,
      },
    });
    stored = result !== null;
  } catch {
    // Persist uncertainty below; the next request observes the same generated object.
  }
  const result = await db
    .prepare(
      "UPDATE banner_media_upload SET status=?,lease_token=NULL,lease_expires_at=NULL,version=version+1,updated_at=? WHERE id=? AND lease_token=? AND status='PENDING'",
    )
    .bind(stored ? "STORED" : "UNKNOWN", Date.now(), upload.id, lease)
    .run();
  return stored && result.meta.changes === 1;
}

export function mediaCleanupIntent(
  db: D1Database,
  bannerId: string,
  objectKey: string,
  now: number,
) {
  return db
    .prepare(
      "INSERT INTO banner_media_cleanup(id,banner_id,object_key,status,available_at,created_at,updated_at) VALUES (?,?,?,'PENDING',?,?,?) ON CONFLICT(object_key) DO UPDATE SET status='PENDING',available_at=excluded.available_at,version=version+1,updated_at=excluded.updated_at",
    )
    .bind(crypto.randomUUID(), bannerId, objectKey, now, now, now);
}

/** Delete is idempotent. Metadata must already be inactive, and a live attachment blocks
 * every cleanup attempt. Exhaustion remains observable for internal diagnostics. */
export async function cleanBannerMedia(
  db: D1Database,
  bucket: R2Bucket,
  now = Date.now(),
  limit = 20,
): Promise<number> {
  const uncertain = await db
    .prepare(`SELECT id,object_key,content_digest,version FROM banner_media_upload
    WHERE status IN ('PENDING','UNKNOWN') AND updated_at<? AND (lease_token IS NULL OR lease_expires_at<=?)
    ORDER BY updated_at,id LIMIT 20`)
    .bind(now - 86400000, now)
    .all<{ id: string; object_key: string; content_digest: string; version: number }>();
  for (const upload of uncertain.results) {
    let confirmed = false;
    try {
      const object = await bucket.head(upload.object_key);
      confirmed = object?.customMetadata?.contentDigest === upload.content_digest;
    } catch {
      // Observation failure is not absence. Rotate bounded scans without retrying a write.
    }
    await db
      .prepare(`UPDATE banner_media_upload SET status=?,lease_token=NULL,lease_expires_at=NULL,version=version+1,updated_at=?
      WHERE id=? AND version=? AND status IN ('PENDING','UNKNOWN')`)
      .bind(confirmed ? "STORED" : "UNKNOWN", now, upload.id, upload.version)
      .run();
  }
  // A browser may leave after storage or lose permission before attachment.
  // Expire confirmed, unclaimed objects internally; uncertainty is retained for
  // observation instead of treating a missing response as permission to delete.
  const abandoned = await db
    .prepare(`SELECT id,banner_id,object_key,version FROM banner_media_upload
    WHERE status='STORED' AND lease_token IS NULL AND updated_at<? ORDER BY updated_at,id LIMIT 20`)
    .bind(now - 86400000)
    .all<{ id: string; banner_id: string; object_key: string; version: number }>();
  for (const upload of abandoned.results) {
    try {
      await db.batch([
        db
          .prepare(
            "UPDATE banner_media_upload SET status='ABANDONED',version=version+1,updated_at=? WHERE id=? AND version=? AND status='STORED' AND lease_token IS NULL",
          )
          .bind(now, upload.id, upload.version),
        requireMediaEffect(db),
        mediaCleanupIntent(db, upload.banner_id, upload.object_key, now),
        requireMediaEffect(db),
      ]);
    } catch {
      // A concurrent attachment wins or the entire expiration rolls back.
    }
  }
  const rows = await db
    .prepare(`SELECT id,object_key,version,attempt_count FROM banner_media_cleanup
    WHERE (status='PENDING' AND available_at<=?) OR (status='PROCESSING' AND lease_expires_at<=?) ORDER BY available_at,id LIMIT ?`)
    .bind(now, now, Math.min(20, Math.max(1, limit)))
    .all<{ id: string; object_key: string; version: number; attempt_count: number }>();
  let completed = 0;
  for (const row of rows.results) {
    if (row.attempt_count >= 5) {
      await db
        .prepare(
          "UPDATE banner_media_cleanup SET status='FAILED',last_error_code='CLEANUP_ATTEMPTS_EXHAUSTED',lease_token=NULL,lease_expires_at=NULL,version=version+1,updated_at=? WHERE id=? AND version=?",
        )
        .bind(now, row.id, row.version)
        .run();
      continue;
    }
    const lease = crypto.randomUUID();
    const claimed = await db
      .prepare(`UPDATE banner_media_cleanup SET status='PROCESSING',lease_token=?,lease_expires_at=?,attempt_count=attempt_count+1,version=version+1,updated_at=?
      WHERE id=? AND version=? AND NOT EXISTS (SELECT 1 FROM banner_media WHERE object_key=banner_media_cleanup.object_key AND status='active')
        AND NOT EXISTS (SELECT 1 FROM banner_media_upload WHERE object_key=banner_media_cleanup.object_key AND status<>'ABANDONED' AND status<>'ATTACHED')`)
      .bind(lease, now + 120000, now, row.id, row.version)
      .run();
    if (claimed.meta.changes !== 1) continue;
    let deleted = false;
    try {
      await bucket.delete(row.object_key);
      deleted = true;
    } catch {
      /* Persist bounded retry below. */
    }
    const attempt = row.attempt_count + 1;
    const updated = await db
      .prepare(
        "UPDATE banner_media_cleanup SET status=?,available_at=?,last_error_code=?,lease_token=NULL,lease_expires_at=NULL,version=version+1,updated_at=? WHERE id=? AND lease_token=? AND status='PROCESSING'",
      )
      .bind(
        deleted ? "SUCCEEDED" : attempt >= 5 ? "FAILED" : "PENDING",
        now + Math.min(3600000, 60000 * 2 ** attempt),
        deleted ? null : "R2_DELETE_UNCONFIRMED",
        now,
        row.id,
        lease,
      )
      .run();
    if (deleted && updated.meta.changes === 1) completed++;
  }
  return completed;
}
