import type {
  PromotionMediaContent,
  PromotionMediaView,
  PublishedPromotionCampaign,
  RpcResult,
} from "@freshmarkets/contracts";
import { manageableBenefitTypes, promotionMediaMaxBytes } from "@freshmarkets/contracts";
import {
  authenticatedRequestSchema,
  identifierSchema,
  promotionMediaViewSchema,
  z,
} from "@freshmarkets/validation";
import { resolvePromotionAdministrationAccess } from "./promotion-administration-access";
import { promotionCommandFailure as failure } from "./promotion-command-recovery";
import type { PromotionMediaDeps } from "./promotion-media";
import { isPromotionBenefitValid } from "../../promotions/domain/checkout-promotion";

const adminSchema = authenticatedRequestSchema.extend({ promotionId: identifierSchema });
const publicSchema = z.object({
  requestId: identifierSchema,
  mediaId: identifierSchema,
  version: z.number().int().safe().positive(),
});
const campaignSchema = z.object({
  promotionId: identifierSchema,
  code: z.string(),
  name: z.string(),
  description: z.string(),
  benefitType: z.enum(manageableBenefitTypes),
  discountMinor: z.number().nullable(),
  percent: z.number().nullable(),
  minimumMinor: z.number().int().safe().nonnegative(),
  maximumDiscountMinor: z.number().nullable(),
  endsAt: z.number().nullable(),
  mediaId: identifierSchema,
  version: z.number().int().safe().positive(),
  altText: z.string().trim().min(1).max(300),
});
// Publication announces a campaign; it never promises a customer-specific benefit.
const publication = "p.status='ACTIVE' AND p.starts_at<=? AND (p.ends_at IS NULL OR p.ends_at>?)";
const selection = `SELECT p.id promotionId,p.code,p.name,p.description,p.benefit_type benefitType,p.discount_minor discountMinor,p.percent,
 p.minimum_minor minimumMinor,p.maximum_discount_minor maximumDiscountMinor,p.ends_at endsAt,m.id mediaId,m.version,m.alt_text altText
 FROM promotion p JOIN promotion_media m ON m.promotion_id=p.id AND m.status='active'`;
