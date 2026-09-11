import { env } from "cloudflare:workers";
import { bannerMediaMaxBytes } from "@freshmarkets/contracts";
import {
  idempotencyKeySchema,
  bannerMediaMimeSchema,
  bannerMediaUploadBodySchema,
  bannerMediaUpdateBodySchema,
  bannerMediaRemoveBodySchema,
} from "@freshmarkets/validation";
import { adminJson, observeAdminRoute } from "@/lib/http/admin-route-observability";
import { webRequestId } from "@/lib/http/request-context";
import { readBoundedBytes, readBoundedJson } from "@/lib/http/bounded-body";
import { coreClient } from "@/lib/core-client/core";
import { requestHeaders } from "@/lib/core-client/request";
type Context = { params: Promise<{ "banner-id": string }> };
const invalid = (request: Request, message: string, status = 400) =>
  adminJson(
    { ok: false, error: { code: "VALIDATION_FAILED", message, requestId: webRequestId(request) } },
    { status },
  );
async function metadata(request: Request, context: Context) {
  return {
    bannerId: (await context.params)["banner-id"],
    requestId: webRequestId(request),
    headers: requestHeaders(request),
  };
}
async function GETHandler(request: Request, context: Context) {
  return adminJson(
    await coreClient(env.CORE).getAdminBannerMedia(await metadata(request, context)),
  );
}
async function POSTHandler(request: Request, context: Context) {
  const key = idempotencyKeySchema.safeParse(request.headers.get("idempotency-key"));
  if (!key.success) return invalid(request, "An upload identity is required");
  const bytes = await readBoundedBytes(request, {
    maxBytes: bannerMediaMaxBytes + 16384,
    contentTypes: ["multipart/form-data"],
  });
  if (!bytes.ok) return invalid(request, bytes.error.message, bytes.error.status);
  const form = await new Response(bytes.value, {
    headers: { "content-type": request.headers.get("content-type") ?? "" },
  })
    .formData()
    .catch(() => null);
  const file = form?.get("file");
  if (!file || typeof file === "string" || file.size < 1 || file.size > bannerMediaMaxBytes)
    return invalid(request, "Choose an image up to 5 MiB");
  const mime = bannerMediaMimeSchema.safeParse(file.type);
  const expected = form?.get("expectedMedia");
  let expectedMedia: unknown;
  try {
    expectedMedia = typeof expected === "string" ? JSON.parse(expected) : undefined;
  } catch {
    return invalid(request, "Invalid image selection");
  }
  const body = bannerMediaUploadBodySchema.safeParse({
    altText: form?.get("altText"),
    expectedMedia,
  });
  if (!mime.success || !body.success)
    return invalid(request, "Choose a JPEG, PNG or WebP image and describe it");
  return adminJson(
    await coreClient(env.CORE).uploadAdminBannerMedia({
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
  const body = await readBoundedJson(request, bannerMediaUpdateBodySchema, { maxBytes: 4096 });
  if (!key.success || !body.ok)
    return invalid(
      request,
      !body.ok ? body.error.message : "An image change identity is required",
      !body.ok ? body.error.status : 400,
    );
  return adminJson(
    await coreClient(env.CORE).updateAdminBannerMedia({
      ...(await metadata(request, context)),
      ...body.value,
      idempotencyKey: key.data,
    }),
  );
}
async function DELETEHandler(request: Request, context: Context) {
  const key = idempotencyKeySchema.safeParse(request.headers.get("idempotency-key"));
  const body = await readBoundedJson(request, bannerMediaRemoveBodySchema, { maxBytes: 4096 });
  if (!key.success || !body.ok)
    return invalid(
      request,
      !body.ok ? body.error.message : "An image change identity is required",
      !body.ok ? body.error.status : 400,
    );
  return adminJson(
    await coreClient(env.CORE).removeAdminBannerMedia({
      ...(await metadata(request, context)),
      ...body.value,
      idempotencyKey: key.data,
    }),
  );
}
export const GET = observeAdminRoute("admin.banners.by_banner_id.media.get", GETHandler);
export const POST = observeAdminRoute("admin.banners.by_banner_id.media.post", POSTHandler);
export const PATCH = observeAdminRoute("admin.banners.by_banner_id.media.patch", PATCHHandler);
export const DELETE = observeAdminRoute("admin.banners.by_banner_id.media.delete", DELETEHandler);
