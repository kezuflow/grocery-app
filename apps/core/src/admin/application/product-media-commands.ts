import {
  adminProductMediaMaxBytes,
  adminProductMediaMimeTypes,
  type AdminProductMediaUploadRequest,
  type AdminProductMediaUpdateRequest,
  type AdminProductMediaRemoveRequest,
  type AdminProductMediaView,
  type RpcResult,
} from "@freshmarkets/contracts";
import {
  z,
  authenticatedRequestSchema,
  identifierSchema,
  idempotencyKeySchema,
} from "@freshmarkets/validation";
import { requestHash, findIdempotencyRecord } from "../../idempotency";
import { auditEventStatement } from "../../audit/application/append-audit-event";
import { resolveCatalogAdministrationAccess } from "./catalog-administration-access";
import type { ProductMediaDeps } from "./product-media";
import {
  mediaFailure as failure,
  requireMediaEffect as required,
  mediaAuthorityGuard,
  mediaReceipt,
  readMediaUpload,
  storeMediaUpload,
  mediaCleanupIntent,
  type MediaUpload,
} from "./product-media-recovery";

const UPLOAD = "admin.catalog.product-media.upload",
  UPDATE = "admin.catalog.product-media.update",
  REMOVE = "admin.catalog.product-media.remove";
const base = authenticatedRequestSchema.extend({
  productId: identifierSchema,
  expectedProductVersion: z.number().int().safe().positive(),
  idempotencyKey: idempotencyKeySchema,
});
const metadata = {
  altText: z.string().trim().min(1).max(300),
  isPrimary: z.boolean(),
  sortOrder: z.number().int().safe().min(0).max(10000),
};
const uploadSchema = base.extend({
  ...metadata,
  bytes: z.instanceof(ArrayBuffer),
  mimeType: z.enum(adminProductMediaMimeTypes),
});
const updateSchema = base.extend({ ...metadata, mediaId: identifierSchema });
const removeSchema = base.extend({ mediaId: identifierSchema });
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
async function productVersion(db: D1Database, id: string) {
  return (
    (
      await db
        .prepare("SELECT version FROM product WHERE id=?")
        .bind(id)
        .first<{ version: number }>()
    )?.version ?? null
  );
}
function complete(
  db: D1Database,
  scope: string,
  key: string,
  hash: string,
  value: AdminProductMediaView,
  now: number,
) {
  return db
    .prepare(
      "UPDATE idempotency_records SET status='SUCCEEDED',result_reference=?,updated_at=? WHERE scope=? AND idempotency_key=? AND request_hash=? AND status='PROCESSING'",
    )
    .bind(JSON.stringify(value), now, scope, key, hash);
}
function claim(db: D1Database, scope: string, key: string, hash: string, now: number) {
  return db
    .prepare(
      "INSERT INTO idempotency_records(scope,idempotency_key,request_hash,result_type,status,created_at,updated_at) VALUES (?,?,?,?,'PROCESSING',?,?)",
    )
    .bind(scope, key, hash, scope, now, now);
}
async function abandon(deps: ProductMediaDeps, upload: MediaUpload) {
  const now = Date.now();
  await deps.db.batch([
    deps.db
      .prepare(
        "INSERT INTO admin_command_abort(id) SELECT -1 WHERE EXISTS (SELECT 1 FROM product_media WHERE object_key=? AND status='active')",
      )
      .bind(upload.object_key),
    deps.db
      .prepare(
        "UPDATE product_media_upload SET status='ABANDONED',lease_token=NULL,lease_expires_at=NULL,version=version+1,updated_at=? WHERE id=? AND status IN ('STORED','UNKNOWN') AND lease_token IS NULL",
      )
      .bind(now, upload.id),
    required(deps.db),
    mediaCleanupIntent(deps.db, upload.product_id, upload.object_key, now),
    required(deps.db),
  ]);
}

