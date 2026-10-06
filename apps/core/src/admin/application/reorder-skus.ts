import type { AdminSkuOrderResult, RpcResult } from "@freshmarkets/contracts";
import {
  authenticatedRequestSchema,
  identifierSchema,
  idempotencyKeySchema,
  adminSkuOrderBodySchema,
  adminSkuOrderResultSchema,
} from "@freshmarkets/validation";
import { requestHash } from "../../idempotency";
import { auditEventStatement } from "../../audit/application/append-audit-event";
import {
  resolveCatalogAdministrationAccess,
  type CatalogAdministrationDeps,
} from "./catalog-administration-access";
import {
  catalogCommandFailure as failure,
  requireCatalogEffect,
  catalogCommandReceipt,
  executeCatalogCommand,
} from "./catalog-command-recovery";

const schema = authenticatedRequestSchema
  .extend(adminSkuOrderBodySchema.shape)
  .extend({ productId: identifierSchema, idempotencyKey: idempotencyKeySchema });

/** One complete order: membership, all versions and authority are checked again in the batch. */
export async function reorderAdminSkus(
  deps: CatalogAdministrationDeps,
  input: unknown,
): Promise<RpcResult<AdminSkuOrderResult>> {
  const parsed = schema.safeParse(input);
  if (!parsed.success) {
    const meta = authenticatedRequestSchema.safeParse(input);
    return failure(
      "VALIDATION_FAILED",
      "Check variant order, versions and request key",
      meta.success ? meta.data.requestId : "unavailable",
    );
  }
  const request = parsed.data;
  const access = await resolveCatalogAdministrationAccess(deps, request, "catalog.manage");
  if (!access.ok) return access;
  const body = {
    productId: request.productId,
    expectedProductVersion: request.expectedProductVersion,
    variants: request.variants,
  };
  const identity = {
    scope: "admin.catalog.sku.order",
    key: request.idempotencyKey,
    requestId: request.requestId,
    hash: await requestHash(body),
  };
  const replay = await catalogCommandReceipt(deps.db, identity, adminSkuOrderResultSchema);
  if (replay) return replay;
  const product = await deps.db
    .prepare("SELECT version FROM product WHERE id=?")
    .bind(request.productId)
    .first<{ version: number }>();
  if (!product) return failure("NOT_FOUND", "Product was not found", request.requestId);
  const current = await deps.db
    .prepare("SELECT id,version FROM sku WHERE product_id=?")
    .bind(request.productId)
    .all<{ id: string; version: number }>();
  if (
    product.version !== request.expectedProductVersion ||
    current.results.length !== request.variants.length ||
    request.variants.some(
      (item) =>
        !current.results.some(
          (sku) => sku.id === item.skuId && sku.version === item.expectedVersion,
        ),
    )
  ) {
    return failure(
      "STALE_VERSION",
      "Product or variants changed; refresh before ordering",
      request.requestId,
    );
  }
  const order = JSON.stringify(request.variants);
  const now = Date.now();
  return executeCatalogCommand(
    deps.db,
    identity,
    access.value,
    "CATALOG.SKU_ORDER_UPDATED",
    [
      deps.db
        .prepare(`INSERT INTO admin_command_abort(id) SELECT -1 WHERE
      NOT EXISTS (SELECT 1 FROM product WHERE id=? AND version=?)
      OR (SELECT count(*) FROM sku WHERE product_id=?) != json_array_length(?)
      OR EXISTS (SELECT 1 FROM json_each(?) reviewed LEFT JOIN sku s ON s.id=json_extract(reviewed.value,'$.skuId') AND s.product_id=?
        WHERE s.id IS NULL OR s.version!=json_extract(reviewed.value,'$.expectedVersion'))`)
        .bind(
          request.productId,
          request.expectedProductVersion,
          request.productId,
          order,
          order,
          request.productId,
        ),
      deps.db
        .prepare(
          `UPDATE sku SET sort_order=(SELECT CAST(reviewed.key AS INTEGER) FROM json_each(?) reviewed WHERE json_extract(reviewed.value,'$.skuId')=sku.id),version=version+1,updated_at=? WHERE product_id=?`,
        )
        .bind(order, now, request.productId),
      deps.db
        .prepare("INSERT INTO admin_command_abort(id) SELECT -1 WHERE changes()!=?")
        .bind(request.variants.length),
      auditEventStatement(deps.db, {
        actorUserId: access.value.authUserId,
        action: "CATALOG.SKU_ORDER_UPDATED",
        resourceType: "product",
        resourceId: request.productId,
        details: body,
        correlationId: request.requestId,
        idempotencyKey: identity.key,
        occurredAt: now,
      }),
      requireCatalogEffect(deps.db),
    ],
    deps.db
      .prepare(`UPDATE idempotency_records SET status='SUCCEEDED',result_reference=json_object('productId',?,'variants',json((
    SELECT json_group_array(json_object('skuId',id,'sortOrder',sort_order,'version',version)) FROM (SELECT id,sort_order,version FROM sku WHERE product_id=? ORDER BY sort_order,id)
    ))),updated_at=? WHERE scope=? AND idempotency_key=? AND request_hash=? AND status='PROCESSING'`)
      .bind(request.productId, request.productId, now, identity.scope, identity.key, identity.hash),
    adminSkuOrderResultSchema,
  );
}
