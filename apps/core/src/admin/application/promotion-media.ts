import type {
  PromotionMediaView,
  PromotionMediaSelection,
  RpcResult,
} from "@freshmarkets/contracts";
import { promotionMediaMaxBytes } from "@freshmarkets/contracts";
import {
  authenticatedRequestSchema,
  identifierSchema,
  idempotencyKeySchema,
  promotionMediaUploadBodySchema,
  promotionMediaUpdateBodySchema,
  promotionMediaRemoveBodySchema,
  promotionMediaMimeSchema,
  promotionMediaViewSchema,
  z,
} from "@freshmarkets/validation";
import { requestHash } from "../../idempotency";
import { auditEventStatement } from "../../audit/application/append-audit-event";
import {
  resolvePromotionAdministrationAccess,
  type PromotionAdministrationDeps,
} from "./promotion-administration-access";
import {
  promotionCommandReceipt,
  executePromotionCommand,
  promotionCommandFailure as failure,
} from "./promotion-command-recovery";
import {
  requireMediaEffect as required,
  mediaAuthorityGuard,
  readMediaUpload,
  storeMediaUpload,
  mediaCleanupIntent,
} from "./promotion-media-storage";
export type PromotionMediaDeps = PromotionAdministrationDeps & { bucket: R2Bucket };
const meta = authenticatedRequestSchema.extend({
  promotionId: identifierSchema,
  idempotencyKey: idempotencyKeySchema,
});
const uploadSchema = meta
  .extend(promotionMediaUploadBodySchema.shape)
  .extend({ bytes: z.instanceof(ArrayBuffer), mimeType: promotionMediaMimeSchema });
