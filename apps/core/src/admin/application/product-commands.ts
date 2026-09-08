import type { AdminProductSummary, RpcResult } from "@freshmarkets/contracts";
import {
  z,
  authenticatedRequestSchema,
  identifierSchema,
  idempotencyKeySchema,
  adminProductCreateBodySchema,
  adminProductUpdateBodySchema,
  adminProductStatusBodySchema,
  adminProductSummarySchema,
} from "@freshmarkets/validation";
import { requestHash } from "../../idempotency";
import { auditEventStatement } from "../../audit/application/append-audit-event";
import {
  resolveCatalogAdministrationAccess,
  type CatalogAdministrationDeps,
} from "./catalog-administration-access";
import {
  catalogCommandFailure as failure,
  requireCatalogEffect as required,
  catalogCommandReceipt,
  executeCatalogCommand,
  type CatalogCommandIdentity,
} from "./catalog-command-recovery";
const meta = authenticatedRequestSchema.extend({ idempotencyKey: idempotencyKeySchema });
const createSchema = meta.extend(adminProductCreateBodySchema.shape);
const updateSchema = meta
  .extend(adminProductUpdateBodySchema.shape)
  .extend({ productId: identifierSchema });
const statusSchema = meta
  .extend(adminProductStatusBodySchema.shape)
  .extend({ productId: identifierSchema });
