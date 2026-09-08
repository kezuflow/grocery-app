import type { AdminProductMediaView, AppErrorCode, RpcResult } from "@freshmarkets/contracts";
import { adminProductMediaViewSchema, z } from "@freshmarkets/validation";
import { findIdempotencyRecord } from "../../idempotency";
import type { CatalogAdministrationAccess } from "./catalog-administration-access";

export const mediaFailure = (code: AppErrorCode, message: string, requestId: string) => ({
  ok: false as const,
  error: { code, message, requestId },
});
export const requireMediaEffect = (db: D1Database) =>
  db.prepare("INSERT INTO admin_command_abort(id) SELECT -1 WHERE changes()!=1");
export function mediaAuthorityGuard(db: D1Database, actor: CatalogAdministrationAccess) {
  return db
    .prepare(`INSERT INTO admin_command_abort(id) SELECT -1 WHERE NOT EXISTS (
    SELECT 1 FROM staff_identity s JOIN staff_scope sc ON sc.staff_id=s.id AND sc.scope_kind='global'
    JOIN staff_role sr ON sr.staff_id=s.id JOIN role_permission rp ON rp.role_id=sr.role_id JOIN permission p ON p.id=rp.permission_id
    WHERE s.id=? AND s.auth_user_id=? AND s.status='active' AND p.code='catalog.manage')`)
    .bind(actor.staffId, actor.authUserId);
}
const objectSchema = z.record(z.string(), z.unknown());
function object(raw: string | null) {
  return raw ? objectSchema.parse(JSON.parse(raw)) : {};
}
export async function mediaReceipt(
  db: D1Database,
  scope: string,
  key: string,
  hash: string,
  requestId: string,
): Promise<RpcResult<AdminProductMediaView> | null> {
  const record = await findIdempotencyRecord(db, scope, key);
  if (!record) return null;
  if (record.requestHash !== hash)
    return mediaFailure("IDEMPOTENCY_CONFLICT", "Key belongs to another media request", requestId);
  if (record.status !== "SUCCEEDED") return null;
  if (!record.resultReference)
    return mediaFailure("CONFLICT", "Saved media result needs recovery", requestId);
  try {
    if (record.resultReference.startsWith("{"))
      return {
        ok: true,
        requestId,
        value: adminProductMediaViewSchema.parse(JSON.parse(record.resultReference)),
      };
    // Historical receipts stored only an identity. Reconstruct the original result from
    // its immutable audit, never from later mutable captions or primary selection.
    const action = scope.endsWith(".upload")
      ? "CATALOG.PRODUCT_MEDIA_UPLOADED"
      : scope.endsWith(".update")
        ? "CATALOG.PRODUCT_MEDIA_UPDATED"
        : "CATALOG.PRODUCT_MEDIA_REMOVED";
    const audit = await db
      .prepare(
        "SELECT details_json,before_json,after_json FROM audit_event WHERE action=? AND aggregate_id=? AND idempotency_key=? ORDER BY occurred_at,id LIMIT 1",
      )
      .bind(action, record.resultReference, key)
      .first<{ details_json: string; before_json: string | null; after_json: string | null }>();
    if (!audit)
      return mediaFailure("CONFLICT", "Historical media result needs audit review", requestId);
    const mime = await db
      .prepare("SELECT mime_type FROM product_media WHERE id=?")
      .bind(record.resultReference)
      .first<{ mime_type: string }>();
    const value = adminProductMediaViewSchema.parse({
      mimeType: mime?.mime_type,
      ...object(audit.details_json),
      ...object(audit.before_json),
      ...object(audit.after_json),
      mediaId: record.resultReference,
    });
    return { ok: true, requestId, value };
  } catch {
    return mediaFailure("CONFLICT", "Saved media evidence needs recovery", requestId);
  }
}

