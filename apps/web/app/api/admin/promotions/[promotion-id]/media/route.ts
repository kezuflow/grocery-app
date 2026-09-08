import { env } from "cloudflare:workers";
import { promotionMediaMaxBytes } from "@freshmarkets/contracts";
import {
  idempotencyKeySchema,
  promotionMediaMimeSchema,
  promotionMediaUploadBodySchema,
  promotionMediaUpdateBodySchema,
  promotionMediaRemoveBodySchema,
} from "@freshmarkets/validation";
import { adminJson, observeAdminRoute } from "@/lib/http/admin-route-observability";
import { webRequestId } from "@/lib/http/request-context";
import { readBoundedBytes, readBoundedJson } from "@/lib/http/bounded-body";
import { coreClient } from "@/lib/core-client/core";
import { requestHeaders } from "@/lib/core-client/request";
type Context = { params: Promise<{ "promotion-id": string }> };
const invalid = (request: Request, message: string, status = 400) =>
  adminJson(
    { ok: false, error: { code: "VALIDATION_FAILED", message, requestId: webRequestId(request) } },
    { status },
  );
async function metadata(request: Request, context: Context) {
  return {
    promotionId: (await context.params)["promotion-id"],
    requestId: webRequestId(request),
    headers: requestHeaders(request),
  };
}
async function GETHandler(request: Request, context: Context) {
  return adminJson(
    await coreClient(env.CORE).getAdminPromotionMedia(await metadata(request, context)),
  );
}
async function POSTHandler(request: Request, context: Context) {
  const key = idempotencyKeySchema.safeParse(request.headers.get("idempotency-key"));
  if (!key.success) return invalid(request, "An upload identity is required");
  const bytes = await readBoundedBytes(request, {
    maxBytes: promotionMediaMaxBytes + 16384,
    contentTypes: ["multipart/form-data"],
  });
  if (!bytes.ok) return invalid(request, bytes.error.message, bytes.error.status);
  const form = await new Response(bytes.value, {
    headers: { "content-type": request.headers.get("content-type") ?? "" },
  })
    .formData()
    .catch(() => null);
  const file = form?.get("file");
  if (!file || typeof file === "string" || file.size < 1 || file.size > promotionMediaMaxBytes)
    return invalid(request, "Choose an image up to 5 MiB");
  const mime = promotionMediaMimeSchema.safeParse(file.type);
  const expected = form?.get("expectedMedia");
  let expectedMedia: unknown;
  try {
    expectedMedia = typeof expected === "string" ? JSON.parse(expected) : undefined;
  } catch {
    return invalid(request, "Invalid image selection");
  }
  const body = promotionMediaUploadBodySchema.safeParse({
    altText: form?.get("altText"),
    expectedMedia,
  });
  if (!mime.success || !body.success)
    return invalid(request, "Choose a JPEG, PNG or WebP image and describe it");
  return adminJson(
    await coreClient(env.CORE).uploadAdminPromotionMedia({
      ...(await metadata(request, context)),
      ...body.data,
      idempotencyKey: key.data,
      bytes: await file.arrayBuffer(),
      mimeType: mime.data,
    }),
  );
}
async function PATCHHandler(request: Request, context: Context) {
  const key = idempotencyKeySchema.safeParse(request.headers.get("idempotency-key"));
  const body = await readBoundedJson(request, promotionMediaUpdateBodySchema, { maxBytes: 4096 });
  if (!key.success || !body.ok)
    return invalid(
      request,
      !body.ok ? body.error.message : "An image change identity is required",
      !body.ok ? body.error.status : 400,
    );
  return adminJson(
    await coreClient(env.CORE).updateAdminPromotionMedia({
      ...(await metadata(request, context)),
      ...body.value,
      idempotencyKey: key.data,
    }),
  );
}
async function DELETEHandler(request: Request, context: Context) {
  const key = idempotencyKeySchema.safeParse(request.headers.get("idempotency-key"));
  const body = await readBoundedJson(request, promotionMediaRemoveBodySchema, { maxBytes: 4096 });
  if (!key.success || !body.ok)
    return invalid(
      request,
      !body.ok ? body.error.message : "An image change identity is required",
      !body.ok ? body.error.status : 400,
    );
  return adminJson(
    await coreClient(env.CORE).removeAdminPromotionMedia({
      ...(await metadata(request, context)),
      ...body.value,
      idempotencyKey: key.data,
    }),
  );
}
export const GET = observeAdminRoute("admin.promotions.by_promotion_id.media.get", GETHandler);
export const POST = observeAdminRoute("admin.promotions.by_promotion_id.media.post", POSTHandler);
export const PATCH = observeAdminRoute(
  "admin.promotions.by_promotion_id.media.patch",
  PATCHHandler,
);
export const DELETE = observeAdminRoute(
  "admin.promotions.by_promotion_id.media.delete",
  DELETEHandler,
);
