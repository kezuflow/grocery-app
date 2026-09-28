import { env } from "cloudflare:workers";
import { idempotencyKeySchema, z } from "@freshmarkets/validation";
import type { RpcResult } from "@freshmarkets/contracts";
import { orderMessageImageMaxInputBytes } from "@freshmarkets/contracts";
import { coreClient } from "@/lib/core-client/core";
import { requestHeaders } from "@/lib/core-client/request";
import { readBoundedBytes, readBoundedJson } from "@/lib/http/bounded-body";
import { webRequestId } from "@/lib/http/request-context";

export type MessageSide = "CUSTOMER" | "ADMIN";

function response<T>(request: Request, result: RpcResult<T>): Response {
  const status = result.ok
    ? 200
    : result.error.code === "UNAUTHENTICATED"
      ? 401
      : result.error.code === "FORBIDDEN"
        ? 403
        : result.error.code === "NOT_FOUND"
          ? 404
          : result.error.code === "VALIDATION_FAILED"
            ? 400
            : result.error.code === "CONFIGURATION_ERROR"
              ? 503
              : result.error.code === "IDEMPOTENCY_CONFLICT" ||
                  result.error.code === "CONFLICT" ||
                  result.error.code === "STALE_VERSION"
                ? 409
                : 500;
  return Response.json(result, {
    status,
    headers: {
      "cache-control": "private, no-store",
      "x-request-id": webRequestId(request),
    },
  });
}

function invalid(request: Request, message: string, status = 400) {
  return Response.json(
    { ok: false, error: { code: "VALIDATION_FAILED", message, requestId: webRequestId(request) } },
    { status, headers: { "cache-control": "private, no-store" } },
  );
}

function meta(request: Request) {
  return { requestId: webRequestId(request), headers: requestHeaders(request) };
}

const sendSchema = z.object({
  body: z.string().max(2000),
  attachmentIds: z.array(z.string().min(1).max(200)).max(3),
});
const readSchema = z.object({ throughSequence: z.number().int().min(0) });
const acknowledgementSchema = z.object({
  text: z.string().trim().min(1).max(500),
  expectedVersion: z.number().int().positive(),
});

export async function listConversations(request: Request, side: MessageSide) {
  const query = new URL(request.url).searchParams;
  const rawLimit = query.get("limit");
  const limit = rawLimit ? Number(rawLimit) : undefined;
  const input = {
    ...meta(request),
    cursor: query.get("cursor") ?? undefined,
    limit,
    locationId: side === "ADMIN" ? (query.get("locationId") ?? undefined) : undefined,
  };
  const client = coreClient(env.CORE);
  return response(
    request,
    side === "CUSTOMER"
      ? await client.listCustomerOrderConversations(input)
      : await client.listAdminOrderConversations(input),
  );
}

export async function getMessages(request: Request, side: MessageSide, orderId: string) {
  const query = new URL(request.url).searchParams;
  const rawBefore = query.get("beforeSequence");
  const rawLimit = query.get("limit");
  const input = {
    ...meta(request),
    orderId,
    beforeSequence: rawBefore ? Number(rawBefore) : undefined,
    limit: rawLimit ? Number(rawLimit) : undefined,
  };
  const client = coreClient(env.CORE);
  return response(
    request,
    side === "CUSTOMER"
      ? await client.getCustomerOrderMessages(input)
      : await client.getAdminOrderMessages(input),
  );
}

export async function sendMessage(request: Request, side: MessageSide, orderId: string) {
  const key = idempotencyKeySchema.safeParse(request.headers.get("idempotency-key"));
  if (!key.success) return invalid(request, "A message identity is required");
  const body = await readBoundedJson(request, sendSchema, { maxBytes: 16_384 });
  if (!body.ok) return invalid(request, body.error.message, body.error.status);
  const input = { ...meta(request), orderId, ...body.value, idempotencyKey: key.data };
  const client = coreClient(env.CORE);
  return response(
    request,
    side === "CUSTOMER"
      ? await client.sendCustomerOrderMessage(input)
      : await client.sendAdminOrderMessage(input),
  );
}

export async function markRead(request: Request, side: MessageSide, orderId: string) {
  const body = await readBoundedJson(request, readSchema, { maxBytes: 1024 });
  if (!body.ok) return invalid(request, body.error.message, body.error.status);
  const input = { ...meta(request), orderId, ...body.value };
  const client = coreClient(env.CORE);
  return response(
    request,
    side === "CUSTOMER"
      ? await client.markCustomerOrderConversationRead(input)
      : await client.markAdminOrderConversationRead(input),
  );
}

