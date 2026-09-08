import {
  adminProductMediaMaxBytes,
  type AdminProductMediaContentRequest,
  type AdminProductMediaContent,
  type RpcResult,
} from "@freshmarkets/contracts";
import {
  resolveCatalogAdministrationAccess,
  type CatalogAdministrationDeps,
} from "./catalog-administration-access";
import { mediaFailure as failure } from "./product-media-recovery";
export {
  uploadAdminProductMedia,
  updateAdminProductMedia,
  removeAdminProductMedia,
} from "./product-media-commands";
export type ProductMediaDeps = CatalogAdministrationDeps & { bucket: R2Bucket };

/** Authorized previews include inactive owners, but never inactive attachments or raw R2 keys. */
export async function getAdminProductMediaContent(
  deps: ProductMediaDeps,
  request: AdminProductMediaContentRequest,
): Promise<RpcResult<AdminProductMediaContent>> {
  const access = await resolveCatalogAdministrationAccess(
    deps,
    request,
    "catalog.read",
    request.locationId,
  );
  if (!access.ok) return access;
  if (request.locationId) {
    const inventory = await resolveCatalogAdministrationAccess(
      deps,
      request,
      "inventory.read",
      request.locationId,
    );
    if (!inventory.ok) return inventory;
  }
  const metadata = await deps.db
    .prepare(
      "SELECT object_key objectKey,mime_type mimeType,byte_size byteSize,version FROM product_media WHERE id=? AND product_id=? AND status='active'",
    )
    .bind(request.mediaId, request.productId)
    .first<{ objectKey: string; mimeType: string; byteSize: number; version: number }>();
  if (!metadata) return failure("NOT_FOUND", "Product media not found", request.requestId);
  const object = await deps.bucket.get(metadata.objectKey);
  if (!object || object.size !== metadata.byteSize || object.size > adminProductMediaMaxBytes)
    return failure("NOT_FOUND", "Product media content is unavailable", request.requestId);
  return {
    ok: true,
    requestId: request.requestId,
    value: {
      bytes: await object.arrayBuffer(),
      mimeType: metadata.mimeType,
      etag: object.httpEtag,
      version: metadata.version,
    },
  };
}
