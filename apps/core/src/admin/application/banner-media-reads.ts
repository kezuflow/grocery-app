import type {
  BannerMediaContent,
  BannerMediaView,
  PublishedBanner,
  RpcResult,
} from "@freshmarkets/contracts";
import { bannerMediaMaxBytes } from "@freshmarkets/contracts";
import {
  authenticatedRequestSchema,
  identifierSchema,
  bannerMediaViewSchema,
  z,
} from "@freshmarkets/validation";
import { resolvePromotionAdministrationAccess } from "./promotion-administration-access";
import { promotionCommandFailure as failure } from "./promotion-command-recovery";
import type { BannerMediaDeps } from "./banner-media";

const adminSchema = authenticatedRequestSchema.extend({ bannerId: identifierSchema });
const publicSchema = z.object({
  requestId: identifierSchema,
  mediaId: identifierSchema,
  version: z.number().int().safe().positive(),
});
const bannerSchema = z.object({
  bannerId: identifierSchema,
  name: z.string(),
  href: z.string().nullable(),
  mediaId: identifierSchema,
  version: z.number().int().positive(),
  altText: z.string(),
});
const publication = "p.status='ACTIVE' AND p.starts_at<=? AND (p.ends_at IS NULL OR p.ends_at>?)";
const selection =
  "SELECT p.id bannerId,p.name,p.href,m.id mediaId,m.version,m.alt_text altText FROM storefront_banner p JOIN banner_media m ON m.banner_id=p.id AND m.status='active'";
function banner(raw: unknown): PublishedBanner | null {
  const parsed = bannerSchema.safeParse(raw);
  if (!parsed.success) return null;
  const row = parsed.data;
  return {
    bannerId: row.bannerId,
    name: row.name,
    href: row.href,
    image: {
      src: "/media/banners/" + encodeURIComponent(row.mediaId) + "/" + row.version,
      alt: row.altText,
    },
  };
}
export async function listPublishedBanners(
  db: D1Database,
  input: unknown,
): Promise<RpcResult<{ items: PublishedBanner[] }>> {
  const parsed = z.object({ requestId: identifierSchema }).safeParse(input);
  if (!parsed.success) return failure("VALIDATION_FAILED", "Invalid banner request", "unknown");
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
        const value = banner(row);
        return value ? [value] : [];
      }),
    },
  };
}
export async function getAdminBannerMedia(
  deps: BannerMediaDeps,
  input: unknown,
): Promise<RpcResult<BannerMediaView | null>> {
  const parsed = adminSchema.safeParse(input);
  if (!parsed.success) return failure("VALIDATION_FAILED", "Invalid banner request", "unknown");
  const request = parsed.data;
  const access = await resolvePromotionAdministrationAccess(deps, request, "promotions.read");
  if (!access.ok) return access;
  const owner = await deps.db
    .prepare("SELECT id FROM storefront_banner WHERE id=?")
    .bind(request.bannerId)
    .first();
  if (!owner) return failure("NOT_FOUND", "Banner not found", request.requestId);
  const row = await deps.db
    .prepare(
      "SELECT banner_id bannerId,id mediaId,version,alt_text altText,mime_type mimeType,status FROM banner_media WHERE banner_id=? AND status='active'",
    )
    .bind(request.bannerId)
    .first();
  return {
    ok: true,
    requestId: request.requestId,
    value: row ? bannerMediaViewSchema.parse(row) : null,
  };
}
async function content(
  db: D1Database,
  bucket: R2Bucket,
  mediaId: string,
  requestId: string,
): Promise<RpcResult<BannerMediaContent>> {
  const row = await db
    .prepare(
      "SELECT object_key,mime_type,byte_size,content_digest FROM banner_media WHERE id=? AND status='active'",
    )
    .bind(mediaId)
    .first<{
      object_key: string;
      mime_type: BannerMediaView["mimeType"];
      byte_size: number;
      content_digest: string;
    }>();
  if (!row || row.byte_size < 1 || row.byte_size > bannerMediaMaxBytes)
    return failure("NOT_FOUND", "Banner image is unavailable", requestId);
  const object = await bucket.get(row.object_key);
  if (
    !object ||
    object.size !== row.byte_size ||
    object.customMetadata?.contentDigest !== row.content_digest
  )
    return failure("NOT_FOUND", "Banner image is unavailable", requestId);
  return {
    ok: true,
    requestId,
    value: { bytes: await object.arrayBuffer(), mimeType: row.mime_type, etag: object.httpEtag },
  };
}
export async function getAdminBannerMediaContent(
  deps: BannerMediaDeps,
  input: unknown,
): Promise<RpcResult<BannerMediaContent>> {
  const parsed = adminSchema.extend({ mediaId: identifierSchema }).safeParse(input);
  if (!parsed.success) return failure("VALIDATION_FAILED", "Invalid image request", "unknown");
  const result = await getAdminBannerMedia(deps, parsed.data);
  if (!result.ok) return result;
  if (result.value?.mediaId !== parsed.data.mediaId)
    return failure("NOT_FOUND", "Banner image is unavailable", parsed.data.requestId);
  return content(deps.db, deps.bucket, parsed.data.mediaId, parsed.data.requestId);
}
export async function getPublishedBannerMedia(
  db: D1Database,
  bucket: R2Bucket,
  input: unknown,
): Promise<RpcResult<BannerMediaContent>> {
  const parsed = publicSchema.safeParse(input);
  if (!parsed.success) return failure("VALIDATION_FAILED", "Invalid image request", "unknown");
  const request = parsed.data;
  async function published() {
    const now = Date.now();
    return banner(
      await db
        .prepare(`${selection} WHERE ${publication} AND m.id=? AND m.version=?`)
        .bind(now, now, request.mediaId, request.version)
        .first(),
    );
  }
  if (!(await published()))
    return failure("NOT_FOUND", "Banner image is unavailable", request.requestId);
  const result = await content(db, bucket, request.mediaId, request.requestId);
  // R2 reads yield: recheck removal/replacement/deactivation before returning bytes or an ETag.
  if (!(await published()))
    return failure("NOT_FOUND", "Banner image is unavailable", request.requestId);
  return result;
}
