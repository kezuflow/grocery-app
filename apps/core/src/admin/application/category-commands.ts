import { catalogCommandReceipt, executeCatalogCommand } from "./catalog-command-recovery";
import type { AdminCategorySummary, RpcResult } from "@freshmarkets/contracts";
import {
  z,
  authenticatedRequestSchema,
  identifierSchema,
  idempotencyKeySchema,
  adminCategorySummarySchema,
  adminCategoryCreateBodySchema,
  adminCategoryUpdateBodySchema,
  adminCategoryStatusBodySchema,
} from "@freshmarkets/validation";
import { requestHash } from "../../idempotency";
import { auditEventStatement } from "../../audit/application/append-audit-event";
import {
  resolveCatalogAdministrationAccess,
  type CatalogAdministrationDeps,
  type CatalogAdministrationAccess,
} from "./catalog-administration-access";

const meta = authenticatedRequestSchema.extend({ idempotencyKey: idempotencyKeySchema });
const createSchema = meta.extend(adminCategoryCreateBodySchema.shape);
const updateSchema = meta
  .extend(adminCategoryUpdateBodySchema.shape)
  .extend({ categoryId: identifierSchema });
const statusSchema = meta
  .extend(adminCategoryStatusBodySchema.shape)
  .extend({ categoryId: identifierSchema });
type Command = z.infer<typeof meta>;
const failure = (
  code: "VALIDATION_FAILED" | "IDEMPOTENCY_CONFLICT" | "CONFLICT" | "NOT_FOUND" | "STALE_VERSION",
  message: string,
  requestId: string,
) => ({ ok: false as const, error: { code, message, requestId } });
const required = (db: D1Database) =>
  db.prepare("INSERT INTO admin_command_abort(id) SELECT -1 WHERE changes()!=1");
const summarySql = `SELECT c.id categoryId,c.code,c.name,c.slug,c.status,c.sort_order sortOrder,c.icon_asset_key iconAssetKey,c.parent_id parentCategoryId,parent.name parentName,
  (SELECT count(*) FROM product p WHERE p.category_id=c.id) productCount,c.version FROM category c LEFT JOIN category parent ON parent.id=c.parent_id WHERE c.id=?`;
