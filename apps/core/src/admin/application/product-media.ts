import {
  adminProductMediaMaxBytes,
  adminProductMediaMimeTypes,
  type AdminProductMediaRemoveRequest,
  type AdminProductMediaUpdateRequest,
  type AdminProductMediaUploadRequest,
  type AdminProductMediaView,
  type AppErrorCode,
  type RpcResult,
} from "@freshmarkets/contracts";
import { auditEventStatement } from "../../audit/application/append-audit-event";
import { claimCommandIdempotency } from "../../idempotency";
import { log } from "../../observability";
import {
  resolveCatalogAdministrationAccess,
  type CatalogAdministrationDeps,
} from "./catalog-administration-access";

export type ProductMediaDeps = CatalogAdministrationDeps & { bucket: R2Bucket };

const UPLOAD_SCOPE = "admin.catalog.product-media.upload";
const UPDATE_SCOPE = "admin.catalog.product-media.update";
const REMOVE_SCOPE = "admin.catalog.product-media.remove";

function failure(code: AppErrorCode, message: string, requestId: string) {
  return { ok: false as const, error: { code, message, requestId } };
}

function idempotencyComplete(
  database: D1Database,
  scope: string,
  key: string,
  reference: string,
  now: number,
): D1PreparedStatement {
  return database
    .prepare(
      "UPDATE idempotency_records SET status='SUCCEEDED', result_reference=?, updated_at=? WHERE scope=? AND idempotency_key=? AND status='PROCESSING'",
    )
    .bind(reference, now, scope, key);
}

function idempotencyFailed(database: D1Database, scope: string, key: string): Promise<unknown> {
  return database
    .prepare(
      "UPDATE idempotency_records SET status='FAILED', updated_at=? WHERE scope=? AND idempotency_key=? AND status='PROCESSING'",
    )
    .bind(Date.now(), scope, key)
    .run();
}

async function readMedia(
  database: D1Database,
  productId: string,
  mediaId: string,
  requestId: string,
): Promise<RpcResult<AdminProductMediaView>> {
  const row = await database
    .prepare(
      `SELECT id AS mediaId, mime_type AS mimeType, alt_text AS altText,
              is_primary AS isPrimary, sort_order AS sortOrder, status, version
       FROM product_media WHERE id=? AND product_id=?`,
    )
    .bind(mediaId, productId)
    .first<Omit<AdminProductMediaView, "isPrimary"> & { isPrimary: number }>();
  return row
    ? { ok: true, value: { ...row, isPrimary: row.isPrimary === 1 }, requestId }
    : failure("NOT_FOUND", "Product media not found", requestId);
}

function validMetadata(altText: string, sortOrder: number): boolean {
  return (
    altText.length > 0 &&
    altText.length <= 300 &&
    Number.isSafeInteger(sortOrder) &&
    sortOrder >= 0 &&
    sortOrder <= 10_000
  );
}

function matchesSignature(bytes: Uint8Array, mimeType: string): boolean {
  if (mimeType === "image/jpeg")
    return bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  if (mimeType === "image/png")
    return (
      bytes.length >= 8 &&
      bytes[0] === 0x89 &&
      bytes[1] === 0x50 &&
      bytes[2] === 0x4e &&
      bytes[3] === 0x47 &&
      bytes[4] === 0x0d &&
      bytes[5] === 0x0a &&
      bytes[6] === 0x1a &&
      bytes[7] === 0x0a
    );
  return (
    mimeType === "image/webp" &&
    bytes.length >= 12 &&
    String.fromCharCode(...bytes.slice(0, 4)) === "RIFF" &&
    String.fromCharCode(...bytes.slice(8, 12)) === "WEBP"
  );
}

async function sha256(bytes: ArrayBuffer): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function productVersion(database: D1Database, productId: string): Promise<number | null> {
  const product = await database
    .prepare("SELECT version FROM product WHERE id=?")
    .bind(productId)
    .first<{ version: number }>();
  return product?.version ?? null;
}