export async function uploadAdminProductMedia(
  deps: ProductMediaDeps,
  input: AdminProductMediaUploadRequest,
): Promise<RpcResult<AdminProductMediaView>> {
  const parsed = uploadSchema.safeParse(input);
  if (!parsed.success)
    return failure(
      "VALIDATION_FAILED",
      "Check the image, metadata and product version",
      input.requestId,
    );
  const request = parsed.data,
    access = await resolveCatalogAdministrationAccess(deps, request, "catalog.manage");
  if (!access.ok) return access;
  const bytes = new Uint8Array(request.bytes);
  if (
    !bytes.length ||
    bytes.length > adminProductMediaMaxBytes ||
    !matchesSignature(bytes, request.mimeType)
  )
    return failure(
      "VALIDATION_FAILED",
      "A valid JPEG, PNG or WebP image up to 5 MiB is required",
      request.requestId,
    );
  const contentDigest = [...new Uint8Array(await crypto.subtle.digest("SHA-256", request.bytes))]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
  const canonical = {
    productId: request.productId,
    contentDigest,
    byteSize: bytes.length,
    mimeType: request.mimeType,
    altText: request.altText,
    isPrimary: request.isPrimary,
    sortOrder: request.sortOrder,
    expectedProductVersion: request.expectedProductVersion,
  };
  const hash = await requestHash(canonical),
    now = Date.now();
  const prior = await mediaReceipt(
    deps.db,
    UPLOAD,
    request.idempotencyKey,
    hash,
    request.requestId,
  );
  if (prior) return prior;
  let upload = await readMediaUpload(deps.db, UPLOAD, request.idempotencyKey);
  if (!upload) {
    if (await findIdempotencyRecord(deps.db, UPLOAD, request.idempotencyKey))
      return failure(
        "CONFLICT",
        "Historical unfinished upload requires recovery review",
        request.requestId,
      );
    const version = await productVersion(deps.db, request.productId);
    if (version === null) return failure("NOT_FOUND", "Product not found", request.requestId);
    if (version !== request.expectedProductVersion)
      return failure(
        "STALE_VERSION",
        "Product changed; refresh before uploading",
        request.requestId,
      );
    const id = crypto.randomUUID();
    try {
      await deps.db.batch([
        mediaAuthorityGuard(deps.db, access.value),
        deps.db
          .prepare(
            "INSERT INTO admin_command_abort(id) SELECT -1 WHERE NOT EXISTS (SELECT 1 FROM product WHERE id=? AND version=?)",
          )
          .bind(request.productId, request.expectedProductVersion),
        claim(deps.db, UPLOAD, request.idempotencyKey, hash, now),
        required(deps.db),
        deps.db
          .prepare(
            "INSERT INTO product_media_upload(id,product_id,object_key,command_scope,idempotency_key,request_json,content_digest,status,created_at,updated_at) VALUES (?,?,?,?,?,?,?,'PENDING',?,?)",
          )
          .bind(
            id,
            request.productId,
            `products/${request.productId}/${id}`,
            UPLOAD,
            request.idempotencyKey,
            JSON.stringify(canonical),
            contentDigest,
            now,
            now,
          ),
        required(deps.db),
      ]);
    } catch {
      const receipt = await mediaReceipt(
        deps.db,
        UPLOAD,
        request.idempotencyKey,
        hash,
        request.requestId,
      );
      if (receipt) return receipt;
    }
    upload = await readMediaUpload(deps.db, UPLOAD, request.idempotencyKey);
    if (!upload)
      return failure(
        "CONFLICT",
        "Product or access changed before upload; refresh and retry",
        request.requestId,
      );
  }
  const resumedReceipt = await mediaReceipt(
    deps.db,
    UPLOAD,
    request.idempotencyKey,
    hash,
    request.requestId,
  );
  if (resumedReceipt) return resumedReceipt;
  if (upload.status === "ABANDONED")
    return failure(
      "MEDIA_UPLOAD_ABANDONED",
      "This upload was abandoned; review the product and start a new upload",
      request.requestId,
    );
  if (!(await storeMediaUpload(deps.db, deps.bucket, upload, request.bytes, request.mimeType)))
    return (
      (await mediaReceipt(deps.db, UPLOAD, request.idempotencyKey, hash, request.requestId)) ??
      failure(
        "CONFLICT",
        "Upload outcome is not confirmed. Retry the same request to recover its stored object",
        request.requestId,
      )
    );
  const value: AdminProductMediaView = {
    mediaId: upload.id,
    mimeType: request.mimeType,
    altText: request.altText,
    isPrimary: request.isPrimary,
    sortOrder: request.sortOrder,
    status: "active",
    version: 1,
  };
  try {
    await deps.db.batch([
      mediaAuthorityGuard(deps.db, access.value),
      deps.db
        .prepare(
          "INSERT INTO admin_command_abort(id) SELECT -1 WHERE NOT EXISTS (SELECT 1 FROM idempotency_records WHERE scope=? AND idempotency_key=? AND request_hash=? AND status='PROCESSING')",
        )
        .bind(UPLOAD, request.idempotencyKey, hash),
      deps.db
        .prepare(
          "INSERT INTO admin_command_abort(id) SELECT -1 WHERE NOT EXISTS (SELECT 1 FROM product_media_upload WHERE id=? AND product_id=? AND content_digest=? AND status='STORED')",
        )
        .bind(upload.id, request.productId, contentDigest),
      deps.db
        .prepare("UPDATE product SET version=version+1,updated_at=? WHERE id=? AND version=?")
        .bind(now, request.productId, request.expectedProductVersion),
      required(deps.db),
      ...(request.isPrimary
        ? [
            deps.db
              .prepare(
                "UPDATE product_media SET is_primary=0,version=version+1,updated_at=? WHERE product_id=? AND is_primary=1 AND status='active'",
              )
              .bind(now, request.productId),
          ]
        : []),
      deps.db
        .prepare(
          "INSERT INTO product_media(id,product_id,object_key,mime_type,byte_size,alt_text,is_primary,sort_order,status,version,created_at,updated_at,content_digest) VALUES (?,?,?,?,?,?,?,?,'active',1,?,?,?)",
        )
        .bind(
          upload.id,
          request.productId,
          upload.object_key,
          request.mimeType,
          bytes.length,
          request.altText,
          request.isPrimary ? 1 : 0,
          request.sortOrder,
          now,
          now,
          contentDigest,
        ),
      required(deps.db),
      deps.db
        .prepare(
          "UPDATE product_media_upload SET status='ATTACHED',version=version+1,updated_at=? WHERE id=? AND status='STORED'",
        )
        .bind(now, upload.id),
      required(deps.db),
      auditEventStatement(deps.db, {
        actorUserId: access.value.authUserId,
        action: "CATALOG.PRODUCT_MEDIA_UPLOADED",
        resourceType: "product_media",
        resourceId: upload.id,
        details: { ...canonical, contentDigest: undefined },
        after: value,
        correlationId: request.requestId,
        idempotencyKey: request.idempotencyKey,
        occurredAt: now,
      }),
      required(deps.db),
      complete(deps.db, UPLOAD, request.idempotencyKey, hash, value, now),
      required(deps.db),
    ]);
  } catch {
    const receipt = await mediaReceipt(
      deps.db,
      UPLOAD,
      request.idempotencyKey,
      hash,
      request.requestId,
    );
    if (receipt) return receipt;
    // Never delete on an ambiguous batch response. A published association blocks compensation.
    if ((await productVersion(deps.db, request.productId)) !== request.expectedProductVersion) {
      const current = await readMediaUpload(deps.db, UPLOAD, request.idempotencyKey);
      if (current?.status === "STORED") await abandon(deps, current);
    }
    return failure(
      "CONFLICT",
      "Media attachment was not confirmed; retry the same request or review product changes",
      request.requestId,
    );
  }
  return { ok: true, requestId: request.requestId, value };
}