export async function stageAttachment(request: Request, side: MessageSide, orderId: string) {
  const key = idempotencyKeySchema.safeParse(request.headers.get("idempotency-key"));
  if (!key.success) return invalid(request, "An upload identity is required");
  const length = Number(request.headers.get("content-length"));
  if (Number.isFinite(length) && length > orderMessageImageMaxInputBytes + 16_384)
    return invalid(request, "Photo exceeds the 18 MB upload limit", 413);
  const client = coreClient(env.CORE);
  const access =
    side === "CUSTOMER"
      ? await client.getCustomerOrderMessages({ ...meta(request), orderId, limit: 1 })
      : await client.getAdminOrderMessages({ ...meta(request), orderId, limit: 1 });
  if (!access.ok) return response(request, access);
  // The validated session, rather than a shared mobile-network IP, is the
  // edge key. Core's D1 quota remains authoritative across locations.
  const sessionToken = request.headers
    .get("cookie")
    ?.split(";")
    .map((part) => part.trim())
    .find((part) => /^(?:__Secure-)?better-auth\.session_token=/.test(part))
    ?.split("=", 2)[1];
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(sessionToken ?? request.headers.get("cookie") ?? ""),
  );
  const keyHash = Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
  const limited = await env.MESSAGE_UPLOAD_RATE.limit({ key: `message-photo:${keyHash}` });
  if (!limited.success)
    return Response.json(
      {
        ok: false,
        error: {
          code: "CONFLICT",
          message: "Too many photo uploads; try again in a minute",
          requestId: webRequestId(request),
        },
      },
      { status: 429, headers: { "cache-control": "private, no-store", "retry-after": "60" } },
    );
  const bytes = await readBoundedBytes(request, {
    maxBytes: orderMessageImageMaxInputBytes + 16_384,
    contentTypes: ["multipart/form-data"],
  });
  if (!bytes.ok) return invalid(request, bytes.error.message, bytes.error.status);
  const form = await new Response(bytes.value, {
    headers: { "content-type": request.headers.get("content-type") ?? "" },
  })
    .formData()
    .catch(() => null);
  const file = form?.get("file");
  if (
    !file ||
    typeof file === "string" ||
    file.size < 1 ||
    file.size > orderMessageImageMaxInputBytes
  )
    return invalid(request, "Choose a JPEG, PNG, WebP or HEIC image up to 18 MB");
  const mimeType =
    file.type ||
    (/\.heic$/i.test(file.name) ? "image/heic" : /\.heif$/i.test(file.name) ? "image/heif" : "");
  const input = {
    ...meta(request),
    orderId,
    idempotencyKey: key.data,
    fileName: file.name,
    mimeType,
    bytes: new Uint8Array(await file.arrayBuffer()),
  };
  return response(
    request,
    side === "CUSTOMER"
      ? await client.stageCustomerOrderMessageAttachment(input)
      : await client.stageAdminOrderMessageAttachment(input),
  );
}

export async function cancelAttachment(request: Request, side: MessageSide, orderId: string) {
  const key = idempotencyKeySchema.safeParse(request.headers.get("idempotency-key"));
  if (!key.success) return invalid(request, "An upload identity is required");
  const input = { ...meta(request), orderId, idempotencyKey: key.data };
  const client = coreClient(env.CORE);
  return response(
    request,
    side === "CUSTOMER"
      ? await client.cancelCustomerOrderMessageAttachment(input)
      : await client.cancelAdminOrderMessageAttachment(input),
  );
}

export async function downloadAttachment(
  request: Request,
  side: MessageSide,
  orderId: string,
  attachmentId: string,
) {
  const input = { ...meta(request), orderId, attachmentId };
  const client = coreClient(env.CORE);
  const result =
    side === "CUSTOMER"
      ? await client.readCustomerOrderMessageAttachment(input)
      : await client.readAdminOrderMessageAttachment(input);
  if (!result.ok) return response(request, result);
  const image = result.value.mimeType.startsWith("image/");
  const filename = encodeURIComponent(result.value.fileName);
  return new Response(new Uint8Array(result.value.bytes), {
    headers: {
      "content-type": result.value.mimeType,
      "content-disposition": `${image ? "inline" : "attachment"}; filename="attachment"; filename*=UTF-8''${filename}`,
      "cache-control": "private, no-store",
      "x-content-type-options": "nosniff",
      "content-security-policy": "sandbox",
      "x-request-id": webRequestId(request),
    },
  });
}

export async function getAcknowledgement(request: Request) {
  return response(request, await coreClient(env.CORE).getOrderAcknowledgement(meta(request)));
}

export async function saveAcknowledgement(request: Request) {
  const key = idempotencyKeySchema.safeParse(request.headers.get("idempotency-key"));
  if (!key.success) return invalid(request, "A settings identity is required");
  const body = await readBoundedJson(request, acknowledgementSchema, { maxBytes: 2048 });
  if (!body.ok) return invalid(request, body.error.message, body.error.status);
  return response(
    request,
    await coreClient(env.CORE).saveOrderAcknowledgement({
      ...meta(request),
      ...body.value,
      idempotencyKey: key.data,
    }),
  );
}
