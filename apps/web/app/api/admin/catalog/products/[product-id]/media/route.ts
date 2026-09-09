import { adminJson, observeAdminRoute } from "@/lib/http/admin-route-observability";
import { webRequestId } from "@/lib/http/request-context";
import { env } from "cloudflare:workers";
import { adminProductMediaMaxBytes, adminProductMediaMimeTypes } from "@freshmarkets/contracts";
import { z } from "@freshmarkets/validation";
import { readBoundedBytes } from "@/lib/http/bounded-body";
import { coreClient } from "@/lib/core-client/core";
import { requestHeaders } from "@/lib/core-client/request";

function invalid(message: string, requestId: string): Response {
  return adminJson(
    {
      ok: false as const,
      error: { code: "VALIDATION_FAILED" as const, message, requestId },
    },
    { status: 400 },
  );
}

/** Parse same-origin multipart bytes; Core still validates content and owns R2. */
async function POSTHandler(
  request: Request,
  context: { params: Promise<{ "product-id": string }> },
) {
  const { "product-id": productId } = await context.params;
  const idempotencyKey = request.headers.get("idempotency-key")?.trim() ?? "";
  const body = await readBoundedBytes(request, {
    maxBytes: adminProductMediaMaxBytes + 16384,
    contentTypes: ["multipart/form-data"],
  });
  if (!body.ok)
    return adminJson(
      {
        ok: false,
        error: {
          code: "VALIDATION_FAILED",
          message: body.error.message,
          requestId: webRequestId(request),
        },
      },
      { status: body.error.status },
    );
  const form = await new Response(body.value, {
    headers: { "content-type": request.headers.get("content-type") ?? "" },
  })
    .formData()
    .catch(() => null);
  const file = form?.get("file");
  // Native multipart parsers may construct File in a different runtime realm.
  // FormData's non-string entries are Files; do not compare constructor identity.
  const mime = z
    .enum(adminProductMediaMimeTypes)
    .safeParse(file && typeof file !== "string" ? file.type : null);
  const altText = form?.get("altText");
  const isPrimary = form?.get("isPrimary");
  const sortOrder = Number(form?.get("sortOrder"));
  const expectedProductVersion = Number(form?.get("expectedProductVersion"));
  if (!form) return invalid("The multipart image could not be parsed", webRequestId(request));
  if (!file || typeof file === "string")
    return invalid("Choose an image file", webRequestId(request));
  if (!mime.success) return invalid("Choose a JPEG, PNG or WebP image", webRequestId(request));
  if (!idempotencyKey)
    return invalid("An upload idempotency key is required", webRequestId(request));
  if (file.size === 0 || file.size > adminProductMediaMaxBytes)
    return invalid("Image size must be between 1 byte and 5 MiB", webRequestId(request));
  if (
    typeof altText !== "string" ||
    altText.trim() === "" ||
    altText.trim().length > 300 ||
    !(isPrimary === "true" || isPrimary === "false") ||
    !Number.isSafeInteger(sortOrder) ||
    sortOrder < 0 ||
    sortOrder > 10000 ||
    !Number.isSafeInteger(expectedProductVersion) ||
    expectedProductVersion < 1
  ) {
    return invalid(
      "A JPEG, PNG, or WebP file up to 5 MiB, alt text, primary flag, sort order, expected Product version, and idempotency-key are required",
      webRequestId(request),
    );
  }
  const result = await coreClient(env.CORE).uploadAdminProductMedia({
    requestId: webRequestId(request),
    headers: requestHeaders(request),
    productId,
    ...(typeof form.get("replaceMediaId") === "string"
      ? { replaceMediaId: String(form.get("replaceMediaId")) }
      : {}),
    bytes: await file.arrayBuffer(),
    mimeType: mime.data,
    altText: altText.trim(),
    isPrimary: isPrimary === "true",
    sortOrder,
    expectedProductVersion,
    idempotencyKey,
  });
  return adminJson(result);
}

export const POST = observeAdminRoute(
  "admin.catalog.products.by_product_id.media.post",
  POSTHandler,
);