const storedSchema = z.object({
  categoryId: identifierSchema,
  slug: z.string(),
  name: z.string(),
  description: z.string().nullable(),
  status: z.enum(["active", "inactive"]),
  version: z.number().int().safe().positive(),
});
function invalid(input: unknown) {
  const request = z.object({ requestId: identifierSchema }).safeParse(input);
  return failure(
    "VALIDATION_FAILED",
    "Check Product fields, version and request key",
    request.success ? request.data.requestId : "unavailable",
  );
}
function receipt(db: D1Database, command: CatalogCommandIdentity, id: string, now: number) {
  return db
    .prepare(`UPDATE idempotency_records SET status='SUCCEEDED',result_reference=(
    SELECT json_object('productId',p.id,'slug',p.slug,'name',p.name,'categoryCode',c.code,'status',p.status,'skuCount',(SELECT count(*) FROM sku s WHERE s.product_id=p.id),'version',p.version)
    FROM product p JOIN category c ON c.id=p.category_id WHERE p.id=?),updated_at=?
    WHERE scope=? AND idempotency_key=? AND request_hash=? AND status='PROCESSING'`)
    .bind(id, now, command.scope, command.key, command.hash);
}
async function read(deps: CatalogAdministrationDeps, id: string) {
  const row = await deps.db
    .prepare(
      "SELECT category_id categoryId,slug,name,description,status,version FROM product WHERE id=?",
    )
    .bind(id)
    .first();
  return row ? storedSchema.parse(row) : null;
}
export async function createAdminProduct(
  deps: CatalogAdministrationDeps,
  input: unknown,
): Promise<RpcResult<AdminProductSummary>> {
  const parsed = createSchema.safeParse(input);
  if (!parsed.success) return invalid(input);
  const request = parsed.data,
    access = await resolveCatalogAdministrationAccess(deps, request, "catalog.manage");
  if (!access.ok) return access;
  const { categoryId, slug, name, description, customerDetails, inventoryBaseUnitId } = request;
  const canonical = { categoryId, slug, name, description, customerDetails, inventoryBaseUnitId };
  const command = {
    scope: "admin.catalog.product.create",
    key: request.idempotencyKey,
    hash: await requestHash(canonical),
    requestId: request.requestId,
  };
  const prior = await catalogCommandReceipt(deps.db, command, adminProductSummarySchema);
  if (prior) return prior;
  const eligible = await deps.db
    .prepare(`SELECT 1 found FROM category c JOIN unit u ON u.id=? WHERE c.id=? AND c.status='active' AND u.status='active'
    AND ((u.code='GRAM' AND u.dimension='MASS') OR (u.code='PIECE' AND u.dimension='COUNT'))
    AND u.code=u.canonical_base_code AND u.conversion_numerator=1 AND u.conversion_denominator=1`)
    .bind(inventoryBaseUnitId, categoryId)
    .first();
  if (!eligible)
    return failure(
      "VALIDATION_FAILED",
      "An active category and canonical base unit are required",
      request.requestId,
    );
  const id = crypto.randomUUID(),
    poolId = crypto.randomUUID(),
    now = Date.now();
  return executeCatalogCommand(
    deps.db,
    command,
    access.value,
    "CATALOG.PRODUCT_CREATED",
    [
      deps.db
        .prepare(`INSERT INTO admin_command_abort(id) SELECT -1 WHERE NOT EXISTS (
      SELECT 1 FROM category c JOIN unit u ON u.id=? WHERE c.id=? AND c.status='active' AND u.status='active'
      AND ((u.code='GRAM' AND u.dimension='MASS') OR (u.code='PIECE' AND u.dimension='COUNT'))
      AND u.code=u.canonical_base_code AND u.conversion_numerator=1 AND u.conversion_denominator=1)`)
        .bind(inventoryBaseUnitId, categoryId),
      deps.db
        .prepare(
          "INSERT INTO inventory_pool(id,base_unit_id,sourcing_mode,canonical_sourcing_mode,created_at,updated_at) VALUES (?,?,'STOCKED','STOCKED',?,?)",
        )
        .bind(poolId, inventoryBaseUnitId, now, now),
      required(deps.db),
      deps.db
        .prepare(
          "INSERT INTO product(id,category_id,inventory_pool_id,slug,name,description,status,version,created_at,updated_at) VALUES (?,?,?,?,?,?,'active',1,?,?)",
        )
        .bind(id, categoryId, poolId, slug, name, description, now, now),
      required(deps.db),
      ...customerDetails.flatMap((detail) => [
        deps.db
          .prepare(
            "INSERT INTO product_detail(id,product_id,label,value,sort_order) VALUES (?,?,?,?,?)",
          )
          .bind(crypto.randomUUID(), id, detail.label, detail.value, detail.sortOrder),
        required(deps.db),
      ]),
      auditEventStatement(deps.db, {
        actorUserId: access.value.authUserId,
        action: "CATALOG.PRODUCT_CREATED",
        resourceType: "product",
        resourceId: id,
        details: canonical,
        after: { ...canonical, status: "active", version: 1 },
        idempotencyKey: command.key,
        correlationId: command.requestId,
        occurredAt: now,
      }),
      required(deps.db),
    ],
    receipt(deps.db, command, id, now),
    adminProductSummarySchema,
  );
}
export async function updateAdminProduct(
  deps: CatalogAdministrationDeps,
  input: unknown,
): Promise<RpcResult<AdminProductSummary>> {
  const parsed = updateSchema.safeParse(input);
  if (!parsed.success) return invalid(input);
  const request = parsed.data,
    access = await resolveCatalogAdministrationAccess(deps, request, "catalog.manage");
  if (!access.ok) return access;
  const { productId, categoryId, slug, name, description, customerDetails, expectedVersion } =
    request;
  const canonical = {
    productId,
    categoryId,
    slug,
    name,
    description,
    customerDetails,
    expectedVersion,
  };
  const command = {
    scope: "admin.catalog.product.update",
    key: request.idempotencyKey,
    hash: await requestHash(canonical),
    requestId: request.requestId,
  };
  const prior = await catalogCommandReceipt(deps.db, command, adminProductSummarySchema);
  if (prior) return prior;
  const current = await read(deps, productId);
  if (!current) return failure("NOT_FOUND", "Product not found", request.requestId);
  if (current.version !== expectedVersion)
    return failure("STALE_VERSION", "Product changed; refresh before retrying", request.requestId);
  if (!(await deps.db.prepare("SELECT id FROM category WHERE id=?").bind(categoryId).first()))
    return failure("VALIDATION_FAILED", "Category does not exist", request.requestId);
  const oldDetails = await deps.db
    .prepare(
      "SELECT label,value,sort_order sortOrder FROM product_detail WHERE product_id=? ORDER BY sort_order,id",
    )
    .bind(productId)
    .all<{ label: string; value: string; sortOrder: number }>();
  const now = Date.now();
  return executeCatalogCommand(
    deps.db,
    command,
    access.value,
    "CATALOG.PRODUCT_UPDATED",
    [
      deps.db
        .prepare(
          "UPDATE product SET category_id=?,slug=?,name=?,description=?,version=version+1,updated_at=? WHERE id=? AND version=?",
        )
        .bind(categoryId, slug, name, description, now, productId, expectedVersion),
      required(deps.db),
      deps.db.prepare("DELETE FROM product_detail WHERE product_id=?").bind(productId),
      deps.db
        .prepare("INSERT INTO admin_command_abort(id) SELECT -1 WHERE changes()!=?")
        .bind(oldDetails.results.length),
      ...customerDetails.flatMap((detail) => [
        deps.db
          .prepare(
            "INSERT INTO product_detail(id,product_id,label,value,sort_order) VALUES (?,?,?,?,?)",
          )
          .bind(crypto.randomUUID(), productId, detail.label, detail.value, detail.sortOrder),
        required(deps.db),
      ]),
      auditEventStatement(deps.db, {
        actorUserId: access.value.authUserId,
        action: "CATALOG.PRODUCT_UPDATED",
        resourceType: "product",
        resourceId: productId,
        before: { ...current, customerDetails: oldDetails.results },
        after: {
          categoryId,
          slug,
          name,
          description,
          customerDetails,
          status: current.status,
          version: expectedVersion + 1,
        },
        idempotencyKey: command.key,
        correlationId: command.requestId,
        occurredAt: now,
      }),
      required(deps.db),
    ],
    receipt(deps.db, command, productId, now),
    adminProductSummarySchema,
  );
}
export async function setAdminProductStatus(
  deps: CatalogAdministrationDeps,
  input: unknown,
): Promise<RpcResult<AdminProductSummary>> {
  const parsed = statusSchema.safeParse(input);
  if (!parsed.success) return invalid(input);
  const request = parsed.data,
    access = await resolveCatalogAdministrationAccess(deps, request, "catalog.manage");
  if (!access.ok) return access;
  const { productId, status, reason, expectedVersion } = request;
  const command = {
    scope: "admin.catalog.product.status",
    key: request.idempotencyKey,
    hash: await requestHash({ productId, status, reason, expectedVersion }),
    requestId: request.requestId,
  };
  const prior = await catalogCommandReceipt(deps.db, command, adminProductSummarySchema);
  if (prior) return prior;
  const current = await read(deps, productId);
  if (!current) return failure("NOT_FOUND", "Product not found", request.requestId);
  if (current.version !== expectedVersion)
    return failure("STALE_VERSION", "Product changed; refresh before retrying", request.requestId);
  if (current.status === status)
    return failure("VALIDATION_FAILED", `Product is already ${status}`, request.requestId);
  const now = Date.now();
  return executeCatalogCommand(
    deps.db,
    command,
    access.value,
    "CATALOG.PRODUCT_STATUS_CHANGED",
    [
      deps.db
        .prepare(
          "UPDATE product SET status=?,version=version+1,updated_at=? WHERE id=? AND version=? AND status=?",
        )
        .bind(status, now, productId, expectedVersion, current.status),
      required(deps.db),
      auditEventStatement(deps.db, {
        actorUserId: access.value.authUserId,
        action: "CATALOG.PRODUCT_STATUS_CHANGED",
        resourceType: "product",
        resourceId: productId,
        reason,
        before: { status: current.status, version: current.version },
        after: { status, version: expectedVersion + 1 },
        idempotencyKey: command.key,
        correlationId: command.requestId,
        occurredAt: now,
      }),
      required(deps.db),
    ],
    receipt(deps.db, command, productId, now),
    adminProductSummarySchema,
  );
}
