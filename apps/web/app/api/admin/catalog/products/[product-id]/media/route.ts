import { adminJson, observeAdminRoute } from "@/lib/http/admin-route-observability";
import { webRequestId } from "@/lib/http/request-context";
import { env } from "cloudflare:workers";
import {
  adminProductMediaMaxBytes,
  adminProductMediaMimeTypes,
  type AdminProductMediaMimeType,
} from "@freshmarkets/contracts";
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
  const form = await request.formData().catch(() => null);
  const file = form?.get("file");
  const altText = form?.get("altText");
  const isPrimary = form?.get("isPrimary");
  const sortOrder = Number(form?.get("sortOrder"));
  const expectedProductVersion = Number(form?.get("expectedProductVersion"));
  if (
    !idempotencyKey ||
    !(file instanceof File) ||
    file.size === 0 ||
    file.size > adminProductMediaMaxBytes ||
    !adminProductMediaMimeTypes.includes(file.type as AdminProductMediaMimeType) ||
    typeof altText !== "string" ||
    altText.trim() === "" ||
    !(isPrimary === "true" || isPrimary === "false") ||
    !Number.isInteger(sortOrder) ||
    sortOrder < 0 ||
    !Number.isInteger(expectedProductVersion) ||
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
    bytes: await file.arrayBuffer(),
    mimeType: file.type as AdminProductMediaMimeType,
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
