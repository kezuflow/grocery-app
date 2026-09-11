import type { RpcResult, StorefrontBanner } from "@freshmarkets/contracts";
import {
  authenticatedRequestSchema,
  idempotencyKeySchema,
  storefrontBannerSchema,
  saveStorefrontBannerBodySchema,
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
  requirePromotionEffect,
  promotionCommandFailure as failure,
} from "./promotion-command-recovery";
const projection =
  "SELECT b.id bannerId,b.name,b.href,b.status,b.priority,b.starts_at startsAt,b.ends_at endsAt,b.version, m.id mediaId,m.alt_text altText,m.version mediaVersion FROM storefront_banner b LEFT JOIN banner_media m ON m.banner_id=b.id AND m.status='active'";
export async function listAdminBanners(
  deps: PromotionAdministrationDeps,
  input: unknown,
): Promise<RpcResult<{ items: StorefrontBanner[] }>> {
  const parsed = authenticatedRequestSchema.safeParse(input);
  if (!parsed.success) return failure("VALIDATION_FAILED", "Invalid banner request", "unknown");
  const access = await resolvePromotionAdministrationAccess(deps, parsed.data, "promotions.read");
  if (!access.ok) return access;
  const rows = await deps.db.prepare(projection + " ORDER BY b.priority DESC,b.id LIMIT 200").all();
  return {
    ok: true,
    requestId: parsed.data.requestId,
    value: {
      items: rows.results.map((row) =>
        storefrontBannerSchema.parse({
          ...row,
          image:
            typeof row.mediaId === "string"
              ? {
                  src:
                    "/api/admin/banners/" +
                    encodeURIComponent(String(row.bannerId)) +
                    "/media/" +
                    encodeURIComponent(row.mediaId) +
                    "?v=" +
                    row.mediaVersion,
                  alt: row.altText,
                }
              : null,
        }),
      ),
    },
  };
}
export async function saveAdminBanner(
  deps: PromotionAdministrationDeps,
  input: unknown,
): Promise<RpcResult<StorefrontBanner>> {
  const meta = authenticatedRequestSchema
    .extend({ idempotencyKey: idempotencyKeySchema })
    .safeParse(input);
  const body = saveStorefrontBannerBodySchema.safeParse(input);
  if (!meta.success || !body.success)
    return failure("VALIDATION_FAILED", "Review banner details", "unknown");
  const r = { ...meta.data, ...body.data };
  const access = await resolvePromotionAdministrationAccess(deps, r, "promotions.manage");
  if (!access.ok) return access;
  const command = {
    scope: "admin.banners.save",
    key: r.idempotencyKey,
    hash: await requestHash(body.data),
    requestId: r.requestId,
  };
  const prior = await promotionCommandReceipt(deps.db, command, storefrontBannerSchema);
  if (prior) return prior;
  const value: StorefrontBanner = {
    bannerId: r.bannerId,
    name: r.name,
    href: r.href,
    status: r.status,
    priority: r.priority,
    startsAt: r.startsAt,
    endsAt: r.endsAt,
    version: r.expectedVersion + 1,
  };
  if (r.expectedVersion === 0 && r.status !== "DRAFT")
    return failure("VALIDATION_FAILED", "Create a draft before publishing", r.requestId);
  const db = deps.db,
    now = Date.now();
  if (
    r.status === "ACTIVE" &&
    !(await db
      .prepare("SELECT 1 FROM banner_media WHERE banner_id=? AND status='active'")
      .bind(r.bannerId)
      .first())
  )
    return failure("VALIDATION_FAILED", "Add an image before activating this banner", r.requestId);
  const effects = [];
  if (r.status === "ACTIVE")
    effects.push(
      db
        .prepare(
          "INSERT INTO admin_command_abort(id) SELECT -1 WHERE NOT EXISTS(SELECT 1 FROM banner_media WHERE banner_id=? AND status='active')",
        )
        .bind(r.bannerId),
    );
  if (r.expectedVersion === 0) {
    effects.push(
      db
        .prepare(
          "INSERT INTO storefront_banner(id,name,href,status,priority,starts_at,ends_at,version,created_at,updated_at) VALUES (?,?,?,?,?,?,?,1,?,?)",
        )
        .bind(r.bannerId, r.name, r.href, r.status, r.priority, r.startsAt, r.endsAt, now, now),
    );
  } else {
    effects.push(
      db
        .prepare(
          "UPDATE storefront_banner SET name=?,href=?,status=?,priority=?,starts_at=?,ends_at=?,version=version+1,updated_at=? WHERE id=? AND version=? AND status<>'ARCHIVED'",
        )
        .bind(
          r.name,
          r.href,
          r.status,
          r.priority,
          r.startsAt,
          r.endsAt,
          now,
          r.bannerId,
          r.expectedVersion,
        ),
    );
  }
  effects.push(
    requirePromotionEffect(db),
    auditEventStatement(db, {
      actorUserId: access.value.authUserId,
      action: "BANNER.SAVED",
      resourceType: "storefront_banner",
      resourceId: r.bannerId,
      details: { status: r.status, version: value.version },
      correlationId: r.requestId,
      idempotencyKey: r.idempotencyKey,
      occurredAt: now,
    }),
    requirePromotionEffect(db),
  );
  const receipt = db
    .prepare(
      "UPDATE idempotency_records SET status='SUCCEEDED',result_reference=?,updated_at=? WHERE scope=? AND idempotency_key=? AND request_hash=? AND status='PROCESSING'",
    )
    .bind(JSON.stringify(value), now, command.scope, command.key, command.hash);
  return executePromotionCommand(
    db,
    command,
    access.value,
    "BANNER.SAVED",
    effects,
    receipt,
    storefrontBannerSchema,
  );
}