async function read(deps: CatalogAdministrationDeps, id: string) {
  const row = await deps.db.prepare(summarySql).bind(id).first();
  return row ? adminCategorySummarySchema.parse(row) : null;
}
function invalid(input: unknown) {
  const request = z.object({ requestId: identifierSchema }).safeParse(input);
  return failure(
    "VALIDATION_FAILED",
    "Check the category fields, version and request key",
    request.success ? request.data.requestId : "unavailable",
  );
}
function replay(deps: CatalogAdministrationDeps, request: Command, scope: string, hash: string) {
  return catalogCommandReceipt(
    deps.db,
    { scope, key: request.idempotencyKey, hash, requestId: request.requestId },
    adminCategorySummarySchema,
  );
}
function execute(
  deps: CatalogAdministrationDeps,
  request: Command,
  scope: string,
  hash: string,
  actor: CatalogAdministrationAccess,
  id: string,
  effects: D1PreparedStatement[],
) {
  const auditAction =
    scope === "admin.catalog.category"
      ? "CATALOG.CATEGORY_CREATED"
      : scope === "admin.catalog.category.update"
        ? "CATALOG.CATEGORY_UPDATED"
        : "CATALOG.CATEGORY_STATUS_CHANGED";
  return executeCatalogCommand(
    deps.db,
    { scope, key: request.idempotencyKey, hash, requestId: request.requestId },
    actor,
    auditAction,
    effects,
    deps.db
      .prepare(`UPDATE idempotency_records SET status='SUCCEEDED',result_reference=(
      SELECT json_object('categoryId',c.id,'code',c.code,'name',c.name,'slug',c.slug,'status',c.status,'sortOrder',c.sort_order,'iconAssetKey',c.icon_asset_key,
        'parentCategoryId',c.parent_id,'parentName',parent.name,'productCount',(SELECT count(*) FROM product p WHERE p.category_id=c.id),'version',c.version)
      FROM category c LEFT JOIN category parent ON parent.id=c.parent_id WHERE c.id=?),updated_at=?
      WHERE scope=? AND idempotency_key=? AND request_hash=? AND status='PROCESSING'`)
      .bind(id, Date.now(), scope, request.idempotencyKey, hash),
    adminCategorySummarySchema,
  );
}
export async function createAdminCategory(
  deps: CatalogAdministrationDeps,
  input: unknown,
): Promise<RpcResult<AdminCategorySummary>> {
  const parsed = createSchema.safeParse(input);
  if (!parsed.success) return invalid(input);
  const request = parsed.data;
  const access = await resolveCatalogAdministrationAccess(deps, request, "catalog.manage");
  if (!access.ok) return access;
  const { code, name, slug, sortOrder, parentCategoryId, iconAssetKey } = request;
  const canonical = { code, name, slug, sortOrder, parentCategoryId, iconAssetKey };
  const scope = "admin.catalog.category",
    hash = await requestHash(canonical);
  const prior = await replay(deps, request, scope, hash);
  if (prior) return prior;
  if (parentCategoryId && !(await read(deps, parentCategoryId)))
    return failure("VALIDATION_FAILED", "Parent category does not exist", request.requestId);
  const id = crypto.randomUUID(),
    now = Date.now();
  return execute(deps, request, scope, hash, access.value, id, [
    deps.db
      .prepare(`INSERT INTO category(id,code,name,slug,status,sort_order,icon_asset_key,parent_id,version,created_at,updated_at)
      VALUES (?,?,?,?,'active',?,?,?,1,?,?)`)
      .bind(id, code, name, slug, sortOrder, iconAssetKey, parentCategoryId, now, now),
    required(deps.db),
    auditEventStatement(deps.db, {
      actorUserId: access.value.authUserId,
      action: "CATALOG.CATEGORY_CREATED",
      resourceType: "category",
      resourceId: id,
      after: { ...canonical, status: "active", version: 1 },
      details: canonical,
      idempotencyKey: request.idempotencyKey,
      correlationId: request.requestId,
      occurredAt: now,
    }),
    required(deps.db),
  ]);
}
export async function updateAdminCategory(
  deps: CatalogAdministrationDeps,
  input: unknown,
): Promise<RpcResult<AdminCategorySummary>> {
  const parsed = updateSchema.safeParse(input);
  if (!parsed.success) return invalid(input);
  const request = parsed.data;
  const access = await resolveCatalogAdministrationAccess(deps, request, "catalog.manage");
  if (!access.ok) return access;
  const { categoryId, name, slug, sortOrder, parentCategoryId, iconAssetKey, expectedVersion } =
    request;
  const canonical = {
    categoryId,
    name,
    slug,
    sortOrder,
    parentCategoryId,
    iconAssetKey,
    expectedVersion,
  };
  const scope = "admin.catalog.category.update",
    hash = await requestHash(canonical);
  const prior = await replay(deps, request, scope, hash);
  if (prior) return prior;
  if (categoryId === parentCategoryId)
    return failure("VALIDATION_FAILED", "Category cannot be its own parent", request.requestId);
  const current = await read(deps, categoryId);
  if (!current) return failure("NOT_FOUND", "Category not found", request.requestId);
  if (current.version !== expectedVersion)
    return failure("STALE_VERSION", "Category changed; refresh before retrying", request.requestId);
  if (parentCategoryId && !(await read(deps, parentCategoryId)))
    return failure("VALIDATION_FAILED", "Parent category does not exist", request.requestId);
  if (
    parentCategoryId &&
    (await deps.db
      .prepare(`WITH RECURSIVE descendants(id) AS (
    SELECT id FROM category WHERE parent_id=? UNION SELECT c.id FROM category c JOIN descendants d ON c.parent_id=d.id)
    SELECT id FROM descendants WHERE id=?`)
      .bind(categoryId, parentCategoryId)
      .first())
  )
    return failure(
      "VALIDATION_FAILED",
      "Category hierarchy cannot contain a cycle",
      request.requestId,
    );
  const now = Date.now();
  return execute(deps, request, scope, hash, access.value, categoryId, [
    deps.db
      .prepare(`UPDATE category SET name=?,slug=?,parent_id=?,icon_asset_key=?,sort_order=?,version=version+1,updated_at=?
      WHERE id=? AND version=? AND (? IS NULL OR NOT EXISTS (
        WITH RECURSIVE descendants(id) AS (SELECT id FROM category WHERE parent_id=? UNION SELECT c.id FROM category c JOIN descendants d ON c.parent_id=d.id)
        SELECT 1 FROM descendants WHERE id=?))`)
      .bind(
        name,
        slug,
        parentCategoryId,
        iconAssetKey,
        sortOrder,
        now,
        categoryId,
        expectedVersion,
        parentCategoryId,
        categoryId,
        parentCategoryId,
      ),
    required(deps.db),
    auditEventStatement(deps.db, {
      actorUserId: access.value.authUserId,
      action: "CATALOG.CATEGORY_UPDATED",
      resourceType: "category",
      resourceId: categoryId,
      before: current,
      after: {
        name,
        slug,
        parentCategoryId,
        iconAssetKey,
        sortOrder,
        version: expectedVersion + 1,
      },
      idempotencyKey: request.idempotencyKey,
      correlationId: request.requestId,
      occurredAt: now,
    }),
    required(deps.db),
  ]);
}
export async function setAdminCategoryStatus(
  deps: CatalogAdministrationDeps,
  input: unknown,
): Promise<RpcResult<AdminCategorySummary>> {
  const parsed = statusSchema.safeParse(input);
  if (!parsed.success) return invalid(input);
  const request = parsed.data;
  const access = await resolveCatalogAdministrationAccess(deps, request, "catalog.manage");
  if (!access.ok) return access;
  const { categoryId, status, reason, expectedVersion } = request;
  const scope = "admin.catalog.category.status",
    hash = await requestHash({ categoryId, status, reason, expectedVersion });
  const prior = await replay(deps, request, scope, hash);
  if (prior) return prior;
  const current = await read(deps, categoryId);
  if (!current) return failure("NOT_FOUND", "Category not found", request.requestId);
  if (current.version !== expectedVersion)
    return failure("STALE_VERSION", "Category changed; refresh before retrying", request.requestId);
  if (current.status === status)
    return failure("VALIDATION_FAILED", `Category is already ${status}`, request.requestId);
  const now = Date.now();
  return execute(deps, request, scope, hash, access.value, categoryId, [
    deps.db
      .prepare(
        "UPDATE category SET status=?,version=version+1,updated_at=? WHERE id=? AND version=? AND status=?",
      )
      .bind(status, now, categoryId, expectedVersion, current.status),
    required(deps.db),
    auditEventStatement(deps.db, {
      actorUserId: access.value.authUserId,
      action: "CATALOG.CATEGORY_STATUS_CHANGED",
      resourceType: "category",
      resourceId: categoryId,
      reason,
      before: current,
      after: { status, version: expectedVersion + 1 },
      idempotencyKey: request.idempotencyKey,
      correlationId: request.requestId,
      occurredAt: now,
    }),
    required(deps.db),
  ]);
}