export type MediaUpload = {
  id: string;
  product_id: string;
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
      "SELECT id,product_id,object_key,content_digest,status,lease_token,lease_expires_at,version FROM product_media_upload WHERE command_scope=? AND idempotency_key=?",
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
    if (
      !stored ||
      stored.customMetadata?.contentDigest !== upload.content_digest ||
      stored.size !== bytes.byteLength
    )
      return false;
    const claimed = await db
      .prepare(
        "UPDATE product_media_upload SET status='STORED',lease_token=NULL,lease_expires_at=NULL,version=version+1,updated_at=? WHERE id=? AND version=? AND status IN ('PENDING','UNKNOWN','STORED')",
      )
      .bind(now, upload.id, upload.version)
      .run();
    return claimed.meta.changes === 1;
  }
  const lease = crypto.randomUUID();
  const claimed = await db
    .prepare(
      "UPDATE product_media_upload SET lease_token=?,lease_expires_at=?,version=version+1,updated_at=? WHERE id=? AND version=? AND status='PENDING' AND lease_token IS NULL",
    )
    .bind(lease, now + 120000, now, upload.id, upload.version)
    .run();
  if (claimed.meta.changes !== 1) return false;
  let stored = false;
  try {
    const result = await bucket.put(upload.object_key, bytes, {
      onlyIf: { etagDoesNotMatch: "*" },
      sha256: upload.content_digest,
      httpMetadata: { contentType: mimeType },
      customMetadata: {
        productId: upload.product_id,
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
      "UPDATE product_media_upload SET status=?,lease_token=NULL,lease_expires_at=NULL,version=version+1,updated_at=? WHERE id=? AND lease_token=? AND status='PENDING'",
    )
    .bind(stored ? "STORED" : "UNKNOWN", Date.now(), upload.id, lease)
    .run();
  return stored && result.meta.changes === 1;
}

export function mediaCleanupIntent(
  db: D1Database,
  productId: string,
  objectKey: string,
  now: number,
) {
  return db
    .prepare(
      "INSERT INTO product_media_cleanup(id,product_id,object_key,status,available_at,created_at,updated_at) VALUES (?,?,?,'PENDING',?,?,?) ON CONFLICT(object_key) DO UPDATE SET status='PENDING',available_at=excluded.available_at,version=version+1,updated_at=excluded.updated_at",
    )
    .bind(crypto.randomUUID(), productId, objectKey, now, now, now);
}

/** Delete is idempotent. Metadata must already be inactive, and a live attachment blocks
 * every cleanup attempt. Exhaustion remains observable for explicit operator redrive. */
export async function cleanProductMedia(
  db: D1Database,
  bucket: R2Bucket,
  now = Date.now(),
  limit = 20,
): Promise<number> {
  const rows = await db
    .prepare(`SELECT id,object_key,version,attempt_count FROM product_media_cleanup
    WHERE (status='PENDING' AND available_at<=?) OR (status='PROCESSING' AND lease_expires_at<=?) ORDER BY available_at,id LIMIT ?`)
    .bind(now, now, Math.min(20, Math.max(1, limit)))
    .all<{ id: string; object_key: string; version: number; attempt_count: number }>();
  let completed = 0;
  for (const row of rows.results) {
    if (row.attempt_count >= 5) {
      await db
        .prepare(
          "UPDATE product_media_cleanup SET status='FAILED',last_error_code='CLEANUP_ATTEMPTS_EXHAUSTED',lease_token=NULL,lease_expires_at=NULL,version=version+1,updated_at=? WHERE id=? AND version=?",
        )
        .bind(now, row.id, row.version)
        .run();
      continue;
    }
    const lease = crypto.randomUUID();
    const claimed = await db
      .prepare(`UPDATE product_media_cleanup SET status='PROCESSING',lease_token=?,lease_expires_at=?,attempt_count=attempt_count+1,version=version+1,updated_at=?
      WHERE id=? AND version=? AND NOT EXISTS (SELECT 1 FROM product_media WHERE object_key=product_media_cleanup.object_key AND status='active')
        AND NOT EXISTS (SELECT 1 FROM product_media_upload WHERE object_key=product_media_cleanup.object_key AND status<>'ABANDONED' AND status<>'ATTACHED')`)
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
        "UPDATE product_media_cleanup SET status=?,available_at=?,last_error_code=?,lease_token=NULL,lease_expires_at=NULL,version=version+1,updated_at=? WHERE id=? AND lease_token=? AND status='PROCESSING'",
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