/** Store validated image bytes, then attach authoritative metadata under a guarded Product write. */
export async function uploadAdminProductMedia(
  deps: ProductMediaDeps,
  request: AdminProductMediaUploadRequest,
): Promise<RpcResult<AdminProductMediaView>> {
  const access = await resolveCatalogAdministrationAccess(deps, request, "catalog.manage");
  if (!access.ok) return access;
  const altText = request.altText.trim();
  const bytes = new Uint8Array(request.bytes);
  if (
    !adminProductMediaMimeTypes.includes(request.mimeType) ||
    bytes.byteLength === 0 ||
    bytes.byteLength > adminProductMediaMaxBytes ||
    !matchesSignature(bytes, request.mimeType) ||
    !validMetadata(altText, request.sortOrder)
  ) {
    return failure(
      "VALIDATION_FAILED",
      "A valid JPEG, PNG, or WebP image up to 5 MiB, alt text, and sort order are required",
      request.requestId,
    );
  }
  const contentDigest = await sha256(request.bytes);
  const now = Date.now();
  const canonical = {
    productId: request.productId,
    contentDigest,
    byteSize: bytes.byteLength,
    mimeType: request.mimeType,
    altText,
    isPrimary: request.isPrimary,
    sortOrder: request.sortOrder,
    expectedProductVersion: request.expectedProductVersion,
  };
  const claim = await claimCommandIdempotency(
    deps.db,
    () => now,
    UPLOAD_SCOPE,
    request.idempotencyKey,
    canonical,
  );
  if (!claim.claimed) {
    if (claim.existing && claim.existing.requestHash !== claim.hash)
      return failure(
        "IDEMPOTENCY_CONFLICT",
        "Idempotency key was used with a different request",
        request.requestId,
      );
    if (claim.existing?.status === "SUCCEEDED" && claim.existing.resultReference) {
      const replay = await readMedia(
        deps.db,
        request.productId,
        claim.existing.resultReference,
        request.requestId,
      );
      if (!replay.ok) {
        await deps.bucket.delete(`products/${request.productId}/${claim.existing.resultReference}`);
      }
      return replay;
    }
    return failure("CONFLICT", "The media upload is still processing", request.requestId);
  }
  const version = await productVersion(deps.db, request.productId);
  if (version === null) {
    await idempotencyFailed(deps.db, UPLOAD_SCOPE, request.idempotencyKey);
    return failure("NOT_FOUND", "Product not found", request.requestId);
  }
  if (version !== request.expectedProductVersion) {
    await idempotencyFailed(deps.db, UPLOAD_SCOPE, request.idempotencyKey);
    return failure("STALE_VERSION", "Product changed; refresh before retrying", request.requestId);
  }
  const mediaId = crypto.randomUUID();
  const objectKey = `products/${request.productId}/${mediaId}`;
  try {
    const stored = await deps.bucket.put(objectKey, request.bytes, {
      httpMetadata: { contentType: request.mimeType },
      customMetadata: { productId: request.productId, mediaId, contentDigest },
    });
    if (!stored) throw new Error("R2 put precondition did not store the object");
    await deps.db.batch([
      deps.db
        .prepare("UPDATE product SET version=version+1, updated_at=? WHERE id=? AND version=?")
        .bind(now, request.productId, request.expectedProductVersion),
      deps.db.prepare("INSERT INTO admin_command_abort (id) SELECT -1 WHERE changes()=0"),
      ...(request.isPrimary
        ? [
            deps.db
              .prepare(
                "UPDATE product_media SET is_primary=0, version=version+1, updated_at=? WHERE product_id=? AND status='active' AND is_primary=1",
              )
              .bind(now, request.productId),
          ]
        : []),
      deps.db
        .prepare(
          `INSERT INTO product_media
             (id, product_id, object_key, mime_type, byte_size, alt_text, is_primary,
              sort_order, status, version, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'active', 1, ?, ?)`,
        )
        .bind(
          mediaId,
          request.productId,
          objectKey,
          request.mimeType,
          bytes.byteLength,
          altText,
          request.isPrimary ? 1 : 0,
          request.sortOrder,
          now,
          now,
        ),
      auditEventStatement(deps.db, {
        actorUserId: access.value.authUserId,
        action: "CATALOG.PRODUCT_MEDIA_UPLOADED",
        resourceType: "product_media",
        resourceId: mediaId,
        details: { ...canonical, contentDigest: undefined },
        after: { status: "active", version: 1 },
        correlationId: request.requestId,
        idempotencyKey: request.idempotencyKey,
        occurredAt: now,
      }),
      idempotencyComplete(deps.db, UPLOAD_SCOPE, request.idempotencyKey, mediaId, now),
    ]);
  } catch (error) {
    await deps.bucket.delete(objectKey).catch(() => undefined);
    await idempotencyFailed(deps.db, UPLOAD_SCOPE, request.idempotencyKey);
    log("error", "admin.catalog.product_media_upload_failed", {
      productId: request.productId,
      mediaId,
      message: error instanceof Error ? error.message : String(error),
    });
    return failure("CONFLICT", "Product media could not be attached", request.requestId);
  }
  return readMedia(deps.db, request.productId, mediaId, request.requestId);
}