function campaign(raw: unknown): PublishedPromotionCampaign | null {
  const parsed = campaignSchema.safeParse(raw);
  if (!parsed.success) return null;
  const row = parsed.data;
  if (
    !isPromotionBenefitValid({
      type: row.benefitType,
      discountMinor: row.discountMinor,
      percent: row.percent,
      maximumDiscountMinor: row.maximumDiscountMinor,
    })
  )
    return null;
  return {
    promotionId: row.promotionId,
    code: row.code,
    name: row.name,
    description: row.description,
    benefitType: row.benefitType,
    discountMinor: row.discountMinor,
    percent: row.percent,
    minimumMinor: row.minimumMinor,
    maximumDiscountMinor: row.maximumDiscountMinor,
    endsAt: row.endsAt === null ? null : new Date(row.endsAt).toISOString(),
    image: {
      src: `/media/promotions/${encodeURIComponent(row.mediaId)}/${row.version}`,
      alt: row.altText,
    },
  };
}
export async function listPublishedPromotionCampaigns(
  db: D1Database,
  input: unknown,
): Promise<RpcResult<{ items: PublishedPromotionCampaign[] }>> {
  const parsed = z.object({ requestId: identifierSchema }).safeParse(input);
  if (!parsed.success) return failure("VALIDATION_FAILED", "Invalid campaign request", "unknown");
  const now = Date.now();
  const rows = await db
    .prepare(`${selection} WHERE ${publication} ORDER BY p.priority DESC,p.id LIMIT 20`)
    .bind(now, now)
    .all();
  return {
    ok: true,
    requestId: parsed.data.requestId,
    value: {
      items: rows.results.flatMap((row) => {
        const value = campaign(row);
        return value ? [value] : [];
      }),
    },
  };
}
export async function getAdminPromotionMedia(
  deps: PromotionMediaDeps,
  input: unknown,
): Promise<RpcResult<PromotionMediaView | null>> {
  const parsed = adminSchema.safeParse(input);
  if (!parsed.success) return failure("VALIDATION_FAILED", "Invalid campaign request", "unknown");
  const request = parsed.data;
  const access = await resolvePromotionAdministrationAccess(deps, request, "promotions.read");
  if (!access.ok) return access;
  const owner = await deps.db
    .prepare("SELECT id FROM promotion WHERE id=?")
    .bind(request.promotionId)
    .first();
  if (!owner) return failure("NOT_FOUND", "Campaign not found", request.requestId);
  const row = await deps.db
    .prepare(
      "SELECT promotion_id promotionId,id mediaId,version,alt_text altText,mime_type mimeType,status FROM promotion_media WHERE promotion_id=? AND status='active'",
    )
    .bind(request.promotionId)
    .first();
  return {
    ok: true,
    requestId: request.requestId,
    value: row ? promotionMediaViewSchema.parse(row) : null,
  };
}
async function content(
  db: D1Database,
  bucket: R2Bucket,
  mediaId: string,
  requestId: string,
): Promise<RpcResult<PromotionMediaContent>> {
  const row = await db
    .prepare(
      "SELECT object_key,mime_type,byte_size,content_digest FROM promotion_media WHERE id=? AND status='active'",
    )
    .bind(mediaId)
    .first<{
      object_key: string;
      mime_type: PromotionMediaView["mimeType"];
      byte_size: number;
      content_digest: string;
    }>();
  if (!row || row.byte_size < 1 || row.byte_size > promotionMediaMaxBytes)
    return failure("NOT_FOUND", "Campaign image is unavailable", requestId);
  const object = await bucket.get(row.object_key);
  if (
    !object ||
    object.size !== row.byte_size ||
    object.customMetadata?.contentDigest !== row.content_digest
  )
    return failure("NOT_FOUND", "Campaign image is unavailable", requestId);
  return {
    ok: true,
    requestId,
    value: { bytes: await object.arrayBuffer(), mimeType: row.mime_type, etag: object.httpEtag },
  };
}
export async function getAdminPromotionMediaContent(
  deps: PromotionMediaDeps,
  input: unknown,
): Promise<RpcResult<PromotionMediaContent>> {
  const parsed = adminSchema.extend({ mediaId: identifierSchema }).safeParse(input);
  if (!parsed.success) return failure("VALIDATION_FAILED", "Invalid image request", "unknown");
  const result = await getAdminPromotionMedia(deps, parsed.data);
  if (!result.ok) return result;
  if (result.value?.mediaId !== parsed.data.mediaId)
    return failure("NOT_FOUND", "Campaign image is unavailable", parsed.data.requestId);
  return content(deps.db, deps.bucket, parsed.data.mediaId, parsed.data.requestId);
}
export async function getPublishedPromotionMedia(
  db: D1Database,
  bucket: R2Bucket,
  input: unknown,
): Promise<RpcResult<PromotionMediaContent>> {
  const parsed = publicSchema.safeParse(input);
  if (!parsed.success) return failure("VALIDATION_FAILED", "Invalid image request", "unknown");
  const request = parsed.data;
  async function published() {
    const now = Date.now();
    return campaign(
      await db
        .prepare(`${selection} WHERE ${publication} AND m.id=? AND m.version=?`)
        .bind(now, now, request.mediaId, request.version)
        .first(),
    );
  }
  if (!(await published()))
    return failure("NOT_FOUND", "Campaign image is unavailable", request.requestId);
  const result = await content(db, bucket, request.mediaId, request.requestId);
  // R2 reads yield: recheck removal/replacement/deactivation before returning bytes or an ETag.
  if (!(await published()))
    return failure("NOT_FOUND", "Campaign image is unavailable", request.requestId);
  return result;
}
