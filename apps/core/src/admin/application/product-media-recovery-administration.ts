import type {
  AuthenticatedRequest,
  ProductMediaRecoveryView,
  ProductMediaRecoveryResult,
  RecoverProductMediaRequest,
  RpcResult,
} from "@freshmarkets/contracts";
import {
  authenticatedRequestSchema,
  identifierSchema,
  idempotencyKeySchema,
  productMediaRecoveryActionSchema,
  productMediaRecoveryResultSchema,
  z,
} from "@freshmarkets/validation";
import { resolveCatalogAdministrationAccess } from "./catalog-administration-access";
import type { ProductMediaDeps } from "./product-media";
import {
  mediaFailure as failure,
  requireMediaEffect as required,
  mediaAuthorityGuard,
  mediaCleanupIntent,
} from "./product-media-recovery";
import { findIdempotencyRecord, requestHash } from "../../idempotency";
import { auditEventStatement } from "../../audit/application/append-audit-event";

const readSchema = authenticatedRequestSchema.extend({
  productId: identifierSchema,
  cursor: z.string().max(1024).optional(),
});
const commandSchema = readSchema.extend({
  itemId: identifierSchema,
  action: productMediaRecoveryActionSchema,
  expectedVersion: z.number().int().safe().positive(),
  reason: z.string().trim().min(1).max(500),
  idempotencyKey: idempotencyKeySchema,
});
const SCOPE = "admin.catalog.product-media.recover";
type Row = ProductMediaRecoveryResult & {
  objectKey: string;
  label: string;
  createdAt: number;
  updatedAt: number;
  attempts: number;
  availableAt: number | null;
  errorCode: string | null;
  leaseToken: string | null;
  leaseExpiresAt: number | null;
  digest: string | null;
  byteSize: number | null;
};
const uploads = `SELECT id itemId,'UPLOAD' kind,status,version,object_key objectKey,json_extract(request_json,'$.altText') label,created_at createdAt,updated_at updatedAt,0 attempts,NULL availableAt,NULL errorCode,lease_token leaseToken,lease_expires_at leaseExpiresAt,content_digest digest,json_extract(request_json,'$.byteSize') byteSize FROM product_media_upload WHERE product_id=? AND status<>'ATTACHED'`;
const cleanups = `SELECT id itemId,'CLEANUP' kind,status,version,object_key objectKey,'Stored image cleanup' label,created_at createdAt,updated_at updatedAt,attempt_count attempts,available_at availableAt,last_error_code errorCode,lease_token leaseToken,lease_expires_at leaseExpiresAt,NULL digest,NULL byteSize FROM product_media_cleanup WHERE product_id=?`;
function actions(
  row: Row,
  now: number,
): ProductMediaRecoveryView["items"][number]["allowedActions"] {
  if (row.leaseToken && (row.leaseExpiresAt ?? 0) > now) return [];
  if (row.kind === "CLEANUP") return row.status === "FAILED" ? ["RETRY_CLEANUP"] : [];
  if (row.status === "PENDING" && !row.leaseToken) return ["DISCARD_UPLOAD"];
  if (row.status === "STORED" && !row.leaseToken) return ["OBSERVE_UPLOAD", "DISCARD_UPLOAD"];
  if (row.status === "UNKNOWN" || (row.status === "PENDING" && row.leaseToken))
    return ["OBSERVE_UPLOAD"];
  return [];
}
export async function getAdminProductMediaRecovery(
  deps: ProductMediaDeps,
  input: AuthenticatedRequest & { productId: string; cursor?: string },
): Promise<RpcResult<ProductMediaRecoveryView>> {
  const parsed = readSchema.safeParse(input);
  if (!parsed.success) return failure("VALIDATION_FAILED", "Select a product", input.requestId);
  const request = parsed.data;
  const access = await resolveCatalogAdministrationAccess(deps, request, "catalog.read");
  if (!access.ok) return access;
  const product = await deps.db
    .prepare("SELECT id FROM product WHERE id=?")
    .bind(request.productId)
    .first();
  if (!product) return failure("NOT_FOUND", "Product not found", request.requestId);
  const manage = await resolveCatalogAdministrationAccess(deps, request, "catalog.manage");
  let cursor: [number, string, string] | null = null;
  if (request.cursor) {
    try {
      cursor = z
        .tuple([
          z.number().int().safe().nonnegative(),
          identifierSchema,
          z.enum(["UPLOAD", "CLEANUP"]),
        ])
        .parse(JSON.parse(atob(request.cursor)));
    } catch {
      return failure("VALIDATION_FAILED", "Invalid recovery cursor", request.requestId);
    }
  }
  const rows = await deps.db
    .prepare(`SELECT * FROM (${uploads} AND status<>'ABANDONED' UNION ALL ${cleanups} AND status<>'SUCCEEDED')
    ${cursor ? "WHERE createdAt>? OR (createdAt=? AND (itemId>? OR (itemId=? AND kind>?)))" : ""}
    ORDER BY createdAt,itemId,kind LIMIT 51`)
    .bind(
      request.productId,
      request.productId,
      ...(cursor ? [cursor[0], cursor[0], cursor[1], cursor[1], cursor[2]] : []),
    )
    .all<Row>();
  const page = rows.results.slice(0, 50);
  const last = page.at(-1);
  const now = Date.now();
  return {
    ok: true,
    requestId: request.requestId,
    value: {
      productId: request.productId,
      nextCursor:
        rows.results.length > 50 && last
          ? btoa(JSON.stringify([last.createdAt, last.itemId, last.kind]))
          : null,
      items: page.map((row) => ({
        itemId: row.itemId,
        kind: row.kind,
        status: row.status,
        version: row.version,
        label: row.label,
        createdAt: row.createdAt,
        updatedAt: row.updatedAt,
        attempts: row.attempts,
        availableAt: row.availableAt,
        errorCode: row.errorCode,
        allowedActions: manage.ok ? actions(row, now) : [],
      })),
    },
  };
}

