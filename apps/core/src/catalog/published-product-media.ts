import {
  adminProductMediaMaxBytes,
  adminProductMediaMimeTypes,
  type PublishedProductMediaRequest,
  type PublishedProductMediaContent,
  type RpcResult,
  type CatalogMedia,
} from "@freshmarkets/contracts";
import { z, identifierSchema } from "@freshmarkets/validation";

const requestSchema = z.object({
  requestId: identifierSchema,
  mediaId: identifierSchema,
  version: z.number().int().safe().positive(),
});
const mimeSchema = z.enum(adminProductMediaMimeTypes);
/** Both catalog and cart queries use p as their Product alias. */
export const productMediaProjectionSql = `(SELECT json_object('mediaId',m.id,'version',m.version,'altText',m.alt_text)
  FROM product_media m JOIN product media_owner ON media_owner.id=m.product_id AND media_owner.status='active'
  JOIN category media_category ON media_category.id=media_owner.category_id AND media_category.status='active'
  WHERE m.product_id=p.id AND m.status='active' ORDER BY m.is_primary DESC,m.sort_order,m.id LIMIT 1)`;
const projectionSchema = z.object({
  mediaId: z.string().min(1),
  version: z.number().int().safe().positive(),
  altText: z.string().trim().min(1).max(300),
});
export function publishedProductMediaView(raw: string | null): CatalogMedia | null {
  if (!raw) return null;
  try {
    const media = projectionSchema.parse(JSON.parse(raw));
    return {
      src: `/media/products/${encodeURIComponent(media.mediaId)}/${media.version}`,
      alt: media.altText,
    };
  } catch {
    return null;
  }
}

/** Publication is checked on every read, including conditional requests at Web. */
export async function getPublishedProductMedia(
  db: D1Database,
  bucket: R2Bucket,
  input: PublishedProductMediaRequest,
): Promise<RpcResult<PublishedProductMediaContent>> {
  const parsed = requestSchema.safeParse(input);
  if (!parsed.success)
    return {
      ok: false,
      error: {
        code: "VALIDATION_FAILED",
        message: "Invalid image request",
        requestId: input.requestId,
      },
    };
  const request = parsed.data;
  const missing = (): RpcResult<PublishedProductMediaContent> => ({
    ok: false,
    error: { code: "NOT_FOUND", message: "Image is unavailable", requestId: request.requestId },
  });
  const row = await db
    .prepare(`SELECT m.object_key,m.mime_type,m.byte_size FROM product_media m
    JOIN product p ON p.id=m.product_id AND p.status='active'
    JOIN category c ON c.id=p.category_id AND c.status='active'
    WHERE m.id=? AND m.version=? AND m.status='active'`)
    .bind(request.mediaId, request.version)
    .first<{ object_key: string; mime_type: string; byte_size: number }>();
  if (!row) return missing();
  const mime = mimeSchema.safeParse(row.mime_type);
  if (!mime.success || row.byte_size < 1 || row.byte_size > adminProductMediaMaxBytes)
    return missing();
  const object = await bucket.get(row.object_key);
  if (!object || object.size !== row.byte_size) return missing();
  return {
    ok: true,
    requestId: request.requestId,
    value: { bytes: await object.arrayBuffer(), mimeType: mime.data, etag: object.httpEtag },
  };
}