/** Update display metadata and primary selection under the Product aggregate version. */
export async function updateAdminProductMedia(
  deps: ProductMediaDeps,
  request: AdminProductMediaUpdateRequest,
): Promise<RpcResult<AdminProductMediaView>> {
  const access = await resolveCatalogAdministrationAccess(deps, request, "catalog.manage");
  if (!access.ok) return access;
  const altText = request.altText.trim();
  if (!validMetadata(altText, request.sortOrder))
    return failure(
      "VALIDATION_FAILED",
      "Valid alt text and sort order are required",
      request.requestId,
    );
  const now = Date.now();
  const canonical = {
    productId: request.productId,
    mediaId: request.mediaId,
    altText,
    isPrimary: request.isPrimary,
    sortOrder: request.sortOrder,
    expectedProductVersion: request.expectedProductVersion,
  };
  const claim = await claimCommandIdempotency(
    deps.db,
    () => now,
    UPDATE_SCOPE,
    request.idempotencyKey,
    canonical,
  );
  if (!claim.claimed) {
    if (claim.existing && claim.existing.requestHash !== claim.hash)
      return failure(
        "IDEMPOTENCY_CONFLICT",
        "Idempotency key was used with a different request",
        request.requestId,
      );
    if (claim.existing?.status === "SUCCEEDED")
      return readMedia(deps.db, request.productId, request.mediaId, request.requestId);
    return failure("CONFLICT", "The media update is still processing", request.requestId);
  }
  const [version, current] = await Promise.all([
    productVersion(deps.db, request.productId),
    deps.db
      .prepare(
        "SELECT alt_text AS altText, is_primary AS isPrimary, sort_order AS sortOrder, status, version FROM product_media WHERE id=? AND product_id=?",
      )
      .bind(request.mediaId, request.productId)
      .first<{
        altText: string;
        isPrimary: number;
        sortOrder: number;
        status: string;
        version: number;
      }>(),
  ]);
  if (version === null || !current) {
    await idempotencyFailed(deps.db, UPDATE_SCOPE, request.idempotencyKey);
    return failure("NOT_FOUND", "Product media not found", request.requestId);
  }
  if (current.status !== "active") {
    await idempotencyFailed(deps.db, UPDATE_SCOPE, request.idempotencyKey);
    return failure(
      "VALIDATION_FAILED",
      "Inactive Product media cannot be updated",
      request.requestId,
    );
  }
  if (version !== request.expectedProductVersion) {
    await idempotencyFailed(deps.db, UPDATE_SCOPE, request.idempotencyKey);
    return failure("STALE_VERSION", "Product changed; refresh before retrying", request.requestId);
  }
  try {
    await deps.db.batch([
      deps.db
        .prepare("UPDATE product SET version=version+1, updated_at=? WHERE id=? AND version=?")
        .bind(now, request.productId, request.expectedProductVersion),
      deps.db.prepare("INSERT INTO admin_command_abort (id) SELECT -1 WHERE changes()=0"),
      ...(request.isPrimary
        ? [
            deps.db
              .prepare(
                "UPDATE product_media SET is_primary=0, version=version+1, updated_at=? WHERE product_id=? AND id<>? AND status='active' AND is_primary=1",
              )
              .bind(now, request.productId, request.mediaId),
          ]
        : []),
      deps.db
        .prepare(
          "UPDATE product_media SET alt_text=?, is_primary=?, sort_order=?, version=version+1, updated_at=? WHERE id=? AND product_id=? AND status='active' AND version=?",
        )
        .bind(
          altText,
          request.isPrimary ? 1 : 0,
          request.sortOrder,
          now,
          request.mediaId,
          request.productId,
          current.version,
        ),
      deps.db.prepare("INSERT INTO admin_command_abort (id) SELECT -1 WHERE changes()=0"),
      auditEventStatement(deps.db, {
        actorUserId: access.value.authUserId,
        action: "CATALOG.PRODUCT_MEDIA_UPDATED",
        resourceType: "product_media",
        resourceId: request.mediaId,
        before: { ...current, isPrimary: current.isPrimary === 1 },
        after: {
          altText,
          isPrimary: request.isPrimary,
          sortOrder: request.sortOrder,
          status: "active",
          version: current.version + 1,
        },
        correlationId: request.requestId,
        idempotencyKey: request.idempotencyKey,
        occurredAt: now,
      }),
      idempotencyComplete(deps.db, UPDATE_SCOPE, request.idempotencyKey, request.mediaId, now),
    ]);
  } catch {
    await idempotencyFailed(deps.db, UPDATE_SCOPE, request.idempotencyKey);
    return failure("STALE_VERSION", "Product changed; refresh before retrying", request.requestId);
  }
  return readMedia(deps.db, request.productId, request.mediaId, request.requestId);
}