const updateSchema = meta.extend(promotionMediaUpdateBodySchema.shape);
const removeSchema = meta.extend(promotionMediaRemoveBodySchema.shape);
function invalid(input: unknown) {
  return failure(
    "VALIDATION_FAILED",
    "Choose a valid image and complete its details",
    typeof input === "object" &&
      input !== null &&
      "requestId" in input &&
      typeof input.requestId === "string"
      ? input.requestId
      : "unknown",
  );
}
function matchesSignature(bytes: Uint8Array, mime: string) {
  if (mime === "image/jpeg")
    return bytes.length >= 3 && bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255;
  if (mime === "image/png")
    return (
      bytes.length >= 8 &&
      [137, 80, 78, 71, 13, 10, 26, 10].every((value, index) => bytes[index] === value)
    );
  return (
    mime === "image/webp" &&
    bytes.length >= 12 &&
    String.fromCharCode(...bytes.slice(0, 4)) === "RIFF" &&
    String.fromCharCode(...bytes.slice(8, 12)) === "WEBP"
  );
}
function currentGuard(
  db: D1Database,
  promotionId: string,
  expected: PromotionMediaSelection | null,
) {
  return expected
    ? db
        .prepare(
          "INSERT INTO admin_command_abort(id) SELECT -1 WHERE NOT EXISTS(SELECT 1 FROM promotion_media WHERE promotion_id=? AND id=? AND version=? AND status='active')",
        )
        .bind(promotionId, expected.mediaId, expected.version)
    : db
        .prepare(
          "INSERT INTO admin_command_abort(id) SELECT -1 WHERE EXISTS(SELECT 1 FROM promotion_media WHERE promotion_id=? AND status='active')",
        )
        .bind(promotionId);
}
function ownerGuard(db: D1Database, promotionId: string) {
  return db
    .prepare(
      "INSERT INTO admin_command_abort(id) SELECT -1 WHERE NOT EXISTS(SELECT 1 FROM promotion WHERE id=? AND status!='ARCHIVED')",
    )
    .bind(promotionId);
}
function receipt(
  db: D1Database,
  command: { scope: string; key: string; hash: string },
  value: PromotionMediaView,
) {
  return db
    .prepare(
      "UPDATE idempotency_records SET status='SUCCEEDED',result_reference=?,updated_at=? WHERE scope=? AND idempotency_key=? AND request_hash=? AND status='PROCESSING'",
    )
    .bind(JSON.stringify(value), Date.now(), command.scope, command.key, command.hash);
}
export async function uploadAdminPromotionMedia(
  deps: PromotionMediaDeps,
  input: unknown,
): Promise<RpcResult<PromotionMediaView>> {
  const parsed = uploadSchema.safeParse(input);
  if (!parsed.success) return invalid(input);
  const request = parsed.data;
  const access = await resolvePromotionAdministrationAccess(deps, request, "promotions.manage");
  if (!access.ok) return access;
  const bytes = new Uint8Array(request.bytes);
  if (
    !bytes.length ||
    bytes.length > promotionMediaMaxBytes ||
    !matchesSignature(bytes, request.mimeType)
  )
    return invalid(input);
  const contentDigest = [...new Uint8Array(await crypto.subtle.digest("SHA-256", request.bytes))]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
  const canonical = {
    promotionId: request.promotionId,
    expectedMedia: request.expectedMedia,
    altText: request.altText,
    mimeType: request.mimeType,
    byteSize: bytes.length,
    contentDigest,
  };
  const command = {
    scope: "admin.promotions.media.upload",
    key: request.idempotencyKey,
    hash: await requestHash(canonical),
    requestId: request.requestId,
  };
  const prior = await promotionCommandReceipt(deps.db, command, promotionMediaViewSchema);
  if (prior) return prior;
  const db = deps.db;
  const now = Date.now();
  let upload = await readMediaUpload(db, command.scope, command.key);
  if (!upload) {
    const id = crypto.randomUUID();
    try {
      await db.batch([
        mediaAuthorityGuard(db, access.value),
        ownerGuard(db, request.promotionId),
        currentGuard(db, request.promotionId, request.expectedMedia),
        db
          .prepare(
            "INSERT INTO idempotency_records(scope,idempotency_key,request_hash,result_type,status,created_at,updated_at) VALUES (?,?,?,?,'PROCESSING',?,?)",
          )
          .bind(command.scope, command.key, command.hash, command.scope, now, now),
        required(db),
        db
          .prepare(
            "INSERT INTO promotion_media_upload(id,promotion_id,object_key,command_scope,idempotency_key,request_json,content_digest,status,created_at,updated_at) VALUES (?,?,?,?,?,?,?,'PENDING',?,?)",
          )
          .bind(
            id,
            request.promotionId,
            `promotions/${request.promotionId}/${id}`,
            command.scope,
            command.key,
            JSON.stringify(canonical),
            contentDigest,
            now,
            now,
          ),
        required(db),
      ]);
    } catch {
      const result = await promotionCommandReceipt(db, command, promotionMediaViewSchema);
      if (result) return result;
    }
    upload = await readMediaUpload(db, command.scope, command.key);
    if (!upload)
      return failure(
        "CONFLICT",
        "Campaign image or access changed. Reload and try again.",
        request.requestId,
      );
  }
  const resumed = await promotionCommandReceipt(db, command, promotionMediaViewSchema);
  if (resumed) return resumed;
  if (upload.status === "ABANDONED")
    return failure(
      "MEDIA_UPLOAD_ABANDONED",
      "The campaign image changed. Choose the image again.",
      request.requestId,
    );
  if (!(await storeMediaUpload(db, deps.bucket, upload, request.bytes, request.mimeType)))
    return (
      (await promotionCommandReceipt(db, command, promotionMediaViewSchema)) ??
      failure("CONFLICT", "Image upload is not confirmed. Try again.", request.requestId)
    );
  const value: PromotionMediaView = {
    promotionId: request.promotionId,
    mediaId: upload.id,
    version: 1,
    altText: request.altText,
    mimeType: request.mimeType,
    status: "active",
  };
  try {
    const replaced = request.expectedMedia;
    await db.batch([
      mediaAuthorityGuard(db, access.value),
      ownerGuard(db, request.promotionId),
      currentGuard(db, request.promotionId, replaced),
      db
        .prepare(
          "INSERT INTO admin_command_abort(id) SELECT -1 WHERE NOT EXISTS(SELECT 1 FROM idempotency_records WHERE scope=? AND idempotency_key=? AND request_hash=? AND status='PROCESSING')",
        )
        .bind(command.scope, command.key, command.hash),
      db
        .prepare(
          "INSERT INTO admin_command_abort(id) SELECT -1 WHERE NOT EXISTS(SELECT 1 FROM promotion_media_upload WHERE id=? AND status='STORED' AND content_digest=?)",
        )
        .bind(upload.id, contentDigest),
      ...(replaced
        ? [
            db
              .prepare(
                "UPDATE promotion_media SET status='inactive',version=version+1,updated_at=? WHERE id=? AND promotion_id=? AND version=? AND status='active'",
              )
              .bind(now, replaced.mediaId, request.promotionId, replaced.version),
            required(db),
            db
              .prepare(
                "INSERT INTO promotion_media_cleanup(id,promotion_id,object_key,status,available_at,created_at,updated_at) SELECT ?,promotion_id,object_key,'PENDING',?,?,? FROM promotion_media WHERE id=? AND promotion_id=? AND status='inactive'",
              )
              .bind(crypto.randomUUID(), now, now, now, replaced.mediaId, request.promotionId),
            required(db),
          ]
        : []),
      db
        .prepare(
          "INSERT INTO promotion_media(id,promotion_id,object_key,mime_type,byte_size,content_digest,alt_text,status,version,created_at,updated_at) VALUES (?,?,?,?,?,?,?,'active',1,?,?)",
        )
        .bind(
          upload.id,
          request.promotionId,
          upload.object_key,
          request.mimeType,
          bytes.length,
          contentDigest,
          request.altText,
          now,
          now,
        ),
      required(db),
      db
        .prepare(
          "UPDATE promotion_media_upload SET status='ATTACHED',version=version+1,updated_at=? WHERE id=? AND status='STORED'",
        )
        .bind(now, upload.id),
      required(db),
      auditEventStatement(db, {
        actorUserId: access.value.authUserId,
        action: "PROMOTION.MEDIA_UPLOADED",
        resourceType: "promotion_media",
        resourceId: upload.id,
        details: {
          promotionId: request.promotionId,
          mimeType: request.mimeType,
          byteSize: bytes.length,
        },
        correlationId: request.requestId,
        idempotencyKey: command.key,
        occurredAt: now,
      }),
      required(db),
      receipt(db, command, value),
      required(db),
    ]);
  } catch {
    const saved = await promotionCommandReceipt(db, command, promotionMediaViewSchema);
    if (saved) return saved;
    const current = await db
      .prepare("SELECT id,version FROM promotion_media WHERE promotion_id=? AND status='active'")
      .bind(request.promotionId)
      .first<{ id: string; version: number }>();
    const unchanged = request.expectedMedia
      ? current?.id === request.expectedMedia.mediaId &&
        current.version === request.expectedMedia.version
      : current === null;
    if (!unchanged) {
      await db.batch([
        db
          .prepare(
            "INSERT INTO admin_command_abort(id) SELECT -1 WHERE EXISTS(SELECT 1 FROM promotion_media WHERE object_key=? AND status='active')",
          )
          .bind(upload.object_key),
        db
          .prepare(
            "UPDATE promotion_media_upload SET status='ABANDONED',version=version+1,updated_at=? WHERE id=? AND status='STORED' AND lease_token IS NULL",
          )
          .bind(Date.now(), upload.id),
        required(db),
        mediaCleanupIntent(db, request.promotionId, upload.object_key, Date.now()),
        required(db),
      ]);
      return failure(
        "MEDIA_UPLOAD_ABANDONED",
        "The campaign image changed. Choose the image again.",
        request.requestId,
      );
    }
    return failure("CONFLICT", "Image could not be confirmed. Try again.", request.requestId);
  }
  return { ok: true, value, requestId: request.requestId };
}
async function mutate(
  deps: PromotionMediaDeps,
  input: unknown,
  removing: boolean,
): Promise<RpcResult<PromotionMediaView>> {
  const parsed = removing ? removeSchema.safeParse(input) : updateSchema.safeParse(input);
  if (!parsed.success) return invalid(input);
  const request = parsed.data;
  const access = await resolvePromotionAdministrationAccess(deps, request, "promotions.manage");
  if (!access.ok) return access;
  const edited = updateSchema.safeParse(request);
  const command = {
    scope: `admin.promotions.media.${removing ? "remove" : "update"}`,
    key: request.idempotencyKey,
    requestId: request.requestId,
    hash: await requestHash({
      promotionId: request.promotionId,
      mediaId: request.mediaId,
      expectedVersion: request.expectedVersion,
      ...(!removing && edited.success ? { altText: edited.data.altText } : {}),
    }),
  };
  const saved = await promotionCommandReceipt(deps.db, command, promotionMediaViewSchema);
  if (saved) return saved;
  const db = deps.db;
  const row = await db
    .prepare(
      "SELECT promotion_id AS promotionId,id AS mediaId,version,alt_text AS altText,mime_type AS mimeType,status,object_key FROM promotion_media WHERE id=? AND promotion_id=? AND status='active'",
    )
    .bind(request.mediaId, request.promotionId)
    .first<PromotionMediaView & { object_key: string }>();
  if (!row) return failure("NOT_FOUND", "Campaign image not found", request.requestId);
  if (row.version !== request.expectedVersion)
    return failure(
      "STALE_VERSION",
      "Campaign image changed. Reload before saving.",
      request.requestId,
    );
  const now = Date.now();
  const value: PromotionMediaView = {
    promotionId: row.promotionId,
    mediaId: row.mediaId,
    version: row.version + 1,
    altText: !removing && edited.success ? edited.data.altText : row.altText,
    mimeType: row.mimeType,
    status: removing ? "inactive" : "active",
  };
  const action = removing ? "PROMOTION.MEDIA_REMOVED" : "PROMOTION.MEDIA_UPDATED";
  return executePromotionCommand(
    db,
    command,
    access.value,
    action,
    [
      ownerGuard(db, request.promotionId),
      db
        .prepare(
          "UPDATE promotion_media SET alt_text=?,status=?,version=version+1,updated_at=? WHERE id=? AND promotion_id=? AND version=? AND status='active'",
        )
        .bind(
          value.altText,
          value.status,
          now,
          row.mediaId,
          row.promotionId,
          request.expectedVersion,
        ),
      required(db),
      ...(removing
        ? [mediaCleanupIntent(db, row.promotionId, row.object_key, now), required(db)]
        : []),
      auditEventStatement(db, {
        actorUserId: access.value.authUserId,
        action,
        resourceType: "promotion_media",
        resourceId: row.mediaId,
        details: { promotionId: row.promotionId },
        correlationId: request.requestId,
        idempotencyKey: command.key,
        occurredAt: now,
      }),
      required(db),
    ],
    receipt(db, command, value),
    promotionMediaViewSchema,
  );
}
export const updateAdminPromotionMedia = (deps: PromotionMediaDeps, input: unknown) =>
  mutate(deps, input, false);
export const removeAdminPromotionMedia = (deps: PromotionMediaDeps, input: unknown) =>
  mutate(deps, input, true);
