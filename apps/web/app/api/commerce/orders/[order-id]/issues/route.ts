import { env } from "cloudflare:workers";
import { z } from "@freshmarkets/validation";
import { coreClient } from "@/lib/core-client/core";
import { requireIdempotencyKey } from "@/lib/core-client/commands";
import { readBoundedJson } from "@/lib/http/bounded-body";
import {
  boundedBodyErrorResponse,
  jsonWithRequestId,
  webRequestContext,
} from "@/lib/http/request-context";

const issueBodySchema = z.object({
  category: z.enum([
    "MISSING_ITEM",
    "WRONG_ITEM",
    "DAMAGED_ITEM",
    "POOR_QUALITY",
    "QUANTITY_DISCREPANCY",
    "DELIVERY_ISSUE",
    "OTHER",
  ]),
  description: z.string().trim().min(1).max(1000),
  affectedOrderItemIds: z.array(z.string().trim().min(1).max(128)).max(50),
});

export async function GET(request: Request, context: { params: Promise<{ "order-id": string }> }) {
  const requestContext = webRequestContext(request);
  const { "order-id": orderId } = await context.params;
  return jsonWithRequestId(
    await coreClient(env.CORE).listCustomerOrderIssues({
      requestId: requestContext.requestId,
      headers: requestContext.coreHeaders,
      orderId,
    }),
    requestContext.requestId,
  );
}

export async function POST(request: Request, context: { params: Promise<{ "order-id": string }> }) {
  const requestContext = webRequestContext(request);
  const parsed = await readBoundedJson(request, issueBodySchema, { maxBytes: 16 * 1024 });
  if (!parsed.ok) return boundedBodyErrorResponse(parsed.error, requestContext.requestId);
  let idempotencyKey: string;
  try {
    idempotencyKey = requireIdempotencyKey(request);
  } catch (error) {
    return jsonWithRequestId(
      {
        ok: false,
        error: {
          code: "VALIDATION_FAILED",
          message: (error as Error).message,
          requestId: requestContext.requestId,
        },
      },
      requestContext.requestId,
      { status: 400 },
    );
  }
  const { "order-id": orderId } = await context.params;
  return jsonWithRequestId(
    await coreClient(env.CORE).submitCustomerOrderIssue({
      requestId: requestContext.requestId,
      headers: requestContext.coreHeaders,
      orderId,
      ...parsed.value,
      idempotencyKey,
    }),
    requestContext.requestId,
  );
}