export async function recoverAdminProductMedia(
  deps: ProductMediaDeps,
  input: RecoverProductMediaRequest,
): Promise<RpcResult<ProductMediaRecoveryResult>> {
  const parsed = commandSchema.safeParse(input);
  if (!parsed.success)
    return failure(
      "VALIDATION_FAILED",
      "Check the recovery action, version and reason",
      input.requestId,
    );
  const request = parsed.data;
  const access = await resolveCatalogAdministrationAccess(deps, request, "catalog.manage");
  if (!access.ok) return access;
  const hash = await requestHash({
    productId: request.productId,
    itemId: request.itemId,
    action: request.action,
    expectedVersion: request.expectedVersion,
    reason: request.reason,
  });
  async function replay(): Promise<RpcResult<ProductMediaRecoveryResult> | null> {
    const prior = await findIdempotencyRecord(deps.db, SCOPE, request.idempotencyKey);
    if (!prior) return null;
    if (prior.requestHash !== hash)
      return failure(
        "IDEMPOTENCY_CONFLICT",
        "Key belongs to another recovery request",
        request.requestId,
      );
    if (prior.status !== "SUCCEEDED" || !prior.resultReference)
      return failure("CONFLICT", "Recovery result is not confirmed", request.requestId);
    try {
      return {
        ok: true,
        requestId: request.requestId,
        value: productMediaRecoveryResultSchema.parse(JSON.parse(prior.resultReference)),
      };
    } catch {
      return failure("CONFLICT", "Saved recovery evidence needs review", request.requestId);
    }
  }
  const prior = await replay();
  if (prior) return prior;
  const cleanup = request.action === "RETRY_CLEANUP";
  const row = await deps.db
    .prepare(`${cleanup ? cleanups : uploads} AND id=?`)
    .bind(request.productId, request.itemId)
    .first<Row>();
  if (!row) return failure("NOT_FOUND", "Recovery item not found", request.requestId);
  if (row.version !== request.expectedVersion)
    return failure("STALE_VERSION", "Recovery item changed; refresh and review", request.requestId);
  if (!actions(row, Date.now()).includes(request.action))
    return failure(
      "CONFLICT",
      "This recovery action is not currently available",
      request.requestId,
    );
  let status: ProductMediaRecoveryResult["status"] = cleanup ? "PENDING" : "ABANDONED";
  if (request.action === "OBSERVE_UPLOAD") {
    let object: R2Object | null;
    try {
      object = await deps.bucket.head(row.objectKey);
    } catch {
      return failure(
        "CONFLICT",
        "Storage observation is unavailable; retry this request",
        request.requestId,
      );
    }
    status =
      object && object.customMetadata?.contentDigest === row.digest && object.size === row.byteSize
        ? "STORED"
        : "UNKNOWN";
  }
  const now = Date.now();
  const value: ProductMediaRecoveryResult = {
    itemId: row.itemId,
    kind: row.kind,
    status,
    version: row.version + 1,
  };
  try {
    await deps.db.batch([
      mediaAuthorityGuard(deps.db, access.value),
      deps.db
        .prepare(
          "INSERT INTO idempotency_records(scope,idempotency_key,request_hash,result_type,status,result_reference,created_at,updated_at) VALUES (?,?,?,?,'SUCCEEDED',?,?,?)",
        )
        .bind(SCOPE, request.idempotencyKey, hash, SCOPE, JSON.stringify(value), now, now),
      required(deps.db),
      deps.db
        .prepare(
          "INSERT INTO admin_command_abort(id) SELECT -1 WHERE EXISTS (SELECT 1 FROM product_media WHERE object_key=? AND status='active')",
        )
        .bind(row.objectKey),
      ...(cleanup
        ? [
            deps.db
              .prepare(
                "INSERT INTO admin_command_abort(id) SELECT -1 WHERE EXISTS (SELECT 1 FROM product_media_upload WHERE object_key=? AND status NOT IN ('ABANDONED','ATTACHED'))",
              )
              .bind(row.objectKey),
            deps.db
              .prepare(
                "UPDATE product_media_cleanup SET status='PENDING',attempt_count=0,available_at=?,last_error_code=NULL,lease_token=NULL,lease_expires_at=NULL,version=version+1,updated_at=? WHERE id=? AND product_id=? AND version=? AND status='FAILED' AND lease_token IS NULL",
              )
              .bind(now, now, row.itemId, request.productId, request.expectedVersion),
            required(deps.db),
          ]
        : [
            deps.db
              .prepare(
                "UPDATE product_media_upload SET status=?,lease_token=NULL,lease_expires_at=NULL,version=version+1,updated_at=? WHERE id=? AND product_id=? AND version=? AND status=? AND (lease_token IS NULL OR lease_expires_at<=?)",
              )
              .bind(
                status,
                now,
                row.itemId,
                request.productId,
                request.expectedVersion,
                row.status,
                now,
              ),
            required(deps.db),
            ...(request.action === "DISCARD_UPLOAD"
              ? [
                  mediaCleanupIntent(deps.db, request.productId, row.objectKey, now),
                  required(deps.db),
                ]
              : []),
          ]),
      auditEventStatement(deps.db, {
        actorUserId: access.value.authUserId,
        action: `CATALOG.PRODUCT_MEDIA_${request.action}`,
        resourceType: "product_media_recovery",
        resourceId: row.itemId,
        reason: request.reason,
        before: {
          status: row.status,
          version: row.version,
          attempts: row.attempts,
          errorCode: row.errorCode,
        },
        after: value,
        correlationId: request.requestId,
        idempotencyKey: request.idempotencyKey,
        occurredAt: now,
      }),
      required(deps.db),
    ]);
  } catch {
    return (
      (await replay()) ??
      failure("CONFLICT", "Recovery item or access changed; refresh and review", request.requestId)
    );
  }
  return { ok: true, requestId: request.requestId, value };
}