/** Deactivate authoritative metadata first; only then remove its generated R2 object. */
export async function removeAdminProductMedia(
  deps: ProductMediaDeps,
  request: AdminProductMediaRemoveRequest,
): Promise<RpcResult<AdminProductMediaView>> {
  const access = await resolveCatalogAdministrationAccess(deps, request, "catalog.manage");
  if (!access.ok) return access;
  const now = Date.now();
  const canonical = {
    productId: request.productId,
    mediaId: request.mediaId,
    expectedProductVersion: request.expectedProductVersion,
  };
  const claim = await claimCommandIdempotency(
    deps.db,
    () => now,
    REMOVE_SCOPE,
    request.idempotencyKey,
    canonical,
  );
  const objectKey = `products/${request.productId}/${request.mediaId}`;
  if (!claim.claimed) {
    if (claim.existing && claim.existing.requestHash !== claim.hash)
      return failure(
        "IDEMPOTENCY_CONFLICT",
        "Idempotency key was used with a different request",
        request.requestId,
      );
    if (claim.existing?.status === "SUCCEEDED") {
      await deps.bucket.delete(objectKey);
      return readMedia(deps.db, request.productId, request.mediaId, request.requestId);
    }
    return failure("CONFLICT", "The media removal is still processing", request.requestId);
  }
  const [version, current] = await Promise.all([
    productVersion(deps.db, request.productId),
    deps.db
      .prepare(
        "SELECT object_key AS objectKey, alt_text AS altText, is_primary AS isPrimary, sort_order AS sortOrder, status, version FROM product_media WHERE id=? AND product_id=?",
      )
      .bind(request.mediaId, request.productId)
      .first<{
        objectKey: string;
        altText: string;
        isPrimary: number;
        sortOrder: number;
        status: string;
        version: number;
      }>(),
  ]);
  if (version === null || !current) {
    await idempotencyFailed(deps.db, REMOVE_SCOPE, request.idempotencyKey);
    return failure("NOT_FOUND", "Product media not found", request.requestId);
  }
  if (current.status !== "active") {
    await idempotencyFailed(deps.db, REMOVE_SCOPE, request.idempotencyKey);
    return failure("VALIDATION_FAILED", "Product media is already inactive", request.requestId);
  }
  if (version !== request.expectedProductVersion) {
    await idempotencyFailed(deps.db, REMOVE_SCOPE, request.idempotencyKey);
    return failure("STALE_VERSION", "Product changed; refresh before retrying", request.requestId);
  }
  try {
    await deps.db.batch([
      deps.db
        .prepare("UPDATE product SET version=version+1, updated_at=? WHERE id=? AND version=?")
        .bind(now, request.productId, request.expectedProductVersion),
      deps.db.prepare("INSERT INTO admin_command_abort (id) SELECT -1 WHERE changes()=0"),
      deps.db
        .prepare(
          "UPDATE product_media SET status='inactive', is_primary=0, version=version+1, updated_at=? WHERE id=? AND product_id=? AND status='active' AND version=?",
        )
        .bind(now, request.mediaId, request.productId, current.version),
      deps.db.prepare("INSERT INTO admin_command_abort (id) SELECT -1 WHERE changes()=0"),
      auditEventStatement(deps.db, {
        actorUserId: access.value.authUserId,
        action: "CATALOG.PRODUCT_MEDIA_REMOVED",
        resourceType: "product_media",
        resourceId: request.mediaId,
        before: { ...current, objectKey: undefined, isPrimary: current.isPrimary === 1 },
        after: { status: "inactive", isPrimary: false, version: current.version + 1 },
        correlationId: request.requestId,
        idempotencyKey: request.idempotencyKey,
        occurredAt: now,
      }),
      idempotencyComplete(deps.db, REMOVE_SCOPE, request.idempotencyKey, request.mediaId, now),
    ]);
  } catch {
    await idempotencyFailed(deps.db, REMOVE_SCOPE, request.idempotencyKey);
    return failure("STALE_VERSION", "Product changed; refresh before retrying", request.requestId);
  }
  try {
    await deps.bucket.delete(current.objectKey);
  } catch (error) {
    log("error", "admin.catalog.product_media_delete_failed", {
      productId: request.productId,
      mediaId: request.mediaId,
      message: error instanceof Error ? error.message : String(error),
    });
    return failure(
      "INTERNAL_ERROR",
      "Product media was deactivated but blob cleanup must be retried",
      request.requestId,
    );
  }
  return readMedia(deps.db, request.productId, request.mediaId, request.requestId);
}