type StoredMedia = AdminProductMediaView & { objectKey: string };
async function mutateMedia(
  deps: ProductMediaDeps,
  input: AdminProductMediaUpdateRequest | AdminProductMediaRemoveRequest,
  removing: boolean,
): Promise<RpcResult<AdminProductMediaView>> {
  const parsed = removing ? removeSchema.safeParse(input) : updateSchema.safeParse(input);
  if (!parsed.success)
    return failure(
      "VALIDATION_FAILED",
      "Check media metadata and product version",
      input.requestId,
    );
  const request = parsed.data,
    access = await resolveCatalogAdministrationAccess(deps, request, "catalog.manage");
  if (!access.ok) return access;
  const edited = updateSchema.safeParse(request);
  const scope = removing ? REMOVE : UPDATE;
  const canonical = removing
    ? {
        productId: request.productId,
        mediaId: request.mediaId,
        expectedProductVersion: request.expectedProductVersion,
      }
    : edited.success
      ? {
          productId: request.productId,
          mediaId: request.mediaId,
          altText: edited.data.altText,
          isPrimary: edited.data.isPrimary,
          sortOrder: edited.data.sortOrder,
          expectedProductVersion: request.expectedProductVersion,
        }
      : null;
  if (!canonical) return failure("VALIDATION_FAILED", "Check media metadata", request.requestId);
  const hash = await requestHash(canonical),
    now = Date.now();
  const prior = await mediaReceipt(deps.db, scope, request.idempotencyKey, hash, request.requestId);
  if (prior) return prior;
  const previousClaim = await findIdempotencyRecord(deps.db, scope, request.idempotencyKey);
  if (previousClaim?.status === "PROCESSING")
    return failure(
      "CONFLICT",
      "Historical unfinished media command requires audit review",
      request.requestId,
    );
  const row = await deps.db
    .prepare(
      "SELECT id mediaId,object_key objectKey,mime_type mimeType,alt_text altText,is_primary isPrimary,sort_order sortOrder,status,version FROM product_media WHERE product_id=? AND id=?",
    )
    .bind(request.productId, request.mediaId)
    .first<Omit<StoredMedia, "isPrimary"> & { isPrimary: number }>();
  if (!row) return failure("NOT_FOUND", "Product media not found", request.requestId);
  if (row.status !== "active")
    return failure("VALIDATION_FAILED", "Product media is inactive", request.requestId);
  if ((await productVersion(deps.db, request.productId)) !== request.expectedProductVersion)
    return failure("STALE_VERSION", "Product changed; refresh before retrying", request.requestId);
  const value: AdminProductMediaView = {
    mediaId: row.mediaId,
    mimeType: row.mimeType,
    altText: !removing && edited.success ? edited.data.altText : row.altText,
    isPrimary: !removing && edited.success ? edited.data.isPrimary : false,
    sortOrder: !removing && edited.success ? edited.data.sortOrder : row.sortOrder,
    status: removing ? "inactive" : "active",
    version: row.version + 1,
  };
  try {
    await deps.db.batch([
      mediaAuthorityGuard(deps.db, access.value),
      ...(previousClaim?.status === "FAILED"
        ? [
            deps.db
              .prepare(
                "DELETE FROM idempotency_records WHERE scope=? AND idempotency_key=? AND request_hash=? AND status='FAILED'",
              )
              .bind(scope, request.idempotencyKey, hash),
            required(deps.db),
          ]
        : []),
      claim(deps.db, scope, request.idempotencyKey, hash, now),
      required(deps.db),
      deps.db
        .prepare("UPDATE product SET version=version+1,updated_at=? WHERE id=? AND version=?")
        .bind(now, request.productId, request.expectedProductVersion),
      required(deps.db),
      ...(value.isPrimary
        ? [
            deps.db
              .prepare(
                "UPDATE product_media SET is_primary=0,version=version+1,updated_at=? WHERE product_id=? AND id<>? AND status='active' AND is_primary=1",
              )
              .bind(now, request.productId, request.mediaId),
          ]
        : []),
      deps.db
        .prepare(
          "UPDATE product_media SET alt_text=?,is_primary=?,sort_order=?,status=?,version=version+1,updated_at=? WHERE id=? AND product_id=? AND version=? AND status='active'",
        )
        .bind(
          value.altText,
          value.isPrimary ? 1 : 0,
          value.sortOrder,
          value.status,
          now,
          request.mediaId,
          request.productId,
          row.version,
        ),
      required(deps.db),
      ...(removing
        ? [mediaCleanupIntent(deps.db, request.productId, row.objectKey, now), required(deps.db)]
        : []),
      auditEventStatement(deps.db, {
        actorUserId: access.value.authUserId,
        action: removing ? "CATALOG.PRODUCT_MEDIA_REMOVED" : "CATALOG.PRODUCT_MEDIA_UPDATED",
        resourceType: "product_media",
        resourceId: request.mediaId,
        before: { ...row, objectKey: undefined, isPrimary: row.isPrimary === 1 },
        after: value,
        correlationId: request.requestId,
        idempotencyKey: request.idempotencyKey,
        occurredAt: now,
      }),
      required(deps.db),
      complete(deps.db, scope, request.idempotencyKey, hash, value, now),
      required(deps.db),
    ]);
  } catch {
    return (
      (await mediaReceipt(deps.db, scope, request.idempotencyKey, hash, request.requestId)) ??
      failure("CONFLICT", "Product, media or access changed; refresh and review", request.requestId)
    );
  }
  return { ok: true, requestId: request.requestId, value };
}
export function updateAdminProductMedia(
  deps: ProductMediaDeps,
  request: AdminProductMediaUpdateRequest,
) {
  return mutateMedia(deps, request, false);
}
export function removeAdminProductMedia(
  deps: ProductMediaDeps,
  request: AdminProductMediaRemoveRequest,
) {
  return mutateMedia(deps, request, true);
}
